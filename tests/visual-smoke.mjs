import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = await chromium.launchPersistentContext('', {
	channel: 'chromium',
	headless: true,
	viewport: { width: 390, height: 844 },
	args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
});

let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker');
const extensionId = new URL(worker.url()).host;
const page = await context.newPage();
await page.goto(`chrome-extension://${extensionId}/sidepanel/index.html`);

await page.evaluate(async () => {
	await chrome.storage.local.set({
		beefSettings: {
			typesafeApiKey: 'local-test-key'
		},
		beefState: {
			schemaVersion: 1,
			appVersion: '0.7.1',
			phase: 'complete',
			startedAt: '2026-09-24T11:00:00.000Z',
			updatedAt: '2026-09-24T11:00:03.000Z',
			completedAt: '2026-09-24T11:00:03.000Z',
			source: { tabId: 12, originalUrl: 'https://github.com/openai/codex/pull/42' },
			pr: {
				owner: 'openai',
				repo: 'codex',
				number: 42,
				title: 'Make retries safe under concurrent writes',
				description: 'Retry transient failures without duplicating writes.',
				author: 'pablo',
				labels: ['reliability'],
				base: 'main',
				head: 'safe-retries',
				additions: 214,
				deletions: 73,
				changedFiles: 3
			},
			files: [
				{
					filename: 'src/runtime/retry-policy.ts',
					status: 'modified',
					additions: 88,
					deletions: 21,
					patch: `diff --git a/src/runtime/retry-policy.ts b/src/runtime/retry-policy.ts
index aaaaaaa..bbbbbbb 100644
--- a/src/runtime/retry-policy.ts
+++ b/src/runtime/retry-policy.ts
@@ -10,3 +10,4 @@ export function retry() {
-  return once(request, ${'oldArgument, '.repeat(48)}options)
+  const key = idempotencyKey(request, ${'newArgument, '.repeat(48)}options)
+  return retryThreeTimes(request, key)
 }`
				},
				{
					filename: 'src/runtime/request.ts',
					status: 'modified',
					additions: 92,
					deletions: 48,
					patch:
						'diff --git a/src/runtime/request.ts b/src/runtime/request.ts\nindex ccccccc..ddddddd 100644\n--- a/src/runtime/request.ts\n+++ b/src/runtime/request.ts\n@@ -4,2 +4,3 @@ export async function request() {\n+  assertIdempotent(options)\n   return transport.send(options)\n }'
				},
				{
					filename: 'tests/retry-policy.test.ts',
					status: 'added',
					additions: 34,
					deletions: 0,
					patch:
						'diff --git a/tests/retry-policy.test.ts b/tests/retry-policy.test.ts\nnew file mode 100644\nindex 0000000..eeeeeee\n--- /dev/null\n+++ b/tests/retry-policy.test.ts\n@@ -0,0 +1,3 @@\n+import { retry } from "../src/runtime/retry-policy"\n+const attempts = 3\n+test("retries safely", () => retry(attempts))'
				}
			],
			analysis: {
				totalFiles: 3,
				completedFiles: 3,
				byFile: {
					'src/runtime/retry-policy.ts': {
						noop: 0.03,
						relevance: 0.98,
						keyLogic: 0.96,
						reviewRisk: 0.91
					},
					'src/runtime/request.ts': {
						noop: 0.08,
						relevance: 0.94,
						keyLogic: 0.83,
						reviewRisk: 0.72
					},
					'tests/retry-policy.test.ts': {
						noop: 0.12,
						relevance: 0.86,
						keyLogic: 0.76,
						reviewRisk: 0.71
					}
				}
			},
			classifier: {
				provider: 'TypeSafe AI',
				endpoint: 'https://api.typesafe.ai/v1/systemone',
				requestedModel: 'jev-latest',
				resolvedModels: ['jev-1.13.0'],
				batches: [
					{
						index: 0,
						filenames: [
							'src/runtime/retry-policy.ts',
							'src/runtime/request.ts',
							'tests/retry-policy.test.ts'
						],
						status: 'complete',
						startedAt: '2026-09-24T11:00:01.000Z',
						completedAt: '2026-09-24T11:00:03.000Z'
					}
				],
				usage: { inputTokens: 3210, outputTokens: 244 }
			},
			raw: { collection: {}, typesafeResponses: [] },
			error: null
		}
	});
});

