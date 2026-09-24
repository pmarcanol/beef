(() => {
	if (globalThis.__beefContentLoaded) return;
	globalThis.__beefContentLoaded = true;
	const BADGE_CLASS = 'beef-inline-badge';

	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message?.type === 'BEEF_COLLECT_METADATA') {
			collectFromBrowserPage()
				.then((data) => sendResponse({ ok: true, data }))
				.catch((error) => sendResponse({ ok: false, error: error.message }));
			return true;
		}
		if (message?.type === 'BEEF_RENDER_BADGES') {
			renderBadges(message.analysis || {});
			sendResponse({ ok: true });
		}
		return false;
	});

	function text(element) {
		return String(element?.textContent || '')
			.replace(/\u200b/g, '')
			.replace(/[ \t]+\n/g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
	}

	function first(root, selectors) {
		for (const selector of selectors) {
			const element = root.querySelector(selector);
			if (element) return element;
		}
		return null;
	}

	function findPullRequest(value, seen = new Set()) {
		if (!value || typeof value !== 'object' || seen.has(value)) return null;
		seen.add(value);
		if (
			typeof value.title === 'string' &&
			typeof value.number === 'number' &&
			('baseBranch' in value || 'headBranch' in value)
		) {
			return value;
		}
		for (const child of Object.values(value)) {
			const found = findPullRequest(child, seen);
			if (found) return found;
		}
		return null;
	}

	function embeddedPullRequest(root) {
		for (const script of root.querySelectorAll('script[data-target="react-app.embeddedData"]')) {
			try {
				const found = findPullRequest(JSON.parse(script.textContent || 'null'));
				if (found) return found;
			} catch {
				// Ignore unrelated or malformed embedded state.
			}
		}
		return null;
	}

	function pageMetadata(root, ref) {
		const embedded = embeddedPullRequest(root);
		const title =
			embedded?.title ||
			text(
				first(root, [
					'bdi.js-issue-title',
					'[data-testid="issue-title"]',
					'.gh-header-title .js-issue-title',
					'h1 .markdown-title',
					'h1 bdi'
				])
			);
		const body =
			text(
				first(root, [
					'.js-comment-container .js-comment-body',
					'[data-testid="issue-body"]',
					'.timeline-comment-group .markdown-body'
				])
			) ||
			root.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ||
			'';
		const author =
			embedded?.author?.login ||
			text(first(root, ['.gh-header-meta .author', '.js-comment-container a.author', 'a.author']));
		const labelNodes = root.querySelectorAll(
			'.js-issue-labels a, [data-testid="issue-labels"] a, .IssueLabel'
		);
		const labels = [...labelNodes].map(text).filter(Boolean);
		const base =
			embedded?.baseBranch ||
			text(first(root, ['[data-testid="base-ref"]', '.base-ref', '.commit-ref.base-ref'])).replace(
				/^base:\s*/i,
				''
			);
		const head =
			embedded?.headBranch ||
			text(first(root, ['[data-testid="head-ref"]', '.head-ref', '.commit-ref.head-ref'])).replace(
				/^compare:\s*/i,
				''
			);
		const relativeTimes = [...root.querySelectorAll('relative-time')];
		const createdAt = embedded?.createdTime || relativeTimes[0]?.getAttribute('datetime') || null;
		const stateText =
			embedded?.state || text(first(root, ['.State', '[data-testid="issue-state"]']));

		return {
			owner: ref.owner,
			repo: ref.repo,
			number: ref.number,
			url: ref.baseUrl,
			diffUrl: ref.diffUrl,
			filesUrl: ref.filesUrl,
			title,
			description: body,
			author,
			state: stateText.toLowerCase(),
			draft: /draft/i.test(stateText) || /draft/i.test(title),
			labels: [...new Set(labels)],
			base,
			head,
			createdAt,
			updatedAt: relativeTimes.at(-1)?.getAttribute('datetime') || createdAt,
			commits: embedded?.commitsCount ?? null,
			comments: null,
			reviewComments: null
		};
	}

	async function collectFromBrowserPage() {
		const match = location.href.match(
			/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/
		);
		if (!match) throw new Error('The source tab is not a GitHub pull request.');
		const baseUrl = `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
		const ref = {
			owner: decodeURIComponent(match[1]),
			repo: decodeURIComponent(match[2]),
			number: Number(match[3]),
			baseUrl,
			diffUrl: `${baseUrl}.diff`,
			filesUrl: `${baseUrl}/files`
		};

		return {
			pr: pageMetadata(document, ref),
			diffUrl: ref.diffUrl,
			capturedAt: new Date().toISOString(),
			pageUrl: location.href,
			pageTitle: document.title
		};
	}

	function filenameFor(fileElement) {
		return (
			fileElement.getAttribute('data-path') ||
			fileElement.querySelector('[data-path]')?.getAttribute('data-path') ||
			fileElement.querySelector('.file-info a[title]')?.getAttribute('title') ||
			fileElement.querySelector('.file-info [title]')?.getAttribute('title') ||
			fileElement.querySelector('[data-testid="file-header"] a')?.textContent ||
			''
		).trim();
	}

	function renderBadges(analysis) {
		if (!document.getElementById('beef-inline-style')) {
			const style = document.createElement('style');
			style.id = 'beef-inline-style';
			style.textContent = `
        .${BADGE_CLASS}{display:inline-flex;align-items:center;gap:5px;margin-left:8px;padding:2px 7px;border:1px solid #8b1e16;border-radius:999px;background:#fff2da;color:#64150f;font:700 10px/1.5 ui-monospace,SFMono-Regular,monospace;letter-spacing:.04em;text-transform:uppercase}
        .${BADGE_CLASS}[data-level="high"]{background:#8b1e16;color:#fff;border-color:#8b1e16}
        .${BADGE_CLASS}[data-level="skip"]{background:#e9eadf;color:#4c5249;border-color:#a4aa9d}
      `;
			document.head.append(style);
		}

		for (const element of document.querySelectorAll('.js-file, [data-file-type="diff"]')) {
			const filename = filenameFor(element);
			const value = analysis[filename];
			if (!value) continue;
			element.querySelector(`.${BADGE_CLASS}`)?.remove();
			const badge = document.createElement('span');
			badge.className = BADGE_CLASS;
			if (value.reviewRisk >= 0.65) {
				badge.dataset.level = 'high';
				badge.textContent = `beef · review ${Math.round(value.reviewRisk * 100)}%`;
			} else if (value.noop >= 0.65) {
				badge.dataset.level = 'skip';
				badge.textContent = `beef · low logic ${Math.round(value.noop * 100)}%`;
			} else {
				badge.textContent = `beef · risk ${Math.round(value.reviewRisk * 100)}%`;
			}
			const mount = element.querySelector('.file-info, [data-testid="file-header"]');
			mount?.append(badge);
		}
	}
})();
