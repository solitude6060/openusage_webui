# Open-Source Hygiene Fix Log — 2026-10-11

> Branch: `chore/open-source-hygiene` (base `main` = `29ee7f1`)
> Artifacts: `../openusage_webui-artifacts/2026-10-11-hygiene/`

This repository is public. Before publishing the 2026-10-11 work, the orchestrator scanned tracked
files for maintainer emails, real IPs/hostnames, personal home paths, keys and account ids.

| Commit | Change |
|--------|--------|
| first `chore:` commit | Real Tailscale address in `apps/server/test/api.test.ts` replaced with `100.64.0.1`; `/home/<maintainer>/` paths in `account-detect.test.ts` replaced with `/home/user/`; plan doc points at the artifacts directory relatively; README.md describes hourly Allowance alignment |
| `159422a` `test:` | `sessions-page.vitest.tsx` card test waited for the list, which renders empty before records load; it now waits for the record text (failed intermittently on several branches; 4 consecutive full vitest runs green after) |
| `1ea03c8` `chore:` | Remaining maintainer name in a Windows fixture path and a `.tailnet.example` hostname replaced |

Not changed (recorded): upstream-authored fixtures — the Kiro AWS ARN in `docs/providers/kiro.md` and
tests (upstream commit `96eede6`), and upstream author emails / account ids in `src-tauri` redaction
tests (upstream commit `03757a6`). They predate this fork's work, are already public upstream, are not
this maintainer's data, and the Rust tests cannot be compiled here. Candidate report to upstream.

The real Tailscale address remains in earlier public git history; removing it would require a
history rewrite and force-push (not done; the address is reachable only inside the tailnet).

Reviews: round 1 (`29ee7f1..159422a`) Grok REQUEST_CHANGES (1 LOW in scope, 2 MEDIUM upstream
fixtures), AGY REQUEST_CHANGES (HIGH `C:\Users\<maintainer>`, MEDIUM hostname), Codex lane failed on
`~/.codex` usage limit (no review). Round 2 (`29ee7f1..1ea03c8`, Codex on `~/.codex-family`): all three
lanes APPROVE.
