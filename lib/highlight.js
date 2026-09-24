const EXTENSION_LANGUAGES = Object.freeze({
	js: ['javascript', 'JavaScript'],
	mjs: ['javascript', 'JavaScript'],
	cjs: ['javascript', 'JavaScript'],
	jsx: ['javascript', 'JSX'],
	ts: ['typescript', 'TypeScript'],
	mts: ['typescript', 'TypeScript'],
	cts: ['typescript', 'TypeScript'],
	tsx: ['typescript', 'TSX'],
	json: ['json', 'JSON'],
	jsonc: ['json', 'JSON'],
	py: ['python', 'Python'],
	rb: ['ruby', 'Ruby'],
	go: ['go', 'Go'],
	rs: ['rust', 'Rust'],
	java: ['java', 'Java'],
	kt: ['java', 'Kotlin'],
	kts: ['java', 'Kotlin'],
	c: ['c', 'C'],
	h: ['c', 'C'],
	cc: ['c', 'C++'],
	cpp: ['c', 'C++'],
	cxx: ['c', 'C++'],
	hpp: ['c', 'C++'],
	cs: ['c', 'C#'],
	css: ['css', 'CSS'],
	scss: ['css', 'SCSS'],
	less: ['css', 'Less'],
	html: ['html', 'HTML'],
	htm: ['html', 'HTML'],
	vue: ['html', 'Vue'],
	svelte: ['html', 'Svelte'],
	xml: ['html', 'XML'],
	svg: ['html', 'SVG'],
	sh: ['shell', 'Shell'],
	bash: ['shell', 'Shell'],
	zsh: ['shell', 'Shell'],
	fish: ['shell', 'Fish'],
	sql: ['sql', 'SQL'],
	yml: ['yaml', 'YAML'],
	yaml: ['yaml', 'YAML'],
	toml: ['yaml', 'TOML'],
	md: ['markdown', 'Markdown'],
	mdx: ['markdown', 'MDX'],
	graphql: ['graphql', 'GraphQL'],
	gql: ['graphql', 'GraphQL']
});

const SPECIAL_FILENAMES = Object.freeze({
	dockerfile: ['shell', 'Dockerfile'],
	makefile: ['shell', 'Makefile'],
	gemfile: ['ruby', 'Ruby'],
	rakefile: ['ruby', 'Ruby'],
	'package.json': ['json', 'JSON'],
	'tsconfig.json': ['json', 'JSON'],
	'go.mod': ['go', 'Go modules']
});

const KEYWORDS = Object.freeze({
	javascript:
		'as async await break case catch class const continue debugger default delete do else export extends finally for from function get if implements import in instanceof interface let new of package private protected public return set static super switch throw try typeof undefined var void while with yield',
	typescript:
		'as async await break case catch class const continue debugger declare default delete do else enum export extends finally for from function get if implements import in infer instanceof interface is keyof let module namespace never new of override package private protected public readonly return satisfies set static super switch throw try type typeof undefined unknown var void while with yield',
	python:
		'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield',
	ruby: 'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield',
	go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
	rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
	java: 'abstract as assert boolean break byte case catch char class const continue data default do double else enum extends false final finally float for fun if implements import in instanceof int interface long native new null object open override package private protected public return sealed short static strictfp super switch synchronized this throw throws transient true try val var void volatile when while',
	c: 'alignas alignof asm auto bool break case catch char class const constexpr continue default delete do double else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept nullptr operator private protected public register reinterpret_cast return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile wchar_t while',
	css: '@charset @container @font-face @import @keyframes @layer @media @page @property @supports',
	shell:
		'case do done elif else esac export fi for function if in local readonly select then time until while',
	sql: 'all alter and as asc begin between by case check column create database default delete desc distinct drop else end exists false from full group having in index inner insert into is join left like limit not null on or order outer primary references right select set table then true union unique update values view when where with',
	graphql:
		'directive enum extend fragment implements input interface mutation on query repeatable scalar schema subscription type union'
});

const C_STYLE = new Set(['javascript', 'typescript', 'go', 'rust', 'java', 'c', 'css', 'graphql']);

function globalRegex(regex) {
	return new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
}

function rulesFor(language) {
	const rules = [];
	if (language === 'json') rules.push(['property', /"(?:\\.|[^"\\])*"(?=\s*:)/]);
	if (language === 'markdown') {
		rules.push(
			['comment', /^#{1,6}\s.*$/],
			['keyword', /(?:\*\*|__)(?:[^*_]|\*(?!\*)|_(?!_))+(?:\*\*|__)/],
			['string', /`[^`]+`/],
			['link', /!?\[[^\]]*\]\([^)]*\)/]
		);
	} else if (language === 'html') {
		rules.push(['comment', /<!--.*?-->/], ['tag', /<\/?[A-Za-z][^>]*>/]);
	} else if (language === 'yaml') {
		rules.push(['comment', /#.*/], ['property', /^[\t ]*[A-Za-z0-9_.-]+(?=\s*=|\s*:)/]);
	} else if (language === 'python' || language === 'ruby' || language === 'shell') {
		rules.push(['comment', /#.*/]);
	} else if (language === 'sql') {
		rules.push(['comment', /--.*$|\/\*.*?\*\//]);
	} else if (C_STYLE.has(language)) {
		rules.push(['comment', /\/\/.*$|\/\*.*?\*\//]);
	}

	rules.push(
		['string', /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/],
		['number', /\b(?:0[xob][\da-f]+|\d+(?:\.\d+)?)\b/i],
		['literal', /\b(?:true|false|null|nil|none)\b/i]
	);

	const keywords = KEYWORDS[language];
	if (keywords) {
		const pattern = keywords
			.split(' ')
			.map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
			.join('|');
		rules.push(['keyword', new RegExp(`\\b(?:${pattern})\\b`, language === 'sql' ? 'i' : '')]);
	}

	return rules.map(([type, regex]) => ({ type, regex: globalRegex(regex) }));
}

export function languageForFilename(filename = '') {
	const basename = String(filename).split('/').pop().toLowerCase();
	const special = SPECIAL_FILENAMES[basename];
	if (special) return { id: special[0], label: special[1] };
	const extension = basename.includes('.') ? basename.split('.').pop() : '';
	const language = EXTENSION_LANGUAGES[extension];
	return language
		? { id: language[0], label: language[1] }
		: { id: 'plaintext', label: extension ? extension.toUpperCase() : 'Text' };
}

export function highlightTokens(text = '', language = 'plaintext') {
	if (!text || language === 'plaintext') return [{ type: 'plain', text: String(text) }];
	const source = String(text);
	const tokens = [];
	const rules = rulesFor(language);
	let cursor = 0;

	while (cursor < source.length) {
		let winner = null;
		for (const rule of rules) {
			rule.regex.lastIndex = cursor;
			const match = rule.regex.exec(source);
			if (!match) continue;
			if (!winner || match.index < winner.index)
				winner = { ...rule, index: match.index, text: match[0] };
		}
		if (!winner) break;
		if (winner.index > cursor)
			tokens.push({ type: 'plain', text: source.slice(cursor, winner.index) });
		tokens.push({ type: winner.type, text: winner.text });
		cursor = winner.index + winner.text.length;
	}

	if (cursor < source.length) tokens.push({ type: 'plain', text: source.slice(cursor) });
	return tokens;
}
