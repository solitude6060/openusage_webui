# Review: Allowance Monthly Summary And Codex Account Attribution

Plan: `docs/plans/2026-11-08-allowance-monthly-summary.md`. Review inputs and raw outputs:
`docs/reviews/2026-11-08-allowance-monthly-summary.local/` (not tracked).

Owner decision 2026-11-08: reviewers are Grok Build `grok-4.7` xhigh, AGY `gemini-3.8-flash-high`, and
Claude Opus 5.5 high (AGY first, then Claude Code). The orchestrator and the implementers are Claude
Opus 5.5, so lane 3 shares their family by owner choice; it ran in a separate read-only session.

## Round 1

- Base `ec01a33f`, head `e709c816`. Diff `r1/target.diff`, SHA-256 `717f769a…ba387`.

| Lane | Client and model | Verdict | Raw output |
|---|---|---|---|
| 1 | Grok Build `grok-4.7`, effort xhigh | REQUEST_CHANGES | `r1/lane1-grok.jsonl`, `r1/lane1-grok.final.md` |
| 2 | AGY `gemini-3.8-flash-high`, effort high | No verdict | `r1/lane2-gemini-attempt1.*`, `r1/lane2-gemini.stall.txt` |
| 3 | Claude Code `claude-opus-5-5`, effort high | REQUEST_CHANGES | `r1/lane3-opus-cc.jsonl`, `r1/lane3-opus-cc.final.md` |

- Lane 1: the first launch did not start the reviewer (shell word-splitting error,
  `r1/lane1-grok.invocation-error.stderr`); the second launch is the review.
- Lane 2: output stopped at 2026-11-07T17:02:08Z on a file read; no event by 17:22:59Z; the process was
  stopped. Retried in round 2 on the full diff.
- Lane 3: AGY `claude-opus-5-5-high` returned `RESOURCE_EXHAUSTED` (credits) at 17:03Z with no review
  (`r1/lane3-opus-agy-failed.*`); Claude Code ran the same model and effort.

## Triage

| ID | Finding | Source | Severity | Verified | Disposition |
|---|---|---|---|---|---|
| R1-1 | A rescan deletes every stored event at or after the earliest file event, including events whose files are gone. | Opus | HIGH | Yes: `replaceFrom` and `DELETE ... observed_at >= ?` | Fixed: replace by event identity |
| R1-2 | A missing `auth.json` changes the map key; the rescan's fallback leaves events unmapped and they are deleted. | Opus | MEDIUM | Yes: ENOENT returns no hash | Fixed by R1-1; test added |
| R1-3 | S5 dollars enable regime and upgrade detection for Codex; a false `upgradeBillingAnchor` would be saved during a GET. | Opus | MEDIUM | Yes: `regimeShift` returned false only on null dollars | Fixed: allocated dollars ignored by detection. No boundary on the database copy before or after |
| R1-4 | Any non-weekly window is labeled a monthly billing month. | Opus | LOW | Yes | Fixed: at least 27 days |
| R1-5 | A meter above 100% can still show a percent. | Opus | LOW | Yes: Cursor `totalPercentUsed` has no cap | Fixed: "Over Included Usage" |
| R1-6 | S5 tests only run in UTC; the hourly ccusage path is untested. | Opus | LOW | Yes | Fixed: tests only (passed before the change) |
| R1-7 | `docs/providers/codex.md` quotes an old label; README not updated; reset-credit result not recorded. | Opus | LOW | Yes | Fixed: codex.md; README has no Allowance column or tab text (no change); reset-credit result recorded in the plan |
| G-R1-1 | A rescan that parses no event saves the new map key and keeps old cursors, so the reassigning rescan is consumed. | Grok | HIGH | Yes: `saveCodexEventCursors` returns on an empty list | Fixed: such a rescan is incomplete |
| G-R1-2 | With two separate sessions directories, a missing one leaves the scan complete and deletes both accounts' events after `earliest`. | Grok | HIGH | Yes: ENOENT leaves `complete` true | Fixed by R1-1 and a missing path with stored cursors marks the scan incomplete |
| G-R1-3 | A first line over 4 MiB returns "no creator" instead of a failed read. | Grok | LOW | Yes | Fixed |
| G-R1-4 | The original ADR bullet still says an empty directory clears stored events. | Grok | LOW | Yes | Fixed |

Integration wiring: `api.ts` types match the server output; the new optional `costAllocated` field on
cycle segments is not read by the web app. Dashboard totals do not use the allocated rows.

## Round 2

- Repairs merged at `bef4b709`. Remediation diff `r2/remediation.diff` (`e709c816..bef4b709`), full diff
  `r2/target-full.diff` (`ec01a33f..bef4b709`).

| Lane | Client and model | Target | Verdict | Raw output |
|---|---|---|---|---|
| 1 | Grok Build `grok-4.7`, effort xhigh | Remediation diff | APPROVE | `r2/lane1-grok.jsonl`, `r2/lane1-grok.final.md` |
| 2 | AGY `gemini-3.8-flash-high`, effort high | Full diff (retry of the stalled round 1 lane) | APPROVE | `r2/lane2-gemini.jsonl`, `r2/lane2-gemini.final.md` |
| 3 | Claude Code `claude-opus-5-5`, effort high | Remediation diff | REQUEST_CHANGES | `r2/lane3-opus-cc.jsonl`, `r2/lane3-opus-cc.final.md` |

Lanes 1 and 3 report R1-1 to R1-6 and G-R1-1 to G-R1-4 fixed. Lane 3 reports R1-7 partly fixed (README).

| ID | Finding | Source | Severity | Verified | Disposition |
|---|---|---|---|---|---|
| R2-1 | A deleted home with old cursors makes every rescan incomplete; no Codex event is stored for any account and every refresh rereads all files. | Opus | MEDIUM | Yes: `hadSessions` plus the early return in `saveCodexEventScan` | Fix: an incomplete rescan stores what it read and its cursors, without the map key |
| R2-2 | An oversized first line causes the same freeze. | Opus | LOW | Yes | Fixed by R2-1 |
| R2-3 | The logout test passes even if the rescan saves nothing. | Opus | LOW | Yes | Fix: assert `complete` and the key change |
| R2-4 | A rescan that finds no events logs `codex_event_rescan_incomplete` on every refresh. | Opus | LOW | Yes | Fix: separate log event |
| R2-5 | Segment climbs can show more than 100%. | Opus, Grok | LOW | Yes: `formatPercent(segment.endPercent - segment.startPercent)` | Fix: `meterPercent` |
| G-R2-1 | Row-by-row delete and insert lets two rescanned rows with equal time and total under different providers delete each other. | Grok | LOW | Yes: per-row `remove` then `insert` | Fix: all deletes, then all inserts |
| G-R2-3 | The hourly ccusage cost test cannot tell the hourly path from the daily one. | Grok | LOW | Yes | Fix: add a daily row with a different cost |
| R1-7 (rest) | `README.md` still says Codex aligns to a day boundary. | Opus, Gemini | LOW | Yes: README lines 181-189 | Fix: README sentence |
