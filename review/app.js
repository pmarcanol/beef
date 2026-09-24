import { STATE_KEY } from '../lib/constants.js';
import { highlightTokens, languageForFilename } from '../lib/highlight.js';
import { reviewDiffRows, selectReviewFiles } from '../lib/review.js';

const REVIEW_METRICS = [
	{ key: 'reviewRisk', label: 'Risk' },
	{ key: 'keyLogic', label: 'Key' },
	{ key: 'relevance', label: 'Relevant' },
	{ key: 'noop', label: 'No-op' }
];

const elements = Object.fromEntries(
	[
		'github-link',
		'copy-review',
		'refresh-review',
		'running-state',
		'running-title',
		'running-detail',
		'progress-bar',
		'review-hero',
		'pr-identity',
		'pr-title',
		'omitted-count',
		'review-layout',
		'file-nav',
		'diff-stack',
		'empty-state',
		'empty-title',
		'empty-copy'
	].map((id) => [id, document.getElementById(id)])
);

let state = null;
let selected = [];
let currentFileIndex = -1;
let scrollFrame = null;

function node(tag, className, text) {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = text;
	return element;
}

function percent(value) {
	return typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';
}

function highlightedCode(text, language) {
	const code = node('span', 'line-code');
	for (const token of highlightTokens(text, language)) {
		if (token.type === 'plain') code.append(document.createTextNode(token.text));
		else code.append(node('span', `syntax-${token.type}`, token.text));
	}
	return code;
}

function paneRow(rowData, column, language) {
	const row = node('div', 'pane-row');
	if (rowData.kind === 'hunk' || rowData.kind === 'meta') {
		row.dataset.kind = rowData.kind;
		row.append(node('span', 'pane-note', rowData.text));
		return row;
	}
	const side = rowData[column];
	row.dataset.kind = side.kind;
	const lineNumber = column === 'left' ? side.oldLine : side.newLine;
	row.append(node('span', 'line-number', lineNumber ?? ''), highlightedCode(side.text, language));
	return row;
}

function diffPane(rows, column, language) {
	const pane = node('div', 'diff-pane');
	pane.setAttribute('aria-label', column === 'left' ? 'Before changes' : 'After changes');
	const content = node('div', 'diff-pane-content');
	content.append(...rows.map((row) => paneRow(row, column, language)));
	pane.append(content);
	return pane;
}

function fileCard(entry, index) {
	const { file, result, tier } = entry;
	const language = languageForFilename(file.filename);
	const isAddedFile = file.status === 'added';
	const card = node('article', 'diff-card');
	card.id = `review-file-${index + 1}`;
	card.dataset.tier = tier.key;
	card.dataset.language = language.id;
	card.dataset.layout = isAddedFile ? 'full' : 'split';

	const header = node('header', 'file-header');
	const identity = document.createElement('div');
	identity.append(node('h2', '', file.filename));
	const meta = node('div', 'file-meta');
	meta.append(
		node('span', '', file.status || 'modified'),
		node('span', 'language-label', language.label),
		node('span', 'addition-count', `+${file.additions || 0}`),
		node('span', 'deletion-count', `−${file.deletions || 0}`)
	);
	if (file.previousFilename) meta.append(node('span', '', `from ${file.previousFilename}`));
	identity.append(meta);
	header.append(identity, node('span', 'tier-badge', tier.label));

	const scores = node('div', 'score-strip');
	for (const metric of REVIEW_METRICS) {
		const pill = node('span', 'score-pill', metric.label);
		pill.append(node('strong', '', percent(result[metric.key])));
		scores.append(pill);
	}

	const diff = node('div', `diff-table${isAddedFile ? ' diff-table--full' : ''}`);
	if (file.binary) {
		diff.append(
			node('div', 'binary-notice', 'Binary change — inspect the asset directly on GitHub.')
		);
	} else {
		const rows = reviewDiffRows(file.patch);
		if (rows.length) {
			if (isAddedFile) diff.append(diffPane(rows, 'right', language.id));
			else diff.append(diffPane(rows, 'left', language.id), diffPane(rows, 'right', language.id));
		} else
			diff.append(node('div', 'missing-notice', 'No textual patch is available for this file.'));
	}

	card.append(header, scores, diff);
	return card;
}

function renderEmpty(title, copy) {
	currentFileIndex = -1;
	elements['running-state'].hidden = true;
	elements['review-hero'].hidden = true;
	elements['review-layout'].hidden = true;
	elements['empty-state'].hidden = false;
	elements['empty-title'].textContent = title;
	elements['empty-copy'].textContent = copy;
}

function renderRunning() {
	currentFileIndex = -1;
	elements['running-state'].hidden = false;
	elements['review-hero'].hidden = true;
	elements['review-layout'].hidden = true;
	elements['empty-state'].hidden = true;
	const collecting = state?.phase === 'collecting';
	const complete = state?.analysis?.completedFiles || 0;
	const total = state?.analysis?.totalFiles || 0;
	elements['running-title'].textContent = collecting ? 'Reading diff…' : 'Classifying files…';
	elements['running-detail'].textContent = collecting ? 'GitHub .diff' : `${complete} / ${total}`;
	elements['progress-bar'].style.width = collecting
		? '8%'
		: `${total ? Math.max(12, (complete / total) * 100) : 12}%`;
}

