import { METRICS, MODEL, TYPESAFE_ENDPOINT } from './constants.js';

const NOOP_CRITERIA = {
	true: 'The change is mainly text or copy, tests and fixtures, snapshots, low-logic presentation UI, generated or repetitive scaffolding, formatting, mechanical configuration, or another change with little production decision logic.',
	false:
		'The change contains meaningful production behavior, domain rules, data flow, state transitions, integrations, security boundaries, migrations, or operational logic that deserves careful review.'
};

export function buildQuestions(files) {
	const questions = {};
	const mapping = {};

	files.forEach((file, index) => {
		const prefix = `f${index}`;
		mapping[prefix] = file.filename;
		const reference = `state.files[${index}]`;

		questions[`${prefix}__noop`] = {
			type: 'noul',
			instructions: `Does ${reference} mainly contain no-op-like or low-logic work for purposes of prioritizing a pull-request review? Judge the changed content, not only the filename.`,
			criteria: NOOP_CRITERIA
		};
		questions[`${prefix}__relevance`] = {
			type: 'noul',
			instructions: `Is the change in ${reference} highly relevant to the intent stated in state.pull_request.title and state.pull_request.description?`,
			criteria: {
				true: 'It directly implements, enables, validates, or necessarily supports the stated PR intent.',
				false:
					'It is incidental, unrelated, unexplained scope expansion, or only weakly connected to the stated PR intent.'
			}
		};
		questions[`${prefix}__key_logic`] = {
			type: 'noul',
			instructions: `Does ${reference} contain implementation logic that is key to delivering the behavior promised by state.pull_request.title and state.pull_request.description?`,
			criteria: {
				true: 'The PR would be incomplete, substantially incorrect, or unable to deliver its central behavior without the logic changed here.',
				false:
					'The change is ancillary, presentational, test-only, documentation, scaffolding, or not central to the promised behavior.'
			}
		};
		questions[`${prefix}__review_risk`] = {
			type: 'noul',
			instructions: `Would a responsible reviewer plausibly be in trouble if ${reference} merged without their review and a defect in this change later caused breakage?`,
			criteria: {
				true: 'A defect could materially harm users, data, money, privacy, security, availability, core correctness, compliance, or incident response, or would be difficult to detect or roll back.',
				false:
					'A defect would be low-impact, obvious, isolated, easily reversible, or limited to non-production material.'
			}
		};
	});

	return { questions, mapping };
}

export function buildJevRequest(pr, files, model = MODEL) {
	const normalizedFiles = files.map((file) => ({
		filename: file.filename,
		previous_filename: file.previousFilename || null,
		status: file.status,
		sha: file.sha || null,
		additions: file.additions,
		deletions: file.deletions,
		changes: file.changes,
		blob_url: file.blobUrl || null,
		raw_url: file.rawUrl || null,
		collection_sources: file.collectionSources || [],
		patch:
			file.patch || file.renderedDiff || '[Diff unavailable: binary, too large, or not rendered]',
		patch_truncated: Boolean(file.truncated),
		is_binary: Boolean(file.binary)
	}));
	const { questions, mapping } = buildQuestions(normalizedFiles);

	return {
		payload: {
			model,
			state: {
				pull_request: {
					repository: `${pr.owner}/${pr.repo}`,
					number: pr.number,
					title: pr.title,
					description: pr.description,
					author: pr.author,
					labels: pr.labels,
					base_branch: pr.base,
					head_branch: pr.head,
					draft: pr.draft,
					additions: pr.additions,
					deletions: pr.deletions,
					changed_files: pr.changedFiles,
					commits: pr.commits,
					comments: pr.comments,
					review_comments: pr.reviewComments,
					url: pr.url
				},
				files: normalizedFiles
			},
			questions
		},
		mapping
	};
}

function retryDelay(attempt, retryAfter) {
	const serverDelay = Number(retryAfter);
	if (Number.isFinite(serverDelay) && serverDelay > 0) return Math.min(serverDelay * 1000, 30_000);
	return 600 * 2 ** attempt + Math.floor(Math.random() * 250);
}

export async function evaluateWithJev(payload, apiKey, { attempts = 3 } = {}) {
	if (!apiKey) throw new Error('Add a TypeSafe API key in Settings before grading this PR.');

	let lastError;
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			const response = await fetch(TYPESAFE_ENDPOINT, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(payload)
			});

			if (response.ok) return await response.json();

			const body = await response.text();
			const message = body ? body.slice(0, 800) : response.statusText;
			const error = new Error(`TypeSafe API ${response.status}: ${message}`);
			error.status = response.status;
			error.responseBody = body;
			if (
				![408, 429, 500, 502, 503, 504, 529].includes(response.status) ||
				attempt === attempts - 1
			) {
				throw error;
			}
			lastError = error;
			await new Promise((resolve) =>
				setTimeout(resolve, retryDelay(attempt, response.headers.get('retry-after')))
			);
		} catch (error) {
			lastError = error;
			if (attempt === attempts - 1 || String(error?.message || '').startsWith('TypeSafe API 4'))
				throw error;
			await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
		}
	}
	throw lastError || new Error('TypeSafe request failed.');
}

export function answersForFiles(files, response) {
	return Object.fromEntries(
		files.map((file, index) => {
			const value = {};
			for (const metric of METRICS) {
				const answer = response.answers?.[`f${index}__${metric.answerSuffix}`];
				value[metric.key] = typeof answer?.noul === 'number' ? answer.noul : null;
			}
			return [file.filename, value];
		})
	);
}

export function isOversizedJevError(error) {
	if (error?.status === 413) return true;
	if ([401, 403, 429].includes(error?.status)) return false;

	const message = `${error?.message || ''} ${error?.responseBody || ''}`
		.toLowerCase()
		.replace(/[_-]+/g, ' ')
		.replace(/\s+/g, ' ');

	return [
		/\b(?:payload|request|body|input|context|state|content)\s+(?:is\s+)?too\s+(?:large|long)\b/,
		/\btoo\s+many\s+(?:input\s+)?tokens?\b/,
		/\b(?:max(?:imum)?\s+)?tokens?\s+(?:limit\s+)?exceeded\b/,
		/\b(?:max(?:imum)?\s+)?(?:input|context)\s+tokens?\s+(?:limit\s+)?exceeded\b/,
		/\bcontext\s+length\s+(?:limit\s+)?exceeded\b/,
		/\bmaximum\s+context\s+length\b/,
		/\b(?:input|request|payload|context)\s+(?:length|size)\s+(?:limit\s+)?exceeded\b/,
		/\bmax(?:imum)?\s+(?:input\s+)?tokens?\b/
	].some((pattern) => pattern.test(message));
}

export function splitFilesByWeight(files) {
	if (files.length < 2) return [files];
	const weights = files.map(
		(file) => (file.patch || file.renderedDiff || '').length + file.filename.length
	);
	const target = weights.reduce((total, weight) => total + weight, 0) / 2;
	let running = 0;
	let splitAt = 1;
	for (let index = 0; index < weights.length - 1; index += 1) {
		running += weights[index];
		splitAt = index + 1;
		if (running >= target) break;
	}
	return [files.slice(0, splitAt), files.slice(splitAt)];
}
