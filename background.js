import { DEFAULT_SETTINGS, SETTINGS_KEY, STATE_KEY } from './lib/constants.js';
import { mergeCollectedData, parsePullRequestUrl, parseUnifiedDiff } from './lib/github.js';
import {
	answersForFiles,
	buildJevRequest,
	evaluateWithJev,
	isOversizedJevError,
	splitFilesByWeight
} from './lib/jev.js';
import { initialState } from './lib/state.js';

chrome.runtime.onInstalled.addListener(async () => {
	const stored = await chrome.storage.local.get([SETTINGS_KEY, STATE_KEY]);
	if (!stored[SETTINGS_KEY]) {
		await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
	} else {
		const migratedSettings = { ...stored[SETTINGS_KEY] };
		let changed = false;
		if ('githubToken' in migratedSettings) {
			delete migratedSettings.githubToken;
			changed = true;
		}
		if ('batchSize' in migratedSettings || 'maxPatchCharacters' in migratedSettings) {
			delete migratedSettings.batchSize;
			delete migratedSettings.maxPatchCharacters;
			changed = true;
		}
		if (changed) await chrome.storage.local.set({ [SETTINGS_KEY]: migratedSettings });
	}
	if (!stored[STATE_KEY]) await chrome.storage.local.set({ [STATE_KEY]: initialState() });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message?.type === 'BEEF_RUN') {
		runAnalysis(message.sourceTabId)
			.then(sendResponse)
			.catch((error) => sendResponse({ ok: false, error: error.message }));
		return true;
	}
	if (message?.type === 'BEEF_GET_CONTEXT') {
		getCurrentContext(message.sourceTabId).then(sendResponse);
		return true;
	}
	if (message?.type === 'BEEF_COLLECT_CONTEXT') {
		collectContext(message.sourceTabId)
			.then((data) => sendResponse({ ok: true, data }))
			.catch((error) => sendResponse({ ok: false, error: error.message }));
		return true;
	}
	if (message?.type === 'BEEF_RESET') {
		saveState(initialState()).then(() => sendResponse({ ok: true }));
		return true;
	}
	return false;
});

async function saveState(state) {
	state.updatedAt = new Date().toISOString();
	await chrome.storage.local.set({ [STATE_KEY]: state });
}

async function getSettings() {
	const stored = await chrome.storage.local.get(SETTINGS_KEY);
	return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
}

async function targetTab(sourceTabId) {
	if (Number.isInteger(sourceTabId)) {
		try {
			return await chrome.tabs.get(sourceTabId);
		} catch {
			// Fall through to the current active tab.
		}
	}
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	return tab;
}

async function getCurrentContext(sourceTabId) {
	const tab = await targetTab(sourceTabId);
	const ref = parsePullRequestUrl(tab?.url);
	return { ok: Boolean(ref), tabId: tab?.id || null, url: tab?.url || '', ref };
}

async function collectFromTab(tabId) {
	try {
		return await chrome.tabs.sendMessage(tabId, { type: 'BEEF_COLLECT_METADATA' });
	} catch {
		await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
		return chrome.tabs.sendMessage(tabId, { type: 'BEEF_COLLECT_METADATA' });
	}
}

async function waitForComplete(tabId, timeout = 20_000) {
	const current = await chrome.tabs.get(tabId);
	if (current.status === 'complete') return current;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			chrome.tabs.onUpdated.removeListener(listener);
			reject(new Error('GitHub took too long to open the .diff page.'));
		}, timeout);
		function listener(updatedId, change, tab) {
			if (updatedId !== tabId || change.status !== 'complete') return;
			clearTimeout(timer);
			chrome.tabs.onUpdated.removeListener(listener);
			resolve(tab);
		}
		chrome.tabs.onUpdated.addListener(listener);
	});
}

async function readDiffInTemporaryTab(diffUrl) {
	const tab = await chrome.tabs.create({ url: diffUrl, active: false });
	try {
		const loadedTab = await waitForComplete(tab.id);
		const results = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: () => document.body?.innerText || document.documentElement?.innerText || ''
		});
		const text = results[0]?.result || '';
		if (!text.startsWith('diff --git ') && text.trim()) {
			throw new Error(
				`GitHub did not open a unified diff at ${loadedTab.url || diffUrl}: ${text.slice(0, 120)}`
			);
		}
		return text;
	} finally {
		await chrome.tabs.remove(tab.id).catch(() => {});
	}
}

