# Claude Resets, Credits And Allowance Segments — Fix Log

Review record: [round 1](../reviews/2026-10-19-claude-resets-allowance-review.md). The reviewed revision is `45d0741c`.

| Finding | Reproduction (red test) | Repair | Tests Added | Files |
| --- | --- | --- | --- | --- |
| R1-1 month-end reading | `698db4f` "leaves a reading at the month end out of the earlier month": September 80, expected 40. "adds no climb to a month from a segment that ends at its start": October 29, expected 27 | `d27a299`: `span.to <= from` skips a segment that ends at the month start; a segment end equal to the month end uses the readings inside | 2 | `packages/providers/src/allowance-billing.ts` |
| R1-2 regime from baseline sample | `698db4f` "keeps splitting a month at a regime change after four newer cycles": one part, expected two | `d27a299`: billing months use every cycle, not the four-cycle sample | 1 | `packages/providers/src/allowance-cycles.ts` |
| R1-3 anchor validation | `698db4f` PUT `not-a-date` returned 200. `1bdfc9b` PUT `October 19, 2026` returned 200 | `d27a299` refuses an unparseable value; `1c3ea6a` requires `Z` or an offset. An empty value still clears the setting | 1 (2 cases) | `apps/server/src/index.ts`, `apps/server/test/api.test.ts` |
| R1-4 earlier peak counted again | `1bdfc9b` "does not count a peak from before the month again in the month": October 26, expected 22 | `1c3ea6a`: the segment maximum is used only when the whole segment lies inside the month | 1 | `packages/providers/src/allowance-billing.ts` |
| R1-5 excluded cycle hides regime | `1bdfc9b` "keeps the regime change when the cycle that shows it is excluded": `regimeChanged` false | `1c3ea6a`: the boundary is searched in every completed cycle back to the oldest usable one; only included cycles pool | 1 | `packages/providers/src/allowance-cycles.ts` |
| R1-6 gap hours dropped | `1bdfc9b` "counts an hour that lies wholly between a reset's readings in the earlier segment once": segment end 04:22 | `1c3ea6a`: a segment ends at the next run's first reading. A dropped run (one reading, no climb) keeps its own range out | 1 | `packages/providers/src/allowance-cycles.ts`, `allowance-billing.ts` (`reading.at < span.to`) |
| R1-7 desktop log redaction | `8864176` "redact_body_redacts_claude_profile_and_reset_grant_fields": the uuid stayed in the redacted body | `fd2ded2`: `id`, `uuid`, `full_name`, `display_name`, `next_grant_id` join the sensitive keys; a flat `event_props` object becomes `[REDACTED]` | 1 | `src-tauri/src/plugin_engine/host_api.rs` |

## Notes

- Expectation corrections:
  - The R1-6 red test expected 10_100 tokens in the earlier segment. The 04:00 hour also lies wholly inside that segment, so the correct value is 10_150. It was corrected in `1c3ea6a`.
  - The existing segment test's first segment end moved from 04:22 to 04:42, by design.
- A first R1-6 attempt ended each segment at the next *kept* segment. That attributed a dropped run's tokens to the earlier segment: the test "leaves out a later segment that has only one reading" went from 1.00 to 1.11 dollars per percent. The repair ends at the next run instead.

## Checks After Repair (`1c3ea6a`)

- `bunx vitest run`: 69 files, 1339 passed.
- `bun test packages/providers/test apps/server/test apps/web/src`: 527 passed, 0 failed.
- `bun run build:webui`: exit 0.
- Database copy (`../openusage_webui-artifacts/2026-10-19-claude-allowance/billcheck/`):
  - Claude October parts are 224% of 188.5% and 129% of 73.8%.
  - The Claude baseline is 15.56 dollars per percent, n=1, with `regimeChanged` true, unchanged from `45d0741`.

## R1-7 Verification Limit

- `src-tauri` does not build on Linux. After the missing `-dev` packages were supplied from extracted `.deb` files, the build stopped at `tauri-nspanel`, which needs macOS `objc2_app_kit`. The earlier `libssl-dev` diagnosis was the first failure, not the only one.
- The redaction functions and their tests were copied verbatim into a standalone crate (`../openusage_webui-artifacts/redaction-harness/extract.sh`). It ran red at `8864176` and 23 of 23 tests pass at `fd2ded2`.
- A nested object inside `event_props` is not matched by the flat-object pattern.
