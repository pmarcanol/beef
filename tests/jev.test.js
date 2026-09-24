import assert from 'node:assert/strict';
import test from 'node:test';

import {
	isPullRequestOverviewUrl,
	mergeCollectedData,
	parsePullRequestUrl,
	parseUnifiedDiff
} from '../lib/github.js';
import { highlightTokens, languageForFilename } from '../lib/highlight.js';
import {
	answersForFiles,
	buildJevRequest,
	buildQuestions,
	isOversizedJevError,
	splitFilesByWeight
} from '../lib/jev.js';
import {
	adjustedReviewSignals,
	reviewDiffLines,
	reviewDiffRows,
	selectReviewFiles
} from '../lib/review.js';
import { initialState, summarizeState } from '../lib/state.js';
import { buildVirtualOffsets, virtualIndexAtOffset, virtualRange } from '../lib/virtual.js';

const pr = {
	owner: 'openai',
	repo: 'codex',
	number: 42,
	title: 'Add safer retries',
	description: 'Retry transient API failures without duplicating writes.',
	author: 'pablo',
	labels: ['reliability'],
	base: 'main',
	head: 'retry-policy',
	draft: false,
	additions: 30,
	deletions: 4,
	changedFiles: 2,
	commits: 1,
	comments: 0,
	reviewComments: 2,
	url: 'https://github.com/openai/codex/pull/42'
};

const files = [
	{
		filename: 'src/retry.ts',
		status: 'modified',
		sha: 'abc',
		additions: 28,
		deletions: 4,
		changes: 32,
		patch: '@@ -1 +1 @@\n-retry(1)\n+retry({ attempts: 3, idempotent: true })',
		blobUrl: 'https://github.com/openai/codex/blob/abc/src/retry.ts',
		collectionSources: ['github-dot-diff']
	},
	{
		filename: 'README.md',
		status: 'modified',
		additions: 2,
		deletions: 0,
		changes: 2,
		patch: '@@ -1 +1 @@\n+Retries are safer now.'
	}
];

test('parses a GitHub PR URL from overview and files views', () => {
	assert.deepEqual(
		parsePullRequestUrl('https://github.com/openai/codex/pull/42/files?diff=split'),
		{
			owner: 'openai',
			repo: 'codex',
			number: 42,
			baseUrl: 'https://github.com/openai/codex/pull/42',
			diffUrl: 'https://github.com/openai/codex/pull/42.diff',
			filesUrl: 'https://github.com/openai/codex/pull/42/files'
		}
	);
	const ref = parsePullRequestUrl('https://github.com/openai/codex/pull/42');
	assert.equal(
		isPullRequestOverviewUrl(
			'https://github.com/openai/codex/pull/42?notification_referrer_id=1',
			ref
		),
		true
	);
	assert.equal(
		isPullRequestOverviewUrl('https://github.com/openai/codex/pull/42/files', ref),
		false
	);
	assert.equal(parsePullRequestUrl('https://github.com/openai/codex/issues/42'), null);
});

test('builds six independent Noul questions for every file', () => {
	const { questions, mapping } = buildQuestions(files);
	assert.equal(Object.keys(questions).length, 12);
	assert.equal(questions.f0__noop.type, 'noul');
	assert.equal(questions.f0__relevance.type, 'noul');
	assert.equal(questions.f0__key_logic.type, 'noul');
	assert.equal(questions.f0__review_risk.type, 'noul');
	assert.equal(questions.f0__validation_catch.type, 'noul');
	assert.match(questions.f0__validation_catch.instructions, /ordinary validation/);
	assert.equal(questions.f0__database_risk.type, 'noul');
	assert.match(questions.f0__database_risk.criteria.true, /Additive tables and columns/);
	assert.match(questions.f1__noop.instructions, /state\.files\[1\]/);
	assert.equal(mapping.f1, 'README.md');
});

