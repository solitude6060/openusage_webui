# Rename the fork to AI Subscription Dashboard (aisubdash)

Date: 2026-11-08. Owner decision: repository name `ai-subscription-dashboard`, short name `aisubdash`.

## Reason

`TRADEMARK.md` forbids "OpenUsage" as the name of a fork and requires the fork to state that it is not the official OpenUsage. `LICENSE` (MIT) keeps the Robin Ebers copyright notice unchanged.

## In scope

User-facing names of this fork:

- `apps/web/index.html` page title.
- `apps/web/src/App.tsx` sidebar heading.
- `apps/web/public/favicon.svg` accessible label.
- `apps/web/src/pages/settings-page.tsx` help text that names the app.
- `plugins/ollama/plugin.js` host message and its row in `docs/providers/ollama.md`.
- Titles and self-references in `README.md`, `README_WEBUI.md`, `README_WEBUI.zh-TW.md`, `docs/USER_GUIDE_WEBUI.zh-TW.md`, with a fork statement linking upstream.

## Out of scope

- References to upstream OpenUsage as the source of plugins ("OpenUsage Plugin" labels, `OpenUsagePluginProvider`): these describe the upstream origin, which `TRADEMARK.md` permits.
- `~/.openusage-webui/` data directory, `OPENUSAGE_WEBUI_*` environment variables, `@openusage-webui/*` package names, browser storage keys: renaming them breaks the running deployment and needs a migration.
- Upstream Tauri desktop app files.
- GitHub repository name, description and homepage: changed only after a separate owner confirmation.
- A global `aisubdash` CLI command: not requested.

## Verification

- `bun run test:webui` passes.
- `bun run build:webui` passes; the built page title and sidebar show the new name.
- `grep` finds no remaining "OpenUsage WebUI" in the in-scope files.
