# Provider Accounts PR #29 Review (Grok 4.5)

Date: 2026-07-30
PR: https://github.com/solitude6060/openusage_webui/pull/29
Branch: `feat/webui-codex-multi-instance`

## Initial verdict

**REQUEST CHANGES**

## Final verdict (re-review)

**APPROVE** (Grok 4.5, 2026-07-30)

All Important/High/Medium triage rows fixed with tests. Remaining actionable findings: none.

See `docs/GROK_2026-07-30_PROVIDER_ACCOUNTS_PR29_FIX_LOG.md`.

## Triage

| Finding | Severity | This PR? | Why |
|---|---|---|---|
| Compat `/api/codex/instances*` mutates non-Codex accounts | Important | Yes | Scope assert `providerId === "codex"` |
| Dashboard/Sessions show raw ids | Important | Yes | Use `providerLabel(id, status.name)` |
| Delete leaves usage; slug reuse rebinds history | Important | Yes | Delete usage rows for that providerId |
| All-disabled accounts hide bare provider | High | Yes | Swap only on enabled accounts |
| Duplicate home via tilde vs absolute | Medium | Yes | Normalize both sides before compare |