test('sends rich PR and file evidence in Jev state', () => {
	const { payload } = buildJevRequest(pr, files);
	assert.equal(payload.model, 'jev-latest');
	assert.equal(payload.state.pull_request.description, pr.description);
	assert.equal(payload.state.pull_request.review_comments, 2);
	assert.equal(payload.state.files[0].sha, 'abc');
	assert.equal(payload.state.files[0].patch, files[0].patch);
	assert.deepEqual(payload.state.files[0].collection_sources, ['github-dot-diff']);
});

test('splits a GitHub unified diff into complete file records', () => {
	const unifiedDiff = `diff --git a/src/retry.ts b/src/retry.ts
index 91a2ee1..3fc9b88 100644
--- a/src/retry.ts
+++ b/src/retry.ts
@@ -1,2 +1,3 @@
-retry(1)
+retry(3)
+useIdempotencyKey()
 keep()
diff --git a/old-name.ts b/new-name.ts
similarity index 100%
rename from old-name.ts
rename to new-name.ts
diff --git a/assets/logo.png b/assets/logo.png
new file mode 100644
index 0000000..d3adb33
Binary files /dev/null and b/assets/logo.png differ
`;
	const parsed = parseUnifiedDiff(unifiedDiff);
	assert.equal(parsed.length, 3);
	assert.deepEqual(
		parsed.map(({ filename, previousFilename, status, additions, deletions, binary }) => ({
			filename,
			previousFilename,
			status,
			additions,
			deletions,
			binary
		})),
		[
			{
				filename: 'src/retry.ts',
				previousFilename: null,
				status: 'modified',
				additions: 2,
				deletions: 1,
				binary: false
			},
			{
				filename: 'new-name.ts',
				previousFilename: 'old-name.ts',
				status: 'renamed',
				additions: 0,
				deletions: 0,
				binary: false
			},
			{
				filename: 'assets/logo.png',
				previousFilename: null,
				status: 'added',
				additions: 0,
				deletions: 0,
				binary: true
			}
		]
	);
	assert.match(parsed[0].patch, /^diff --git a\/src\/retry\.ts/m);
	assert.deepEqual(parsed[0].collectionSources, ['github-dot-diff']);
});

test('splits only after an oversized Jev error and balances patch weight', () => {
	const tooLarge = Object.assign(new Error('payload too large'), { status: 413 });
	const tokenLimit = Object.assign(
		new Error('TypeSafe API 400: {"detail":"max-tokens exceeded"}'),
		{
			status: 400,
			responseBody: '{"detail":"max-tokens exceeded"}'
		}
	);
	const snakeCaseLimit = Object.assign(new Error('request failed'), {
		status: 422,
		responseBody: '{"code":"context_length_exceeded"}'
	});
	const upstreamLimit = Object.assign(new Error('maximum input tokens exceeded'), {
		status: 500
	});
	const validation = Object.assign(new Error('missing required field'), { status: 422 });
	const invalidKey = Object.assign(new Error('invalid API token'), { status: 401 });
	const rateLimit = Object.assign(new Error('token limit exceeded'), { status: 429 });
	assert.equal(isOversizedJevError(tooLarge), true);
	assert.equal(isOversizedJevError(tokenLimit), true);
	assert.equal(isOversizedJevError(snakeCaseLimit), true);
	assert.equal(isOversizedJevError(upstreamLimit), true);
	assert.equal(isOversizedJevError(validation), false);
	assert.equal(isOversizedJevError(invalidKey), false);
	assert.equal(isOversizedJevError(rateLimit), false);

	const weighted = [
		{ filename: 'large.ts', patch: 'x'.repeat(100) },
		{ filename: 'small-a.ts', patch: 'x'.repeat(10) },
		{ filename: 'small-b.ts', patch: 'x'.repeat(10) }
	];
	assert.deepEqual(
		splitFilesByWeight(weighted).map((batch) => batch.map((file) => file.filename)),
		[['large.ts'], ['small-a.ts', 'small-b.ts']]
	);
});

