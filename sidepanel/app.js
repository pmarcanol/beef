import { DEFAULT_SETTINGS, SETTINGS_KEY, STATE_KEY } from '../lib/constants.js';
import { summarizeState } from '../lib/state.js';

const elements = Object.fromEntries(
	[
		'status',
		'settings-form',
		'typesafe-key',
		'toggle-key',
		'form-status',
		'empty-history',
		'run-history',
		'run-identity',
		'run-title',
		'run-time',
		'run-stats',
		'batch-history',
		'state-json',
		'copy-state',
		'export-state',
		'clear-state'
	].map((id) => [id, document.getElementById(id)])
);

let settings = { ...DEFAULT_SETTINGS };
let state = null;

function node(tag, className, text) {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = text;
	return element;
}

function phaseLabel(phase) {
	return (
		{
			idle: 'Idle',
			collecting: 'Reading',
			classifying: 'Running',
			complete: 'Complete',
			error: 'Failed'
		}[phase] || phase
	);
}

function renderSettings() {
	elements['typesafe-key'].value = settings.typesafeApiKey || '';
}

function renderHistory() {
	elements.status.textContent = phaseLabel(state?.phase || 'idle');
	elements.status.dataset.phase = state?.phase || 'idle';
	const hasRun = Boolean(state?.pr || state?.startedAt);
	elements['empty-history'].hidden = hasRun;
	elements['run-history'].hidden = !hasRun;
	if (!hasRun) return;

	const summary = summarizeState(state);
	const selected = Object.values(state.analysis?.byFile || {}).filter(
		(result) => result.reviewRisk >= 0.65 || result.keyLogic >= 0.65
	).length;
	elements['run-identity'].textContent = state.pr
		? `${state.pr.owner}/${state.pr.repo} #${state.pr.number}`
		: phaseLabel(state.phase);
	elements['run-title'].textContent = state.pr?.title || 'Review in progress';
	const timestamp = state.completedAt || state.updatedAt || state.startedAt;
	elements['run-time'].textContent = timestamp ? new Date(timestamp).toLocaleString() : '';

	const stats = [
		[summary.files, 'files'],
		[selected, 'selected'],
		[Math.max(0, summary.files - selected), 'omitted'],
		[summary.usage.inputTokens || 0, 'input tokens']
	];
	elements['run-stats'].replaceChildren(
		...stats.map(([value, label]) => {
			const item = node('div');
			item.append(node('strong', '', String(value)), node('span', '', label));
			return item;
		})
	);

	const batches = state.classifier?.batches || [];
	elements['batch-history'].replaceChildren(
		...batches.map((batch, index) => {
			const item = node('li');
			item.append(
				node('strong', '', `Batch ${String(index + 1).padStart(2, '0')}`),
				node('span', '', `${batch.status || 'unknown'} · ${batch.filenames?.length || 0} files`)
			);
			return item;
		})
	);
	elements['batch-history'].hidden = batches.length === 0;
	elements['state-json'].textContent = JSON.stringify(state, null, 2);
}

function selectTab(tabName) {
	document
		.querySelectorAll('.tab')
		.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.tab === tabName));
	document.querySelectorAll('.panel').forEach((panel) => {
		panel.hidden = panel.dataset.panel !== tabName;
	});
}

function exportState() {
	const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	const id = state?.pr ? `${state.pr.owner}-${state.pr.repo}-pr-${state.pr.number}` : 'run';
	link.href = url;
	link.download = `beef-${id}.json`;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document
	.querySelectorAll('.tab')
	.forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));

elements['toggle-key'].addEventListener('click', () => {
	const showing = elements['typesafe-key'].type === 'text';
	elements['typesafe-key'].type = showing ? 'password' : 'text';
	elements['toggle-key'].textContent = showing ? 'Show' : 'Hide';
});

elements['settings-form'].addEventListener('submit', async (event) => {
	event.preventDefault();
	settings = {
		typesafeApiKey: elements['typesafe-key'].value.trim()
	};
	await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
	elements['form-status'].textContent = 'Saved.';
	setTimeout(() => (elements['form-status'].textContent = ''), 1200);
});

elements['copy-state'].addEventListener('click', async () => {
	await navigator.clipboard.writeText(JSON.stringify(state, null, 2));
	elements['copy-state'].textContent = 'Copied';
	setTimeout(() => (elements['copy-state'].textContent = 'Copy'), 1200);
});
elements['export-state'].addEventListener('click', exportState);
elements['clear-state'].addEventListener('click', async () => {
	await chrome.runtime.sendMessage({ type: 'BEEF_RESET' });
});

chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== 'local') return;
	if (changes[SETTINGS_KEY]) {
		settings = { ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue || {}) };
		renderSettings();
	}
	if (changes[STATE_KEY]) {
		state = changes[STATE_KEY].newValue;
		renderHistory();
	}
});

const stored = await chrome.storage.local.get([SETTINGS_KEY, STATE_KEY]);
settings = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
state = stored[STATE_KEY] || null;
renderSettings();
renderHistory();
