import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const storeDirectory = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(storeDirectory, '..');
const assetsPath = path.join(storeDirectory, 'assets');

const context = await chromium.launchPersistentContext('', {
	channel: 'chromium',
	headless: true,
	viewport: { width: 1280, height: 800 },
	args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
});

let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker');
const extensionId = new URL(worker.url()).host;
const page = await context.newPage();
await page.goto(`chrome-extension://${extensionId}/review/index.html`);
await page.evaluate(async () => {
	const files = [
		{
			filename: 'src/runtime/retry-policy.ts',
			status: 'modified',
			additions: 3,
			deletions: 1,
			patch:
				'diff --git a/src/runtime/retry-policy.ts b/src/runtime/retry-policy.ts\n--- a/src/runtime/retry-policy.ts\n+++ b/src/runtime/retry-policy.ts\n@@ -10,2 +10,4 @@ export function retry() {\n-  return once(request)\n+  const key = idempotencyKey(request)\n+  assertSafeRetry(request)\n+  return retryThreeTimes(request, key)\n }'
		},
		{
			filename: 'src/runtime/request.ts',
			status: 'modified',
			additions: 2,
			deletions: 0,
			patch:
				'diff --git a/src/runtime/request.ts b/src/runtime/request.ts\n--- a/src/runtime/request.ts\n+++ b/src/runtime/request.ts\n@@ -4,2 +4,4 @@ export async function request() {\n+  assertIdempotent(options)\n+  const trace = createRetryTrace(options)\n   return transport.send(options)\n }'
		},
		{
			filename: 'src/runtime/retry-errors.ts',
			status: 'added',
			additions: 3,
			deletions: 0,
			patch:
				'diff --git a/src/runtime/retry-errors.ts b/src/runtime/retry-errors.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/runtime/retry-errors.ts\n@@ -0,0 +1,3 @@\n+export class UnsafeRetryError extends Error {}\n+export const RETRY_LIMIT = 3\n+export const RETRYABLE = new Set([408, 429, 503])'
		}
	];
	const byFile = Object.fromEntries(
		files.map((file, index) => [
			file.filename,
			{
				noop: 0.03 + index * 0.03,
				relevance: 0.98 - index * 0.03,
				keyLogic: 0.96 - index * 0.06,
				reviewRisk: 0.91 - index * 0.08,
				validationCatch: 0.12 + index * 0.04,
				databaseRisk: 0.01,
				reviewCriticality: 0.88 - index * 0.08
			}
		])
	);
	await chrome.storage.local.set({
		beefState: {
			schemaVersion: 1,
			appVersion: '1.3.0',
			phase: 'complete',
			startedAt: '2026-09-24T11:00:00.000Z',
			updatedAt: '2026-09-24T11:00:03.000Z',
			completedAt: '2026-09-24T11:00:03.000Z',
			pr: {
				owner: 'openai',
				repo: 'codex',
				number: 4242,
				title: 'Make retries safe under concurrent writes',
				url: 'https://github.com/openai/codex/pull/4242'
			},
			files,
			analysis: { totalFiles: files.length, completedFiles: files.length, byFile },
			classifier: { batches: [], usage: { inputTokens: 3210, outputTokens: 244 } },
			raw: { collection: null, typesafeResponses: [] },
			error: null
		}
	});
});
await page.reload();
await page.locator('.diff-card').first().waitFor();
await page.screenshot({ path: path.join(assetsPath, 'screenshot-review-1280x800.png') });

const promo = await context.newPage();
await promo.setViewportSize({ width: 440, height: 280 });
await promo.goto(pathToFileURL(path.join(storeDirectory, 'promo.html')).toString());
await promo.screenshot({ path: path.join(assetsPath, 'small-promo-440x280.png') });

await context.close();