test('maps raw Noul answers back to filenames', () => {
	const response = {
		answers: {
			f0__noop: { type: 'noul', noul: 0.05 },
			f0__relevance: { type: 'noul', noul: 0.97 },
			f0__key_logic: { type: 'noul', noul: 0.91 },
			f0__review_risk: { type: 'noul', noul: 0.82 },
			f0__validation_catch: { type: 'noul', noul: 0.9 },
			f0__database_risk: { type: 'noul', noul: 0.02 }
		}
	};
	const multiplier = 1 - 0.9 * 0.7;
	assert.deepEqual(answersForFiles([files[0]], response)['src/retry.ts'], {
		noop: 0.05,
		relevance: 0.97,
		keyLogic: 0.91,
		reviewRisk: 0.82,
		validationCatch: 0.9,
		databaseRisk: 0.02,
		adjustedReviewRisk: 0.82 * multiplier,
		adjustedKeyLogic: 0.91 * multiplier,
		reviewCriticality: 0.91 * multiplier
	});
});

test('database schema and data changes bypass the validation discount', () => {
	const migrationSignals = {
		noop: 0.05,
		relevance: 0.88,
		keyLogic: 0.4,
		reviewRisk: 0.5,
		validationCatch: 0.98,
		databaseRisk: 0.93
	};
	const adjusted = adjustedReviewSignals(migrationSignals);
	assert.equal(adjusted.reviewCriticality, 0.93);
	const selected = selectReviewFiles({
		files: [{ filename: 'migrations/20260924_add_account_status.sql' }],
		analysis: {
			byFile: {
				'migrations/20260924_add_account_status.sql': migrationSignals
			}
		}
	});
	assert.equal(selected.length, 1);
	assert.equal(selected[0].tier.key, 'database');
	assert.equal(selected[0].tier.label, 'Database risk');
});

test('lowers review criticality when ordinary validation is likely to catch a defect', () => {
	const cssSignals = {
		noop: 0.82,
		relevance: 0.9,
		keyLogic: 0.86,
		reviewRisk: 0.91,
		validationCatch: 0.95
	};
	const adjusted = adjustedReviewSignals(cssSignals);
	assert.ok(adjusted.adjustedReviewRisk < 0.4);
	assert.ok(adjusted.adjustedKeyLogic < 0.4);
	assert.equal(
		selectReviewFiles({
			files: [{ filename: 'styles/layout.css' }],
			analysis: { byFile: { 'styles/layout.css': cssSignals } }
		}).length,
		0
	);
	assert.equal(
		selectReviewFiles({
			files: [{ filename: 'src/payments.ts' }],
			analysis: {
				byFile: {
					'src/payments.ts': { ...cssSignals, validationCatch: 0.05, noop: 0.02 }
				}
			}
		}).length,
		1
	);
});

test('selects syntax highlighting from the filename', () => {
	assert.deepEqual(languageForFilename('src/retry-policy.ts'), {
		id: 'typescript',
		label: 'TypeScript'
	});
	assert.deepEqual(languageForFilename('Dockerfile'), { id: 'shell', label: 'Dockerfile' });
	assert.equal(
		highlightTokens('const retries = 3 // bounded', 'typescript')
			.filter(({ type }) => type !== 'plain')
			.map(({ type, text }) => `${type}:${text}`)
			.join('|'),
		'keyword:const|number:3|comment:// bounded'
	);
});

test('calculates a bounded virtual review window', () => {
	const offsets = buildVirtualOffsets(Array.from({ length: 100 }, () => 200));
	assert.equal(offsets.at(-1), 20_000);
	assert.equal(virtualIndexAtOffset(offsets, 0), 0);
	assert.equal(virtualIndexAtOffset(offsets, 2_050), 10);
	assert.deepEqual(virtualRange(offsets, 10_000, 800, 400), { start: 48, end: 57 });
});

