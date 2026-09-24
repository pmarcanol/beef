export const STATE_KEY = 'beefState';
export const SETTINGS_KEY = 'beefSettings';
export const MODEL = 'jev-latest';
export const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const APP_VERSION = '1.3.0';

export const DEFAULT_SETTINGS = Object.freeze({
	typesafeApiKey: '',
	dataDisclosureAcceptedAt: null
});

export const METRICS = Object.freeze([
	{ key: 'noop', label: 'No-op-like', answerSuffix: 'noop' },
	{ key: 'relevance', label: 'PR relevance', answerSuffix: 'relevance' },
	{ key: 'keyLogic', label: 'Key logic', answerSuffix: 'key_logic' },
	{ key: 'reviewRisk', label: 'Review risk', answerSuffix: 'review_risk' },
	{ key: 'validationCatch', label: 'Caught by validation', answerSuffix: 'validation_catch' },
	{ key: 'databaseRisk', label: 'Database change risk', answerSuffix: 'database_risk' }
]);
