# beef

Beef is a local Manifest V3 Chrome extension that turns the GitHub pull request in the active tab into a Jev-ranked review queue.

It reads pull-request metadata directly from the open GitHub page, opens that pull request URL with `.diff` appended in a temporary inactive browser tab, reads the unified diff, closes the temporary tab, and asks six independent TypeSafe Noul questions about every parsed file:

- Is this mainly no-op-like or low-logic work (text, tests, low-logic UI, scaffolding, and similar changes)?
- Is it highly relevant to the PR description?
- Does it contain logic that is key to the PR description?
- Would a reviewer plausibly be in trouble if it merged unreviewed and broke?
- Would an introduced defect likely be caught before release by ordinary builds, tests, visual QA, or routine manual validation?
- Does it change database structure or persisted data, including additive tables or columns, destructive DDL, constraints, backfills, or conversions?

The resulting yes-probabilities are displayed as percentages. Beef keeps the complete run record in local extension state: the collected PR metadata, complete unified diff, per-file patches, request payloads, raw Jev responses, resolved model names, token usage, timings, warnings, and errors. Credentials are intentionally excluded from that record and its exports.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this `beef` directory.
4. Click the Beef extension action and choose **Settings** to add your TypeSafe/Jev API key. The same page contains the latest run history and full saved state.
5. Open a GitHub pull request, click Beef, and choose **Review**. On the first attempt, confirm the TypeSafe data transfer in the popup. From the PR overview, Beef then moves the GitHub tab to its canonical **Files changed** (`/files`) view, runs the classifier, and opens the focused review page immediately.
6. Private PR access uses the existing GitHub browser session; no GitHub token is requested or stored.

Beef does not depend on Chrome's side-panel API; Review and Settings open as ordinary extension tabs.

A user-provided TypeSafe key is required and stored in `chrome.storage.local`. It is sent only to TypeSafe over HTTPS when the user explicitly starts a review and is excluded from exported run state. Users should use a limited, revocable key and can remove it in Settings at any time.

## How the classifier is composed

Beef sends the entire pull request and all six independent questions per file in one TypeSafe `/v1/systemone` request so Jev can evaluate the shared PR context in parallel. There is no guessed file or character ceiling. If Jev explicitly rejects the request as oversized, Beef records that attempt, divides the files into roughly equal patch-weight groups, and retries recursively. The state supplied to Jev includes the PR title, description, branches, labels, author, change totals, discussion totals, and per-file status, line totals, URLs, collection sources, patch, truncation flag, and binary flag.

All six outputs remain raw, reusable Noul probabilities. Code applies a transparent validation discount without overwriting those answers: `adjusted = raw × (1 − 0.7 × validationCatch)`. Database risk bypasses that discount. Review ordering and labels use these composed values:

- `databaseRisk >= 0.65` → **Database risk**
- `adjustedReviewRisk >= 0.65` → **Must review**
- otherwise `adjustedKeyLogic >= 0.65` → **Key logic**

These thresholds are a starting policy, not a claim about universal model performance.

## Static review cut

The review tab reads the completed run from local extension state. It includes files where database risk, adjusted review risk, or adjusted key logic is at least `0.65`, sorted by review priority. Git transport headers are removed and changes are presented in a GitHub-style split diff: deletions on the left, additions on the right, with shared context and line numbers aligned across both panes.

The file list is virtualized, so only the visible review cards and a small overscan region are mounted. Individual diffs over 300 rows use synchronized row virtualization inside a fixed-height viewer. This keeps both very wide PRs and single generated files responsive without discarding review content.

## Chrome Web Store release

Store listing copy, permission justifications, reviewer instructions, privacy policy, icons, screenshots, and packaging scripts live in `store/`. Run this from the `beef` directory:

```sh
./store/package-store.sh
```

The uploadable ZIP is written to `dist/`. The privacy policy must be hosted at a public HTTPS URL, and a restricted TypeSafe reviewer key must be supplied privately in the Chrome Web Store dashboard.

## Verify

From the repository root:

```sh
node --test tests/*.test.js
node tests/visual-smoke.mjs
```

No build step is required. Reload the unpacked extension after editing files.
