# Store release checklist

## Generated deliverables

- `dist/beef-1.3.0.zip` — upload package; `manifest.json` is at the ZIP root.
- `assets/store-icon-128.png` — store icon.
- `assets/screenshot-review-1280x800.png` — current product screenshot.
- `assets/small-promo-440x280.png` — required small promotional tile.
- `listing.md` — listing and privacy-field copy.
- `permission-justifications.md` — permission explanations.
- `reviewer-instructions.md` — test flow for Chrome reviewers.
- `privacy-policy.html` — host this file at a public HTTPS URL and enter that URL in the dashboard.

## Manual dashboard steps

1. Host `privacy-policy.html` on a public HTTPS site.
2. Add a monitored support email or support URL to the listing.
3. Add a restricted, revocable TypeSafe test key in the private reviewer-credentials field.
4. Upload the ZIP and the three listing images.
5. Complete the Privacy tab exactly as documented in `listing.md`.
6. Start with Private visibility for trusted testers, then submit a new version for Public visibility.

Run `./store/package-store.sh` from the `beef` directory after every version change.
