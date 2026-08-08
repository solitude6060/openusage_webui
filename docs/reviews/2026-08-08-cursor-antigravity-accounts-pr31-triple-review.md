# Triple Review: Cursor + Antigravity Provider Accounts (PR #31 — `feat/webui-cursor-antigravity-accounts`)

Date: 2026-08-08
Scope: 8 verified findings from a 3-model code review of the Cursor + Antigravity provider
accounts feature, fixed per `docs/plans/2026-07-31-cursor-antigravity-accounts.md`.
Branch: `feat/webui-cursor-antigravity-accounts` (base `main`)

## Method

Five-agent parallel review gate (review-work): Goal verification (Oracle), QA by running
the app, Code quality (Oracle), Security (Oracle), Context mining. All five must pass.

## Review gate results

| # | Lens | Agent | Verdict |
|---|------|-------|---------|
| 1 | Goal & constraint verification | Oracle | PASS (HIGH) |
| 2 | QA — hands-on app execution | Sisyphus-Junior | PASS (HIGH) |
| 3 | Code quality | Oracle | PASS (HIGH) |
| 4 | Security (supplementary) | Oracle | PASS (NONE) |
| 5 | Context mining | Sisyphus-Junior | PASS (HIGH) |

## Findings fixed (8, verified by the review gate)

1. **Provider paths/labels** (`911fac9`): default antigravity paths fall back to CLI unless
   IDE-shaped; Google email no longer baked into provider labels.
2. **`homeEnvVarLabel` in core** (`dc24062`): antigravity capability carries
   `OPENUSAGE_ANTIGRAVITY_CLI_HOME` label.
3. **Env var label surfaced in settings** (`d9d5ea3`): help text uses the label, not the
   compound env var string.
4. **Per-provider Add Manually placeholders** (`70aa5d5`): antigravity shows
   "Antigravity · Main" / "~/.agy-homes/acct1" instead of the codex fallback; new
   `apps/web/src/settings-page.test.ts`.
5. **Dashboard duplicate summary fallback** (`88f540e`): collapsed duplicate quota line.
6. **Plugin token/plan/badge** (`20bab7f`): honor CLI oauth expiry, never use `id_token`
   as bearer, derive plan via `loadCodeAssist` and account badge basename for pinned homes.
7. **Docs** (`fb10ec8`, `e5f3532`): antigravity detection/CLI-IDE classification docs;
   deferred follow-ups recorded.
8. **P1 from QA gate** (`8350465`): `readAgyPlan` now falls back to `allowedTiers[0].name`
   — the live `loadCodeAssist` response carries `allowedTiers`/`ineligibleTiers`, not
   `paidTier`/`currentTier`, so pinned cards never showed a plan chip. Re-verified live:
   acct1 card renders "Gemini Code Assist"; default card still "Google AI Pro"; 3 new
   regression tests (696/696 plugin tests green).

## QA live evidence (port 6738, real DB, user's 6736 service untouched)

- Placeholders: codex/claude-code/cursor/antigravity all correct; env help text uses
  `homeEnvVarLabel`.
- Detect Homes labels email-free; account label "Antigravity · acct1".
- Dashboard: `antigravity:acct1` badge "acct1" + plan chip "Gemini Code Assist"; default
  Antigravity card plan "Google AI Pro"; quota bars render, no duplicate fallback.
- A/B: stale service still shows old "Codex · Family" placeholder — fix is user-visible.
- Baseline: `vitest run plugins` 696/696; `bun test` 178 pass + 4 pre-existing env
  failures (reproduced on pre-fix commit) + 1 ccusage timing flake (passes in isolation).

## Outcome

All five passes green. Merged into `main` per the user's decision.