async function collectPullRequest(tab, ref) {
	const response = await collectFromTab(tab.id);
	if (!response?.ok) throw new Error(response?.error || 'Could not read the pull request tab.');
	const pageData = response.data;
	const diffText = await readDiffInTemporaryTab(ref.diffUrl);
	const files = parseUnifiedDiff(diffText);
	if (!files.length && diffText.trim()) {
		throw new Error('GitHub returned a diff that Beef could not split into files.');
	}
	const collected = mergeCollectedData(
		ref,
		{ diffUrl: ref.diffUrl, text: diffText, files },
		pageData
	);
	collected.warnings = [];
	if (!collected.files.length) {
		throw new Error('The pull request .diff does not contain any changed files.');
	}
	return collected;
}

async function collectContext(sourceTabId) {
	const tab = await targetTab(sourceTabId);
	const ref = parsePullRequestUrl(tab?.url);
	if (!tab?.id || !ref) throw new Error('Open a GitHub pull request first.');
	return collectPullRequest(tab, ref);
}

async function runAnalysis(sourceTabId) {
	const tab = await targetTab(sourceTabId);
	const ref = parsePullRequestUrl(tab?.url);
	if (!tab?.id || !ref) throw new Error('Open a GitHub pull request first.');

	const settings = await getSettings();
	if (!settings.typesafeApiKey)
		throw new Error('Add a TypeSafe API key in Settings before grading this PR.');
	if (!settings.dataDisclosureAcceptedAt)
		throw new Error('Confirm data sharing from the Beef popup before grading this PR.');

	const state = initialState({
		phase: 'collecting',
		startedAt: new Date().toISOString(),
		source: {
			tabId: tab.id,
			originalUrl: tab.url,
			diffUrl: ref.diffUrl,
			collectionMethod: 'browser-pr-page+github-dot-diff'
		}
	});
	await saveState(state);

	try {
		const collected = await collectPullRequest(tab, ref);
		state.pr = collected.pr;
		state.files = collected.files;
		state.raw.collection = collected.raw;
		state.warnings = collected.warnings;
		state.analysis.totalFiles = collected.files.length;
		state.phase = 'classifying';
		await saveState(state);

		const pendingBatches = [collected.files];
		while (pendingBatches.length) {
			const files = pendingBatches.shift();
			const request = buildJevRequest(collected.pr, files);
			const batchRecord = {
				index: state.classifier.batches.length,
				filenames: files.map((file) => file.filename),
				mapping: request.mapping,
				request: request.payload,
				status: 'running',
				startedAt: new Date().toISOString()
			};
			state.classifier.batches.push(batchRecord);
			await saveState(state);

			let response;
			try {
				response = await evaluateWithJev(request.payload, settings.typesafeApiKey);
			} catch (error) {
				if (isOversizedJevError(error) && files.length > 1) {
					const split = splitFilesByWeight(files);
					Object.assign(batchRecord, {
						status: 'split',
						completedAt: new Date().toISOString(),
						error: { message: error.message, status: error.status || null },
						splitInto: split.map((part) => part.map((file) => file.filename))
					});
					pendingBatches.unshift(...split);
					await saveState(state);
					continue;
				}
				Object.assign(batchRecord, {
					status: 'error',
					completedAt: new Date().toISOString(),
					error: { message: error.message, status: error.status || null }
				});
				await saveState(state);
				throw error;
			}
			const perFile = answersForFiles(files, response);
			Object.assign(state.analysis.byFile, perFile);
			state.analysis.completedFiles += files.length;
			state.classifier.resolvedModels = [
				...new Set([...state.classifier.resolvedModels, response.model])
			];
			state.classifier.usage.inputTokens += response.usage?.input_tokens || 0;
			state.classifier.usage.outputTokens += response.usage?.output_tokens || 0;
			state.raw.typesafeResponses.push(response);
			Object.assign(batchRecord, {
				status: 'complete',
				completedAt: new Date().toISOString(),
				response
			});
			await saveState(state);

			chrome.tabs
				.sendMessage(tab.id, { type: 'BEEF_RENDER_BADGES', analysis: perFile })
				.catch(() => {});
		}

		state.phase = 'complete';
		state.completedAt = new Date().toISOString();
		await saveState(state);
		return { ok: true, files: state.files.length };
	} catch (error) {
		state.phase = 'error';
		state.error = {
			message: error.message,
			name: error.name || 'Error',
			stack: error.stack || null,
			at: new Date().toISOString()
		};
		await saveState(state);
		return { ok: false, error: error.message };
	}
}
