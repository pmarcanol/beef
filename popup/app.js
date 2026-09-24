import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../lib/constants.js';
import { isPullRequestOverviewUrl } from '../lib/github.js';

const reviewButton = document.getElementById('review');
const settingsButton = document.getElementById('settings');
const status = document.getElementById('status');
const message = document.getElementById('message');
const consentDialog = document.getElementById('consent-dialog');
const consentCancel = document.getElementById('consent-cancel');
const consentConfirm = document.getElementById('consent-confirm');

const stored = await chrome.storage.local.get(SETTINGS_KEY);
let settings = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };

function renderStatus() {
	const ready = Boolean(settings.typesafeApiKey && settings.dataDisclosureAcceptedAt);
	status.textContent = ready
		? 'Ready'
		: settings.typesafeApiKey
			? 'Confirm on review'
			: 'Key needed';
	status.dataset.ready = String(ready);
}

renderStatus();

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

async function runReview() {
	try {
		message.textContent = '';
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
}

reviewButton.addEventListener('click', async () => {
	if (!settings.dataDisclosureAcceptedAt) {
		consentDialog.showModal();
		return;
	}
	await runReview();
});

consentCancel.addEventListener('click', () => consentDialog.close('cancel'));
consentConfirm.addEventListener('click', async () => {
	consentConfirm.disabled = true;
	try {
		settings = { ...settings, dataDisclosureAcceptedAt: new Date().toISOString() };
		await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
		renderStatus();
		consentDialog.close('accepted');
		await runReview();
	} catch (error) {
		message.textContent = error.message || 'Could not save your confirmation.';
	} finally {
		consentConfirm.disabled = false;
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
