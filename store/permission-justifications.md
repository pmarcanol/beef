# Permission justifications

Paste these explanations into the Chrome Web Store Privacy tab.

## `tabs`

Beef identifies the active GitHub pull-request tab, redirects the overview to GitHub’s Files changed view, opens the pull request’s `.diff` URL in a temporary inactive tab, reads it, closes it, and opens the generated review page. It does not inspect unrelated tabs.

## `scripting`

Beef injects its packaged metadata collector into the user-selected GitHub pull-request tab if the declared content script is not already available, and reads plain text from the temporary GitHub `.diff` tab. No remote code is loaded or executed.

## `storage`

Beef stores the user-provided TypeSafe API key, consent timestamp, settings, latest pull-request diff, classifier results, usage totals, and error history locally in Chrome extension storage.

## `unlimitedStorage`

GitHub pull-request diffs can exceed Chrome’s default local-storage quota. Beef preserves the complete latest run and full diff so the user can inspect and export its classifier inputs and results. A new run replaces the previous run, and the user can clear it from Settings.

## `https://github.com/*`

Required to read metadata only from GitHub pull-request pages explicitly opened by the user and to open the matching `.diff` resource.

## `https://patch-diff.githubusercontent.com/*`

GitHub redirects authenticated `.diff` requests to this GitHub-owned host. Beef needs access to read the requested unified diff after that redirect.

## `https://api.typesafe.ai/*`

Required to send the explicitly initiated pull-request classification request directly to TypeSafe AI over HTTPS using the user’s API key.