function setCurrentFile(index) {
	const links = [...elements['file-nav'].querySelectorAll('a')];
	if (!links.length) return;
	const nextIndex = Math.max(0, Math.min(index, links.length - 1));
	for (const [linkIndex, link] of links.entries()) {
		const current = linkIndex === nextIndex;
		link.classList.toggle('is-current', current);
		if (current) link.setAttribute('aria-current', 'location');
		else link.removeAttribute('aria-current');
	}
	if (currentFileIndex === nextIndex) return;
	currentFileIndex = nextIndex;

	const link = links[nextIndex];
	const rail = link.closest('aside');
	if (!rail) return;
	const linkTop = link.offsetTop;
	const linkBottom = linkTop + link.offsetHeight;
	if (linkTop < rail.scrollTop) rail.scrollTop = linkTop;
	else if (linkBottom > rail.scrollTop + rail.clientHeight) {
		rail.scrollTop = linkBottom - rail.clientHeight;
	}
}

function updateCurrentFile() {
	scrollFrame = null;
	const cards = [...elements['diff-stack'].querySelectorAll('.diff-card')];
	if (!cards.length || elements['review-layout'].hidden) return;
	const readingLine = 72;
	let index = 0;
	for (const [cardIndex, card] of cards.entries()) {
		if (card.getBoundingClientRect().top > readingLine) break;
		index = cardIndex;
	}
	setCurrentFile(index);
}

function scheduleCurrentFileUpdate() {
	if (scrollFrame !== null) return;
	scrollFrame = requestAnimationFrame(updateCurrentFile);
}

function render() {
	if (['collecting', 'classifying'].includes(state?.phase)) {
		renderRunning();
		return;
	}
	if (state?.phase === 'error') {
		renderEmpty('Review failed.', state.error?.message || 'The classifier stopped.');
		return;
	}
	if (!state?.pr || state.phase !== 'complete') {
		renderEmpty('No review yet.', 'Open a pull request and choose Review.');
		return;
	}

	selected = selectReviewFiles(state);
	if (!selected.length) {
		renderEmpty('Nothing made the cut.', 'No files crossed the current review threshold.');
		return;
	}

	elements['empty-state'].hidden = true;
	elements['running-state'].hidden = true;
	elements['review-hero'].hidden = false;
	elements['review-layout'].hidden = false;
	elements['pr-identity'].textContent =
		`${state.pr.owner}/${state.pr.repo} · Pull request #${state.pr.number}`;
	elements['pr-title'].textContent = state.pr.title || `Pull request #${state.pr.number}`;
	elements['omitted-count'].textContent = String(Math.max(0, state.files.length - selected.length));
	elements['github-link'].href = state.pr.url;

	elements['file-nav'].replaceChildren(
		...selected.map(({ file }, index) => {
			const link = document.createElement('a');
			link.href = `#review-file-${index + 1}`;
			link.append(
				node('span', '', String(index + 1).padStart(2, '0')),
				node('span', '', file.filename)
			);
			return link;
		})
	);
	elements['diff-stack'].replaceChildren(...selected.map(fileCard));
	currentFileIndex = -1;
	scheduleCurrentFileUpdate();
}

async function loadState() {
	const stored = await chrome.storage.local.get(STATE_KEY);
	state = stored[STATE_KEY] || null;
	render();
}

elements['refresh-review'].addEventListener('click', loadState);
elements['copy-review'].addEventListener('click', async () => {
	const text = selected
		.map(({ file }) => file.patch)
		.filter(Boolean)
		.join('\n\n');
	if (!text) return;
	await navigator.clipboard.writeText(text);
	elements['copy-review'].textContent = 'Copied';
	setTimeout(() => (elements['copy-review'].textContent = 'Copy'), 1200);
});

chrome.storage.onChanged.addListener((changes, area) => {
	if (area === 'local' && changes[STATE_KEY]) {
		state = changes[STATE_KEY].newValue;
		render();
	}
});

window.addEventListener('scroll', scheduleCurrentFileUpdate, { passive: true });
window.addEventListener('resize', scheduleCurrentFileUpdate);

const params = new URLSearchParams(location.search);
const sourceTabId = Number(params.get('sourceTabId'));
const autorun = params.get('autorun') === '1' && Number.isInteger(sourceTabId) && sourceTabId > 0;

await loadState();
if (autorun) {
	const cleanUrl = new URL(location.href);
	cleanUrl.searchParams.delete('autorun');
	history.replaceState(null, '', cleanUrl);
	state = {
		...(state || {}),
		phase: 'collecting',
		analysis: { byFile: {}, completedFiles: 0, totalFiles: 0 }
	};
	render();
	const response = await chrome.runtime.sendMessage({ type: 'BEEF_RUN', sourceTabId });
	if (!response?.ok) await loadState();
}
