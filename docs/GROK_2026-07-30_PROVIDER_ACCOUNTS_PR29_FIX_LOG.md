# Provider Accounts PR #29 Fix Log (Grok 4.5)

Date: 2026-07-30
PR: https://github.com/solitude6060/openusage_webui/pull/29
Review: `docs/GROK_2026-07-30_PROVIDER_ACCOUNTS_PR29_REVIEW.md`

| Finding | Fix | Tests |
|---|---|---|
| Compat Codex routes mutate Claude | `assertCodexCompatAccountId` before PATCH/DELETE | API rejects `claude-code:work` |
| Raw ids on Dashboard/Sessions | `providerLabel(id, status.name)` + Sessions gets providers | existing provider-ui test |
| Delete leaves usage | `deleteUsageRecordsForProvider` on account delete | storage test |
| All-disabled hides bare card | Registry swaps only on **enabled** accounts | registry fallback test |
| Tilde vs absolute duplicate home | Compare `normalizeHomePath` on both sides | API tilde duplicate test |
