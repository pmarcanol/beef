# beef

Beef is a local Manifest V3 Chrome extension that turns the GitHub pull request in the active tab into a Jev-ranked review queue.

It reads pull-request metadata directly from the open GitHub page, opens that pull request URL with `.diff` appended in a temporary inactive browser tab, reads the unified diff, closes the temporary tab, and asks four independent TypeSafe Noul questions about every parsed file:

- Is this mainly no-op-like or low-logic work (text, tests, low-logic UI, scaffolding, and similar changes)?
- Is it highly relevant to the PR description?
- Does it contain logic that is key to the PR description?
- Would a reviewer plausibly be in trouble if it merged unreviewed and broke?

The resulting yes-probabilities are displayed as percentages. Beef keeps the complete run record in local extension state: the collected PR metadata, complete unified diff, per-file patches, request payloads, raw Jev responses, resolved model names, token usage, timings, warnings, and errors. Credentials are intentionally excluded from that record and its exports.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this `beef` directory.
4. Click the Beef extension action and choose **Settings** to add your TypeSafe/Jev API key. The same page contains the latest run history and full saved state.
5. Open a GitHub pull request, click Beef, and choose **Review**. From the PR overview, Beef first moves the GitHub tab to its canonical **Files changed** (`/files`) view, then runs the classifier and opens the focused review page immediately.
6. Private PR access uses the existing GitHub browser session; no GitHub token is requested or stored.

Beef does not depend on Chrome's side-panel API; Review and Settings open as ordinary extension tabs.

A TypeSafe key is required and stored in `chrome.storage.local`; any unpacked extension with local machine access can inspect its own storage, so this is appropriate for a personal development extension rather than shared-secret distribution. A production release should exchange a short-lived session with a small backend and keep the TypeSafe key server-side.

## How the classifier is composed

Beef sends the entire pull request and all four independent questions per file in one TypeSafe `/v1/systemone` request so Jev can evaluate the shared PR context in parallel. There is no guessed file or character ceiling. If Jev explicitly rejects the request as oversized, Beef records that attempt, divides the files into roughly equal patch-weight groups, and retries recursively. The state supplied to Jev includes the PR title, description, branches, labels, author, change totals, discussion totals, and per-file status, line totals, URLs, collection sources, patch, truncation flag, and binary flag.

All four outputs remain raw, reusable Noul probabilities. Review ordering and labels are ordinary code:

- `reviewRisk >= 0.65` → **Must review**
- otherwise `keyLogic >= 0.65` → **Key logic**
- otherwise `noop >= 0.65` → **Low logic**

These thresholds are a starting policy, not a claim about universal model performance.

## Static review cut

The review tab reads the completed run from local extension state. It includes only files where `reviewRisk` or `keyLogic` is at least `0.65`, sorted by review priority. Git transport headers are removed and changes are presented in a GitHub-style split diff: deletions on the left, additions on the right, with shared context and line numbers aligned across both panes.

## Verify

From the repository root:

```sh
node --test tests/*.test.js
```

No build step is required. Reload the unpacked extension after editing files.
