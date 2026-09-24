import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../lib/constants.js';
import { isPullRequestOverviewUrl } from '../lib/github.js';

const reviewButton = document.getElementById('review');
const settingsButton = document.getElementById('settings');
const status = document.getElementById('status');
const message = document.getElementById('message');

const stored = await chrome.storage.local.get(SETTINGS_KEY);
const settings = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
status.textContent = settings.typesafeApiKey ? 'Ready' : 'Key needed';
status.dataset.ready = String(Boolean(settings.typesafeApiKey));

async function activeTab() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab?.id) throw new Error('No active tab.');
	return tab;
}

async function waitForTab(tabId, expectedUrl, timeout = 20_000) {
	const current = await chrome.tabs.get(tabId);
	if (current.status === 'complete' && current.url?.startsWith(expectedUrl)) return current;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			chrome.tabs.onUpdated.removeListener(listener);
			reject(new Error('GitHub took too long to open the changes view.'));
		}, timeout);
		function listener(updatedId, change, updatedTab) {
			if (
				updatedId !== tabId ||
				change.status !== 'complete' ||
				!updatedTab.url?.startsWith(expectedUrl)
			)
				return;
			clearTimeout(timer);
			chrome.tabs.onUpdated.removeListener(listener);
			resolve(updatedTab);
		}
		chrome.tabs.onUpdated.addListener(listener);
	});
}

reviewButton.addEventListener('click', async () => {
	try {
		const tab = await activeTab();
		const context = await chrome.runtime.sendMessage({
			type: 'BEEF_GET_CONTEXT',
			sourceTabId: tab.id
		});
		if (!context?.ok) throw new Error('Open a GitHub pull request first.');
		if (!settings.typesafeApiKey) throw new Error('Add your Jev key in Settings.');
		if (isPullRequestOverviewUrl(tab.url, context.ref)) {
			await chrome.tabs.update(tab.id, { url: context.ref.filesUrl });
			await waitForTab(tab.id, context.ref.filesUrl);
		}

		const url = new URL(chrome.runtime.getURL('review/index.html'));
		url.searchParams.set('sourceTabId', String(tab.id));
		url.searchParams.set('autorun', '1');
		await chrome.tabs.create({ url: url.toString() });
		window.close();
	} catch (error) {
		message.textContent = error.message || 'Could not start the review.';
	}
});

settingsButton.addEventListener('click', async () => {
	const url = new URL(chrome.runtime.getURL('sidepanel/index.html'));
	try {
		const tab = await activeTab();
		url.searchParams.set('sourceTabId', String(tab.id));
	} catch {
		// Settings and history do not require a source tab.
	}
	await chrome.tabs.create({ url: url.toString() });
	window.close();
});
