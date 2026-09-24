import { APP_VERSION, MODEL, TYPESAFE_ENDPOINT } from './constants.js';

export function initialState(overrides = {}) {
	const now = new Date().toISOString();
	return {
		schemaVersion: 1,
		appVersion: APP_VERSION,
		phase: 'idle',
		startedAt: null,
		updatedAt: now,
		completedAt: null,
		source: null,
		pr: null,
		files: [],
		analysis: { byFile: {}, completedFiles: 0, totalFiles: 0 },
		classifier: {
			provider: 'TypeSafe AI',
			endpoint: TYPESAFE_ENDPOINT,
			requestedModel: MODEL,
			resolvedModels: [],
			batches: [],
			usage: { inputTokens: 0, outputTokens: 0 }
		},
		raw: { collection: null, typesafeResponses: [] },
		error: null,
		...overrides
	};
}

export function summarizeState(state) {
	const values = Object.values(state.analysis?.byFile || {});
	return {
		files: state.files?.length || 0,
		mustReview: values.filter((value) => value.reviewRisk >= 0.65).length,
		keyLogic: values.filter((value) => value.keyLogic >= 0.65).length,
		mostlyNoop: values.filter((value) => value.noop >= 0.65).length,
		usage: state.classifier?.usage || { inputTokens: 0, outputTokens: 0 }
	};
}
