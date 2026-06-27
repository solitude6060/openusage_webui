# Triple Review: Upstream Sync (PR1 — `chore/upstream-sync-2026-06`)

Date: 2026-06-28
Scope: Task 1 of the 2026-06-28 track — security dependency bumps + fork hygiene.
Branch: `chore/upstream-sync-2026-06` (base `main`)
Commits: `3a7f950` (plan) · `2c3b10d` (security bumps) · `afa7ea0` (fork-hygiene doc)
Plan: `docs/plans/2026-06-28-upstream-sync-and-codex-reset-ux.md`

## Method

Three independent review passes (CLAUDE.md §5), one by a **different model** (Codex) to
catch divergent blind spots. Each reviewer worked from the local diff and re-ran the
verification commands themselves.

## Pass results

| # | Lens | Model | Verdict |
|---|------|-------|---------|
| A | Security / dependency correctness | Claude (code-reviewer) | APPROVE_WITH_NITS |
| B | Independent second opinion | **Codex** | APPROVE |
| C | Docs accuracy / completeness / git hygiene | Claude | APPROVE_WITH_NITS |

### Pass A — Security/dependency (APPROVE_WITH_NITS)
- vite GHSA-fx2h-pf6j-xcff: affected `>=8.0.0,<=8.0.15`, patched `8.0.16`. Our resolve =
  `8.0.16`. **Correct.** (CVE is Windows-dev-server-only, but still correct to patch.)
- undici GHSA-vmh5-mc38-953g / GHSA-vxpw-j846-p89q / GHSA-hm92-r4w5-c3mj: patched `7.28.0`.
  undici enters via `jsdom@29.0.1` (`^7.24.5`); without the override it would resolve to a
  vulnerable `7.27.x`. Override to `7.28.0` is **necessary and correct.**
- quinn-proto RUSTSEC-2026-0185 (HIGH, CVSS 7.5): patched `>=0.11.15`. Our lock = `0.11.15`,
  single copy. **Correct.**
- Residual-vulnerability check: lockfile contains exactly `vite@8.0.16` and `undici@7.28.0`,
  no vulnerable sub-copies. **Clean.**
- Missed-coverage check: **no gaps.** Also confirmed RUSTSEC-2026-0037 (already satisfied at
  0.11.14) and rustls-webpki RUSTSEC-2026-0098 (we have 0.103.13, above the vulnerable
  ceiling) need no action.

### Pass B — Codex independent (APPROVE)
- Independently re-ran the residual grep, Cargo.lock check, and `bun run test`
  (64 files / 1124 tests green). Confirmed docs/AGENTS.md facts match the diffs.
- Noted the `@tailwindcss/vite` peer-range item (see triage) as LOW, non-blocking.

### Pass C — Docs/hygiene (APPROVE_WITH_NITS)
- Plan + AGENTS.md internally consistent; no placeholders/TBD; version numbers and urgency
  tiers match across sections; the "12 commits" arithmetic checks out; AGENTS.md line
  references accurate.
- README needs no change (no plugin change). CHANGELOG omission is correct fork practice
  (only upstream's release ritual writes CHANGELOG entries; the fork never has).
- Commits Conventional + English; **no AI-attribution trailers**; TDD exception documented.

## Triage & disposition

| Finding | Severity | Real? | This PR? | Disposition |
|---|---|---|---|---|
| 3 bumps correct, lock clean, no missed advisories | — | yes (verified ×2) | — | Confirms correctness; no action |
| `@tailwindcss/vite` peer range `^5\|\|^6\|\|^7` vs vite 8 | minor | yes | **no — pre-existing** | Accept/defer. Not introduced here (we were already on vite 8.0.14); bun treats unmet peers as warnings; tests+build green. Follow-up only if Tailwind adds a hard upper bound. |
| Exact-pin overrides (`vite`/`undici`) = manual sync burden on future patches | nit | yes (process) | optional | **Keep exact pins** (deterministic, matches upstream #712, more secure). `package.json` is strict JSON so no inline comment is possible; documented here + in PR body: future security patches must bump BOTH `devDependencies` and `overrides`. |
| Plan §3 `normal` tone has no CSS class | nit | n/a | **no — PR2 item** | `normal` is intentionally the base pill style (no override). Will be explicit in PR2. |

**No blocking or major findings. No code fixes required**, so there is no separate fix-log
for this PR — all findings are confirmations, one pre-existing accepted item, or
documentation nits dispositioned above.

## Verification (re-confirmed at gate)
- `bun install` resolves; lock pins `vite@8.0.16`, `undici@7.28.0`.
- `apps/web` build OK on vite 8.0.16.
- `vitest` suite green: 1124 tests / 64 files.
- quinn-proto `0.11.15` resolved (single copy); full Tauri compile not runnable here
  (`libwebkit2gtk-4.1` absent) — bump verified at lockfile/semver level + matches upstream.

## Gate decision: **APPROVE — clear to merge**

Three independent passes APPROVE-level with only non-blocking nits, all dispositioned.
