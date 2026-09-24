export const REVIEW_THRESHOLD = 0.65;

export function reviewPriority(result = {}) {
	return (
		(result.reviewRisk || 0) * 4 +
		(result.keyLogic || 0) * 2 +
		(result.relevance || 0) -
		(result.noop || 0)
	);
}

export function reviewTier(result = {}) {
	if ((result.reviewRisk || 0) >= REVIEW_THRESHOLD) return { key: 'risk', label: 'Must review' };
	if ((result.keyLogic || 0) >= REVIEW_THRESHOLD) return { key: 'key', label: 'Key logic' };
	return { key: 'skip', label: 'Not selected' };
}

export function selectReviewFiles(state) {
	const analysis = state?.analysis?.byFile || {};
	return (state?.files || [])
		.map((file) => ({ file, result: analysis[file.filename] || {} }))
		.filter(
			({ result }) =>
				(result.reviewRisk || 0) >= REVIEW_THRESHOLD || (result.keyLogic || 0) >= REVIEW_THRESHOLD
		)
		.sort((left, right) => reviewPriority(right.result) - reviewPriority(left.result))
		.map((entry) => ({ ...entry, tier: reviewTier(entry.result) }));
}

function isTransportHeader(line) {
	return (
		line.startsWith('diff --git ') ||
		line.startsWith('index ') ||
		/^--- (?:a\/|\/dev\/null|")/.test(line) ||
		/^\+\+\+ (?:b\/|\/dev\/null|")/.test(line)
	);
}

function hunkStart(line) {
	const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
	return match ? { oldLine: Number(match[1]), newLine: Number(match[2]) } : null;
}

export function reviewDiffLines(patch = '') {
	const output = [];
	let oldLine = null;
	let newLine = null;

	for (const text of String(patch).replace(/\r\n/g, '\n').split('\n')) {
		if (isTransportHeader(text)) continue;
		const start = hunkStart(text);
		if (start) {
			oldLine = start.oldLine;
			newLine = start.newLine;
			output.push({ kind: 'hunk', text, oldLine: null, newLine: null });
			continue;
		}
		if (text.startsWith('+')) {
			output.push({ kind: 'addition', text: text.slice(1), oldLine: null, newLine });
			newLine += 1;
			continue;
		}
		if (text.startsWith('-')) {
			output.push({ kind: 'deletion', text: text.slice(1), oldLine, newLine: null });
			oldLine += 1;
			continue;
		}
		if (text.startsWith(' ') && oldLine !== null && newLine !== null) {
			output.push({ kind: 'context', text: text.slice(1), oldLine, newLine });
			oldLine += 1;
			newLine += 1;
			continue;
		}
		if (text) output.push({ kind: 'meta', text, oldLine: null, newLine: null });
	}
	return output;
}

export function reviewDiffRows(patch = '') {
	const rows = [];
	let deletions = [];
	let additions = [];

	function flushChanges() {
		const count = Math.max(deletions.length, additions.length);
		for (let index = 0; index < count; index += 1) {
			rows.push({
				kind: 'change',
				left: deletions[index] || { kind: 'empty', text: '', oldLine: null },
				right: additions[index] || { kind: 'empty', text: '', newLine: null }
			});
		}
		deletions = [];
		additions = [];
	}

	for (const line of reviewDiffLines(patch)) {
		if (line.kind === 'deletion') {
			deletions.push(line);
			continue;
		}
		if (line.kind === 'addition') {
			additions.push(line);
			continue;
		}
		flushChanges();
		if (line.kind === 'context') {
			rows.push({ kind: 'context', left: line, right: line });
		} else {
			rows.push({ kind: line.kind, text: line.text });
		}
	}
	flushChanges();
	return rows;
}
