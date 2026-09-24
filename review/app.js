import { STATE_KEY } from '../lib/constants.js';
import { highlightTokens, languageForFilename } from '../lib/highlight.js';
import { reviewDiffRows, selectReviewFiles } from '../lib/review.js';
import {
	buildVirtualOffsets,
	estimateReviewCardHeight,
	MAX_INLINE_DIFF_ROWS,
	VIRTUAL_DIFF_VIEWPORT_PX,
	virtualIndexAtOffset,
	virtualRange
} from '../lib/virtual.js';

const REVIEW_METRICS = [
	{ key: 'reviewCriticality', label: 'Priority' },
	{ key: 'reviewRisk', label: 'Risk' },
	{ key: 'keyLogic', label: 'Key' },
	{ key: 'databaseRisk', label: 'DB' },
	{ key: 'validationCatch', label: 'Caught' },
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
const virtualList = {
	heights: [],
	offsets: [0],
	start: -1,
	end: -1,
	measurementFrame: null
};

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

function rowsForPane(content, rows, column, language, start = 0, end = rows.length) {
	content.append(...rows.slice(start, end).map((row) => paneRow(row, column, language)));
}

function diffPane(rows, column, language) {
	const pane = node('div', 'diff-pane');
	pane.setAttribute('aria-label', column === 'left' ? 'Before changes' : 'After changes');
	const content = node('div', 'diff-pane-content');
	if (rows.length <= MAX_INLINE_DIFF_ROWS) {
		rowsForPane(content, rows, column, language);
		pane.append(content);
		return pane;
	}

	pane.classList.add('diff-pane--virtual');
	pane.style.height = `${VIRTUAL_DIFF_VIEWPORT_PX}px`;
	const heights = rows.map((row) => (row.kind === 'hunk' || row.kind === 'meta' ? 26 : 18));
	const offsets = buildVirtualOffsets(heights);
	const maximumCharacters = rows.reduce((longest, row) => {
		const text = row.text || row[column]?.text || '';
		return Math.max(longest, text.length);
	}, 0);
	content.style.setProperty(
		'--virtual-code-width',
		`${Math.max(0, maximumCharacters * 7.25 + 64)}px`
	);
	let renderedStart = -1;
	let renderedEnd = -1;
	let rowFrame = null;

	function renderRows() {
		rowFrame = null;
		const { start, end } = virtualRange(offsets, pane.scrollTop, pane.clientHeight || 560, 360);
		if (start === renderedStart && end === renderedEnd) return;
		renderedStart = start;
		renderedEnd = end;
		const topSpacer = node('div', 'virtual-row-spacer');
		topSpacer.style.height = `${offsets[start]}px`;
		const bottomSpacer = node('div', 'virtual-row-spacer');
		bottomSpacer.style.height = `${offsets.at(-1) - offsets[end]}px`;
		content.replaceChildren(topSpacer);
		rowsForPane(content, rows, column, language, start, end);
		content.append(bottomSpacer);
	}

	pane.addEventListener(
		'scroll',
		() => {
			if (rowFrame === null) rowFrame = requestAnimationFrame(renderRows);
		},
		{ passive: true }
	);
	pane.renderVirtualRows = renderRows;
	renderRows();
	pane.append(content);
	return pane;
}

function synchronizeVerticalScroll(left, right) {
	if (!left?.classList.contains('diff-pane--virtual')) return;
	for (const [source, target] of [
		[left, right],
		[right, left]
	]) {
		source.addEventListener(
			'scroll',
			() => {
				if (Math.abs(target.scrollTop - source.scrollTop) <= 1) return;
				target.scrollTop = source.scrollTop;
				target.renderVirtualRows?.();
			},
			{ passive: true }
		);
	}
}

function fileCard(entry, index) {
	const { file, result, tier } = entry;
	const language = languageForFilename(file.filename);
	const isAddedFile = file.status === 'added';
	const card = node('article', 'diff-card');
	card.id = `review-file-${index + 1}`;
	card.dataset.virtualIndex = String(index);
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
			else {
				const left = diffPane(rows, 'left', language.id);
				const right = diffPane(rows, 'right', language.id);
				synchronizeVerticalScroll(left, right);
				diff.append(left, right);
			}
		} else
			diff.append(node('div', 'missing-notice', 'No textual patch is available for this file.'));
	}

	card.append(header, scores, diff);
	return card;
}

