# Post-PR2 Live Smoke

Date: 2026-06-18
Branch: `codex/webui-post-pr2-planning`
Base: `dev` at `203c6f8`

## Runtime

- `http://127.0.0.1:6736/api/health` returned `ok: true`.
- Port `6736` was already serving the WebUI, so no second server was started.
- Browser smoke used Playwright against `http://127.0.0.1:6736/`.

## Pages Checked

| Page | Desktop 1280px | Mobile 390px | Result |
| --- | --- | --- | --- |
| Dashboard | No horizontal overflow | No horizontal overflow | Pass |
| Providers | No horizontal overflow | No horizontal overflow | Pass |
| Sessions | No horizontal overflow | No horizontal overflow | Pass |
| Settings | No horizontal overflow | No horizontal overflow | Pass |

## Findings

| Finding | Evidence | Action |
| --- | --- | --- |
| Browser requested `/favicon.ico` and received 404 during smoke. | Playwright console log recorded `Failed to load resource: the server responded with a status of 404 (Not Found) @ http://127.0.0.1:6736/favicon.ico`. | Fixed by adding an explicit SVG favicon and app-shell test. |
| ccusage-backed provider card used the generic `Detected` label. | Gemini CLI / Google AI Pro is marked `via ccusage`, but the status label did not explain that shared source. | Fixed by labeling ccusage-backed providers as `Via ccusage` and adding a focused UI metadata test. |

## Verification After Fix

- `bun test apps/web/src/app-shell.test.ts`: passed.
- `bun test apps/web/src/provider-ui.test.ts --test-name-pattern "ccusage-backed"`: passed.
- Browser reload at `http://127.0.0.1:6736/?smoke=favicon`: no favicon 404; console showed only Vite connection and React DevTools info.
- Browser check at `http://127.0.0.1:6736/providers?smoke=status-label`: Gemini CLI / Google AI Pro showed `VIA CCUSAGE`.

## Screenshots

- `docs/reviews/screenshots/post-pr2-smoke-dashboard-desktop.png`
- `docs/reviews/screenshots/post-pr2-smoke-providers-desktop.png`
- `docs/reviews/screenshots/post-pr2-smoke-sessions-desktop.png`
- `docs/reviews/screenshots/post-pr2-smoke-settings-desktop.png`
- `docs/reviews/screenshots/post-pr2-smoke-dashboard-mobile.png`
- `docs/reviews/screenshots/post-pr2-smoke-providers-mobile.png`
- `docs/reviews/screenshots/post-pr2-smoke-sessions-mobile.png`
- `docs/reviews/screenshots/post-pr2-smoke-settings-mobile.png`
- `docs/reviews/screenshots/post-pr2-smoke-dashboard-favicon-fixed.png`
- `docs/reviews/screenshots/post-pr2-smoke-providers-status-label.png`
