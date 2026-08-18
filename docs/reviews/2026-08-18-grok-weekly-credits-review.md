# Review: Grok Weekly Credits

Date: 2026-08-18
Branch: `fix/grok-weekly-credits`
Reviewer: independent code-reviewer subagent

## Verdict

REQUEST CHANGES, then fixed in this branch.

## Findings

| Finding | Severity | Verified | Action |
|---------|----------|----------|--------|
| `onDemandCap: {}` threw `Grok billing response changed.` Official Swift treats missing `val` as 0. | Critical | `plugins/grok/plugin.js` `unitsValue` returned null on `{}`; live SuperGrok Heavy can omit proto3 zero fields | Fixed: empty object is 0. Regression test added. |
| Weekly line missing `"period": "weekly"` in `plugin.json` | Important | `docs/plugins/schema.md` and Claude/Codex/Kimi/Z.ai/Devin manifests | Fixed. |
| Credits field list sat under `GET /settings` | Important | `docs/providers/grok.md` | Fixed: moved under `/billing?format=credits`. |

## Verification

- `bunx vitest run plugins/grok/plugin.test.js` — 26 passed
- `bun test packages/providers/test/openusage-plugin-local-fixtures.test.ts` — 10 passed
- Live `POST /api/providers/grok/refresh` on this SuperGrok Heavy login — `ok: true`, plan SuperGrok Heavy, Weekly 0%, Pay as you go Disabled
- Dashboard after screenshot: `docs/reviews/2026-08-18-grok-weekly-after.png`