await page.reload();
await page.locator('#typesafe-key').waitFor();
await page.screenshot({ path: '/tmp/beef-settings.png', fullPage: true });
await page.locator('[data-tab="history"]').click();
await page.locator('#run-history').waitFor();
await page.screenshot({ path: '/tmp/beef-history.png', fullPage: true });

const review = await context.newPage();
await review.goto(`chrome-extension://${extensionId}/review/index.html`);
await review.setViewportSize({ width: 1440, height: 1000 });
await review.locator('.diff-card').first().waitFor();
const paneMetrics = await review
	.locator('.diff-card')
	.first()
	.locator('.diff-pane')
	.evaluateAll((panes) =>
		panes.map((pane) => ({
			clientWidth: pane.clientWidth,
			scrollWidth: pane.scrollWidth,
			left: pane.getBoundingClientRect().left,
			right: pane.getBoundingClientRect().right
		}))
	);
assert.equal(paneMetrics.length, 2);
assert.ok(paneMetrics.every(({ clientWidth, scrollWidth }) => scrollWidth > clientWidth));
assert.ok(paneMetrics[0].right <= paneMetrics[1].left + 1);
const independentScroll = await review
	.locator('.diff-card')
	.first()
	.locator('.diff-pane')
	.evaluateAll((panes) => {
		panes[0].scrollLeft = 200;
		return panes.map((pane) => pane.scrollLeft);
	});
assert.ok(independentScroll[0] > 0);
assert.equal(independentScroll[1], 0);
const addedCard = review.locator('.diff-card[data-layout="full"]');
assert.equal(await addedCard.count(), 1);
assert.equal(await addedCard.locator('.diff-pane').count(), 1);
const fullWidthMetrics = await addedCard.evaluate((card) => {
	const table = card.querySelector('.diff-table');
	const pane = card.querySelector('.diff-pane');
	return { tableWidth: table.clientWidth, paneWidth: pane.clientWidth };
});
assert.ok(Math.abs(fullWidthMetrics.tableWidth - fullWidthMetrics.paneWidth) <= 1);
assert.ok((await addedCard.locator('.syntax-keyword').count()) >= 2);
assert.equal(await review.locator('#file-nav a.is-current').count(), 1);
assert.equal(await review.locator('#file-nav a.is-current').getAttribute('href'), '#review-file-1');
await review.setViewportSize({ width: 1440, height: 400 });
await review.locator('#review-file-2').evaluate((card) => {
	window.scrollTo(0, window.scrollY + card.getBoundingClientRect().top - 68);
});
await review.waitForFunction(
	() => document.querySelector('#file-nav a.is-current')?.getAttribute('href') === '#review-file-2'
);
assert.equal(
	await review.locator('#file-nav a.is-current').getAttribute('aria-current'),
	'location'
);
await review.setViewportSize({ width: 1440, height: 1000 });
await review.evaluate(() => window.scrollTo(0, 0));
await review.screenshot({ path: '/tmp/beef-review.png', fullPage: true });

const popup = await context.newPage();
await popup.setViewportSize({ width: 310, height: 220 });
await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
await popup.locator('#review').waitFor();
await popup.screenshot({ path: '/tmp/beef-popup.png', fullPage: true });
const popupStatus = await popup.locator('#status').innerText();
const popupButtons = await popup.locator('main button').count();

const settingsPageOpened = context.waitForEvent('page');
await popup.locator('#settings').click();
const settingsPage = await settingsPageOpened;
await settingsPage.locator('#typesafe-key').waitFor();

console.log(
	JSON.stringify({
		extensionId,
		title: await page.title(),
		historyTitle: await page.locator('#run-title').innerText(),
		popupStatus,
		popupButtons,
		settingsOpened: settingsPage.url().includes('/sidepanel/index.html'),
		reviewFiles: await review.locator('.diff-card').count(),
		screenshots: [
			'/tmp/beef-settings.png',
			'/tmp/beef-history.png',
			'/tmp/beef-popup.png',
			'/tmp/beef-review.png'
		]
	})
);
await context.close();