function stackContentTop() {
	const stack = elements['diff-stack'];
	const paddingTop = Number.parseFloat(getComputedStyle(stack).paddingTop) || 0;
	return window.scrollY + stack.getBoundingClientRect().top + paddingTop;
}

function resetVirtualList() {
	if (virtualList.measurementFrame !== null) cancelAnimationFrame(virtualList.measurementFrame);
	virtualList.measurementFrame = null;
	virtualList.heights = selected.map(estimateReviewCardHeight);
	virtualList.offsets = buildVirtualOffsets(virtualList.heights);
	virtualList.start = -1;
	virtualList.end = -1;
}

function measureVirtualWindow() {
	virtualList.measurementFrame = null;
	const stackTop = stackContentTop();
	const readingOffset = Math.max(0, window.scrollY + 72 - stackTop);
	const anchorIndex = virtualIndexAtOffset(virtualList.offsets, readingOffset);
	const anchorWithin = readingOffset - virtualList.offsets[anchorIndex];
	let changed = false;

	for (const card of elements['diff-stack'].querySelectorAll('.diff-card')) {
		const index = Number(card.dataset.virtualIndex);
		const marginBottom = Number.parseFloat(getComputedStyle(card).marginBottom) || 0;
		const measured = Math.ceil(card.getBoundingClientRect().height + marginBottom);
		if (Number.isInteger(index) && Math.abs(measured - virtualList.heights[index]) > 1) {
			virtualList.heights[index] = measured;
			changed = true;
		}
	}
	if (!changed) return;

	virtualList.offsets = buildVirtualOffsets(virtualList.heights);
	const nextScrollTop = stackContentTop() + virtualList.offsets[anchorIndex] + anchorWithin - 72;
	if (Math.abs(nextScrollTop - window.scrollY) > 1) window.scrollTo(0, nextScrollTop);
	virtualList.start = -1;
	virtualList.end = -1;
	renderVirtualWindow(true);
}

function renderVirtualWindow(force = false) {
	if (!selected.length || elements['review-layout'].hidden) return;
	const viewportTop = Math.max(0, window.scrollY - stackContentTop());
	const { start, end } = virtualRange(virtualList.offsets, viewportTop, window.innerHeight);
	if (!force && start === virtualList.start && end === virtualList.end) return;
	virtualList.start = start;
	virtualList.end = end;

	const topSpacer = node('div', 'virtual-spacer');
	topSpacer.style.height = `${virtualList.offsets[start]}px`;
	topSpacer.setAttribute('aria-hidden', 'true');
	const windowElement = node('div', 'virtual-window');
	windowElement.append(
		...selected.slice(start, end).map((entry, localIndex) => fileCard(entry, start + localIndex))
	);
	const bottomSpacer = node('div', 'virtual-spacer');
	bottomSpacer.style.height = `${virtualList.offsets.at(-1) - virtualList.offsets[end]}px`;
	bottomSpacer.setAttribute('aria-hidden', 'true');
	elements['diff-stack'].replaceChildren(topSpacer, windowElement, bottomSpacer);

	if (virtualList.measurementFrame !== null) cancelAnimationFrame(virtualList.measurementFrame);
	virtualList.measurementFrame = requestAnimationFrame(measureVirtualWindow);
}

function scrollToFile(index) {
	const nextIndex = Math.max(0, Math.min(index, selected.length - 1));
	const top = stackContentTop() + virtualList.offsets[nextIndex] - 64;
	window.scrollTo({ top, behavior: 'auto' });
	setCurrentFile(nextIndex);
	renderVirtualWindow();
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
	if (!selected.length || elements['review-layout'].hidden) return;
	const readingOffset = Math.max(0, window.scrollY + 72 - stackContentTop());
	setCurrentFile(virtualIndexAtOffset(virtualList.offsets, readingOffset));
	renderVirtualWindow();
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
			link.addEventListener('click', (event) => {
				event.preventDefault();
				scrollToFile(index);
				history.replaceState(null, '', link.href);
			});
			link.append(
				node('span', '', String(index + 1).padStart(2, '0')),
				node('span', '', file.filename)
			);
			return link;
		})
	);
	resetVirtualList();
	renderVirtualWindow(true);
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