test('merges browser-page metadata with the raw .diff collection', () => {
	const ref = parsePullRequestUrl(pr.url);
	const merged = mergeCollectedData(
		ref,
		{
			diffUrl: ref.diffUrl,
			text: files.map((file) => file.patch).join('\n'),
			files
		},
		{ pr, pageUrl: pr.url, capturedAt: '2026-09-24T11:00:00.000Z' }
	);
	assert.equal(merged.pr.title, pr.title);
	assert.equal(merged.raw.diffUrl, 'https://github.com/openai/codex/pull/42.diff');
	assert.equal(merged.files[0].filename, 'src/retry.ts');
	assert.deepEqual(merged.files[0].collectionSources, ['github-dot-diff']);
});

test('summarizes review outcomes without changing raw probabilities', () => {
	const state = initialState({
		files,
		analysis: {
			totalFiles: 2,
			completedFiles: 2,
			byFile: {
				'src/retry.ts': { noop: 0.05, relevance: 0.97, keyLogic: 0.91, reviewRisk: 0.82 },
				'README.md': { noop: 0.95, relevance: 0.7, keyLogic: 0.02, reviewRisk: 0.04 }
			}
		}
	});
	assert.deepEqual(summarizeState(state), {
		files: 2,
		mustReview: 1,
		keyLogic: 1,
		mostlyNoop: 1,
		usage: { inputTokens: 0, outputTokens: 0 }
	});
});

test('selects only risky or key-logic files for the static review', () => {
	const state = initialState({
		files: [
			...files,
			{ filename: 'src/secondary.ts', patch: '+secondary', additions: 1, deletions: 0 }
		],
		analysis: {
			byFile: {
				'src/retry.ts': { noop: 0.05, relevance: 0.97, keyLogic: 0.91, reviewRisk: 0.82 },
				'README.md': { noop: 0.95, relevance: 0.7, keyLogic: 0.02, reviewRisk: 0.04 },
				'src/secondary.ts': { noop: 0.1, relevance: 0.8, keyLogic: 0.72, reviewRisk: 0.4 }
			}
		}
	});
	const selected = selectReviewFiles(state);
	assert.deepEqual(
		selected.map(({ file, tier }) => [file.filename, tier.key]),
		[
			['src/retry.ts', 'risk'],
			['src/secondary.ts', 'key']
		]
	);
});

test('removes transport headers and retains reviewable numbered diff lines', () => {
	const patch = `diff --git a/src/retry.ts b/src/retry.ts
index 91a2ee1..3fc9b88 100644
--- a/src/retry.ts
+++ b/src/retry.ts
@@ -7,2 +7,3 @@ function retry() {
-  once()
+  threeTimes()
+  withIdempotency()
   return true
`;
	const lines = reviewDiffLines(patch);
	assert.deepEqual(lines, [
		{
			kind: 'hunk',
			text: '@@ -7,2 +7,3 @@ function retry() {',
			oldLine: null,
			newLine: null
		},
		{ kind: 'deletion', text: '  once()', oldLine: 7, newLine: null },
		{ kind: 'addition', text: '  threeTimes()', oldLine: null, newLine: 7 },
		{ kind: 'addition', text: '  withIdempotency()', oldLine: null, newLine: 8 },
		{ kind: 'context', text: '  return true', oldLine: 8, newLine: 9 }
	]);
	assert.deepEqual(reviewDiffRows(patch), [
		{ kind: 'hunk', text: '@@ -7,2 +7,3 @@ function retry() {' },
		{
			kind: 'change',
			left: { kind: 'deletion', text: '  once()', oldLine: 7, newLine: null },
			right: { kind: 'addition', text: '  threeTimes()', oldLine: null, newLine: 7 }
		},
		{
			kind: 'change',
			left: { kind: 'empty', text: '', oldLine: null },
			right: { kind: 'addition', text: '  withIdempotency()', oldLine: null, newLine: 8 }
		},
		{
			kind: 'context',
			left: { kind: 'context', text: '  return true', oldLine: 8, newLine: 9 },
			right: { kind: 'context', text: '  return true', oldLine: 8, newLine: 9 }
		}
	]);
});
