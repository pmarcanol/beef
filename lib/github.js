const PR_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/;

export function parsePullRequestUrl(url) {
	const match = String(url || '').match(PR_URL);
	if (!match) return null;
	const baseUrl = `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
	return {
		owner: decodeURIComponent(match[1]),
		repo: decodeURIComponent(match[2]),
		number: Number(match[3]),
		baseUrl,
		diffUrl: `${baseUrl}.diff`,
		filesUrl: `${baseUrl}/files`
	};
}

export function isPullRequestOverviewUrl(url, ref = parsePullRequestUrl(url)) {
	if (!ref) return false;
	try {
		const current = new URL(url);
		const overview = new URL(ref.baseUrl);
		return (
			current.origin === overview.origin &&
			current.pathname.replace(/\/$/, '') === overview.pathname.replace(/\/$/, '')
		);
	} catch {
		return false;
	}
}

function decodeGitPath(value) {
	const path = String(value || '').trim();
	if (!path.startsWith('"')) return path;
	const inner = path.endsWith('"') ? path.slice(1, -1) : path.slice(1);
	return inner
		.replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(Number.parseInt(octal, 8)))
		.replace(/\\t/g, '\t')
		.replace(/\\n/g, '\n')
		.replace(/\\r/g, '\r')
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, '\\');
}

function pathFromMarker(chunk, marker, stripDiffPrefix = false) {
	const line = chunk.split('\n').find((candidate) => candidate.startsWith(marker));
	if (!line) return null;
	const value = decodeGitPath(line.slice(marker.length));
	if (value === '/dev/null') return null;
	return stripDiffPrefix ? value.replace(/^[ab]\//, '') : value;
}

function fallbackPaths(header) {
	const rest = header.slice('diff --git '.length);
	const quoted = rest.match(/^("(?:\\.|[^"\\])*")\s+("(?:\\.|[^"\\])*")$/);
	if (quoted) {
		return [
			decodeGitPath(quoted[1]).replace(/^a\//, ''),
			decodeGitPath(quoted[2]).replace(/^b\//, '')
		];
	}
	const separator = rest.lastIndexOf(' b/');
	if (separator < 0) return [null, null];
	return [
		rest.slice(0, separator).replace(/^a\//, ''),
		rest.slice(separator + 1).replace(/^b\//, '')
	];
}

function parseDiffFile(chunk, index) {
	const lines = chunk.split('\n');
	const [fallbackPrevious, fallbackCurrent] = fallbackPaths(lines[0]);
	const renamedFrom = pathFromMarker(chunk, 'rename from ');
	const renamedTo = pathFromMarker(chunk, 'rename to ');
	const deletedPath = pathFromMarker(chunk, '--- ', true);
	const currentPath = pathFromMarker(chunk, '+++ ', true);
	const filename = renamedTo || currentPath || fallbackCurrent || deletedPath || fallbackPrevious;
	if (!filename) return null;

	const deleted = lines.some((line) => line.startsWith('deleted file mode '));
	const added = lines.some((line) => line.startsWith('new file mode '));
	const renamed = Boolean(renamedFrom || renamedTo);
	const binary = lines.some(
		(line) =>
			line === 'GIT binary patch' ||
			line.startsWith('Binary files ') ||
			line.startsWith('Binary file ')
	);
	const additions = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
	const deletions = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length;
	const indexLine = lines.find((line) => line.startsWith('index '));
	const shaMatch = indexLine?.match(/^index [^.]+\.\.([^ ]+)/);

	return {
		index,
		filename,
		previousFilename: renamed ? renamedFrom || fallbackPrevious : null,
		status: deleted ? 'removed' : added ? 'added' : renamed ? 'renamed' : 'modified',
		sha: shaMatch?.[1] || null,
		additions,
		deletions,
		changes: additions + deletions,
		patch: chunk.trimEnd(),
		rawUrl: null,
		blobUrl: null,
		contentsUrl: null,
		truncated: false,
		binary,
		collectionSources: ['github-dot-diff']
	};
}

export function parseUnifiedDiff(text) {
	const normalized = String(text || '').replace(/\r\n/g, '\n');
	const starts = [];
	const matcher = /^diff --git /gm;
	for (let match = matcher.exec(normalized); match; match = matcher.exec(normalized)) {
		starts.push(match.index);
	}
	return starts
		.map((start, index) => normalized.slice(start, starts[index + 1] ?? normalized.length))
		.map(parseDiffFile)
		.filter(Boolean)
		.map((file, index) => ({ ...file, index }));
}

export function mergeCollectedData(ref, diffData, pageData) {
	const additions = diffData.files.reduce((total, file) => total + file.additions, 0);
	const deletions = diffData.files.reduce((total, file) => total + file.deletions, 0);
	return {
		pr: {
			owner: ref.owner,
			repo: ref.repo,
			number: ref.number,
			url: ref.baseUrl,
			diffUrl: ref.diffUrl,
			filesUrl: ref.filesUrl,
			title: `Pull request #${ref.number}`,
			description: '',
			labels: [],
			...(pageData?.pr || {}),
			additions,
			deletions,
			changedFiles: diffData.files.length
		},
		files: diffData.files,
		raw: {
			diffUrl: diffData.diffUrl,
			unifiedDiff: diffData.text,
			browserPage: pageData || null
		}
	};
}
