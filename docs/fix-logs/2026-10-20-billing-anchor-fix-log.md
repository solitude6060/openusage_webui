# Fix Log: Derive The Billing Anchor From A Plan Upgrade

Review: `docs/reviews/2026-10-20-billing-anchor-review.md`.

## R1-1 Cut-Off Cycle Read As An Upgrade

- Reproduction: a reset with equal dollars per percent on both sides, in a cycle that starts before the history window, with the earlier side's first token hour outside the window.
- Fix: the upgrade sample drops every cycle that starts before `max(observationStartMs, tokenStartMs)`. The time is compared directly because `meter-fell` outranks `history-truncated` in `cycleExclusion`.
- Test: `ignores a reset grant in a cycle whose token history is cut off by the history window`.
- Files: `packages/providers/src/allowance-cycles.ts`, `packages/providers/test/allowance-billing.test.ts`.

## R1-2 Upgrade In The Open Cycle

- Reproduction: an upgrade at 04:42 on day four of a weekly cycle, read two days later.
- Fix: the open cycle is measured up to now and scanned with the completed cycles.
- Test: `finds an upgrade inside the open cycle before that cycle ends`.
- Files: as R1-1.

## R1-3 Deferred

The detected upgrade is not saved while a manual billing date is set, so clearing the date after the upgrade leaves the history falls back to calendar months. It needs a manual date set before the upgrade and cleared through the settings API more than 120 days later, because the page cannot submit an empty date. Recorded here; no change in this PR.

## R1-4 Guide Wording

`docs/USER_GUIDE_WEBUI.zh-TW.md` now says an unreadable manual date counts as no setting.
