# Reviewer instructions

1. In the extension popup, choose **Settings**.
2. Paste the restricted TypeSafe test API key provided in the private reviewer-credentials field, then save.
3. Open a GitHub pull request that the reviewer account can access. A public PR works.
4. Open the beef popup and choose **Review**. On the first attempt, the confirmation modal opens automatically. Choose **Agree & review** after reading the TypeSafe data-transfer disclosure.
5. Beef resumes the same attempt, redirects a PR overview to **Files changed**, opens its static review page, reads the PR’s `.diff` in a temporary inactive tab, classifies the files, and updates the review page.
6. Use **Settings → Run history** to inspect or clear the complete local run state.

No GitHub token is required. The extension uses the browser’s existing GitHub session. The publisher must add a restricted, revocable TypeSafe test key to the dashboard’s private reviewer credentials before submission; never include that key in the ZIP or listing text.
