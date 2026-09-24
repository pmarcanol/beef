import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pullRequestUrl = 'https://github.com/openai/openai-node/pull/2798';
const context = await chromium.launchPersistentContext('', {
	channel: 'chromium',
	headless: true,
	args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
});

try {
	let [worker] = context.serviceWorkers();
	if (!worker) worker = await context.waitForEvent('serviceworker');
	const page = await context.newPage();
	await page.goto(pullRequestUrl, { waitUntil: 'domcontentloaded' });

	const tabId = await worker.evaluate(async (url) => {
		const tabs = await chrome.tabs.query({});
		return tabs.find((tab) => tab.url?.startsWith(url))?.id || null;
	}, pullRequestUrl);
	assert.ok(tabId, 'GitHub PR tab was not found');

	const extensionId = new URL(worker.url()).host;
	const bridge = await context.newPage();
	await bridge.goto(`chrome-extension://${extensionId}/popup/index.html`);
	const response = await bridge.evaluate(
		(id) => chrome.runtime.sendMessage({ type: 'BEEF_COLLECT_CONTEXT', sourceTabId: id }),
		tabId
	);

	assert.equal(response.ok, true, response.error);
	assert.ok(response.data.pr.title, 'PR title was not captured from the browser page');
	assert.ok(
		response.data.raw.unifiedDiff.startsWith('diff --git '),
		'PR .diff was not captured from the temporary browser tab'
	);
	console.log(
		JSON.stringify({
			page: response.data.raw.browserPage.pageUrl,
			title: response.data.pr.title,
			diffUrl: response.data.raw.diffUrl,
			diffBytes: response.data.raw.unifiedDiff.length,
			files: response.data.files.length
		})
	);
} finally {
	await context.close();
}
