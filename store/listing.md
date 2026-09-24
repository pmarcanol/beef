# Chrome Web Store listing

## Name

beef

## Summary

Turn the GitHub pull request in front of you into a focused, risk-ranked review cut with Jev.

## Category

Developer Tools

## Single purpose

Beef ranks files in the GitHub pull request the user explicitly chooses to review so they can focus on high-risk and key-logic changes.

## Description

Beef turns a large GitHub pull request into a focused review queue.

Open a pull request, choose Review, and beef reads its unified diff using your existing GitHub browser session. Jev scores each changed file for review risk, key logic, relevance to the pull-request description, low-logic or no-op-like content, whether ordinary validation would likely catch a defect before release, and database changes that need high-priority review.

Features:

- Prioritizes risky and central implementation files.
- Always promotes database schema and persisted-data changes, including new tables and columns.
- Presents a clean, side-by-side review cut with syntax highlighting.
- Uses a full-width view for newly added files.
- Handles large pull requests with adaptive Jev batches and virtualized diff rendering.
- Keeps the TypeSafe API key and latest review history in local Chrome extension storage.
- Works with private pull requests through the GitHub session already open in the browser.

Beef sends the pull-request metadata and diff content selected for review directly to TypeSafe AI for classification. It does not sell data, serve advertising, or access unrelated websites. A user-provided TypeSafe/Jev API key is required.

Before the first review, beef opens a confirmation modal explaining this transfer and proceeds only after the user chooses Agree & review.

## Privacy disclosure

When the user chooses Review, beef reads the current GitHub pull request and sends its title, description, filenames, and diff content to TypeSafe AI over HTTPS for classification. The TypeSafe API key, latest diff, review results, usage totals, and error history are stored locally in Chrome extension storage. TypeSafe AI is the only external data recipient. Beef does not sell data, use it for advertising, or permit human access by the extension developer.

## Required dashboard data-use selections

- Authentication information: TypeSafe API key, stored locally and sent only to TypeSafe AI.
- Website content: GitHub pull-request metadata and diff content.
- Web history/activity: only the URL of the pull request the user explicitly asks beef to review.
- User-provided content: pull-request descriptions and code changes.

Certify that data use is limited to the extension’s single purpose and is not used for advertising, lending, or unrelated profiling.
