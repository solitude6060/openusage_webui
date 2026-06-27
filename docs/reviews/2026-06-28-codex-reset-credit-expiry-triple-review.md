# Triple Review: Codex Reset-Credit Expiry + Dashboard UX (PR2 — `feat/codex-reset-credit-expiry`)

Date: 2026-06-28
Scope: Task 2 (port codex-reset-watcher reset-credit expiry detection) + Task 3 (dashboard
UX polish), per `docs/plans/2026-06-28-upstream-sync-and-codex-reset-ux.md`.
Branch: `feat/codex-reset-credit-expiry` (base `main`)

## Method

Three independent passes (CLAUDE.md §5), one by a **different model** (Codex). Distinct
lenses: plugin/detection logic, independent whole-feature, UI/CSS/UX/a11y.

## Pass results

| # | Lens | Model | Verdict |
|---|------|-------|---------|
| A | Plugin / detection logic | Claude (code-reviewer) | APPROVE_WITH_NITS |
| B | Independent whole-feature | **Codex** | REQUEST_CHANGES |
| C | UI / CSS / UX / a11y | Claude | APPROVE_WITH_NITS |

### Pass A — plugin/detection (APPROVE_WITH_NITS)
Confirmed: tier boundaries non-overlapping (`expired ≤0 < urgent ≤1d < soon ≤3d < week ≤7d
< normal`); `toIso(expiresSec)` lossless for second-precision (the `<1e10 → ×1000` heuristic
holds for any real-world date < year 2286); no NaN leak; ascending sort = soonest first;
gate `available_count > 0` correct; the `try/catch` fully isolates the secondary fetch
(Session/Weekly added before it); headers mirror the proven `fetchUsage` set; tests cover
all tiers, ordering, tolerant decode, empty cases, and both failure modes.

### Pass B — Codex independent (REQUEST_CHANGES)
Suites + build green. Two MEDIUM findings (see triage #1, #2).

### Pass C — UI/CSS/UX (APPROVE_WITH_NITS)
Confirmed the specificity fix empirically (`.usage-text-line > span:last-child` 0,2,1 did
outrank `.status-pill.reset-*` 0,2,0; the nested `.usage-credit-expiry-header` makes the
pill no longer that direct last-child, so its tier color wins); `badgeToneClassName` is
injection-safe; all tier tokens + `--caution` exist in light **and** dark; docs match the
producer; a11y satisfied (text + dot, not color alone). Findings: triage #2 (corroborated),
#3, #6, #7.

## Triage & disposition

| # | Finding | Severity | Real? | Fix this PR? |
|---|---|---|---|---|
| 1 | Countdown computed at render with no ticker — not truly live (also true of the pre-existing window-reset lines) | MEDIUM | yes | **Yes** — add a 60s tick so all relative times stay fresh |
| 2 | Invalid `expiresAt` → `formatDate`→`Intl…format()` throws `RangeError`; no error boundary → blank dashboard | MEDIUM | yes (severe blast radius; not reachable from codex but the field is generic) | **Yes** — validate before `formatDate`; fall back to the legacy path |
| 3 | Credit lapsing between refreshes: text flips to "Expired" but pill keeps the red `urgent` color + filled dot | nit | yes | **Yes** — compute an effective tone live so styling matches text |
| 4 | test-helper `parseDateMs` numeric path lacks the `<1e10 → ×1000` heuristic that production has | minor | yes (test-vs-prod drift) | **Yes** — align helper + add a numeric-seconds test |
| 5 | The `available_count = 0` test doesn't assert the secondary endpoint was skipped | nit | yes (test gap) | **Yes** — add the assertion |
| 6 | `soon` light pill contrast 3.75:1 (just under 4.5:1; in line with pre-existing `--muted`) | nit | marginal | **Yes** — darken `--caution` to clear 4.5:1 |
| 7 | Legacy badge path still applies `tone`; a `reset-*` tone *without* `expiresAt` would re-hit the specificity bug | nit | not reachable from codex (always pairs tone+expiresAt) | Accept — documented; codex never emits that shape |

No findings were false positives. Verifications (suites green, build green, epoch heuristic,
failure isolation, docs accuracy) were independently re-confirmed.

## Outcome

Fixes landed in TDD order (see `docs/fix-logs/2026-06-28-codex-reset-credit-expiry-fix-log.md`).

**Re-review: APPROVE (both passes).**

- **Codex (re-check of its two MEDIUM findings):** APPROVE. Confirmed the 60s ticker
  (correct `clearInterval` cleanup, no leak) and the crash guard (invalid `expiresAt` can no
  longer reach `Intl`); tests + build green; no new blockers.
- **Claude adversarial verifier (all six fixes):** APPROVE. Independently verified every
  edge case of `resetCreditExpiryView` (empty/undefined/"Invalid Date"/valid), the `formatDate`
  guard, the ticker's re-render cascade (Strict-Mode safe), the `parseDateMs` alignment as
  functionally identical to production (incl. NaN), that the numeric/skip-at-0 plugin tests
  would fail under the old behavior, and recomputed the `--caution` contrast at 4.63:1.
  No regressions.

Automated gate: `vitest` 1138, provider/web 33, web build, 4.63:1 contrast — all green.
Merged into `main` per the user's decision.
