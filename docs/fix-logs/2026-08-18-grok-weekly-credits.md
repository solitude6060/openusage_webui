# Fix Log: Grok Weekly Credits

Date: 2026-08-18
Review: `docs/reviews/2026-08-18-grok-weekly-credits-review.md`

## Cause

SuperGrok Heavy unified billing reports `monthlyLimit.val = 0`. The old plugin required a positive monthly pool, so a live 200 from `GET /v1/billing` still threw `Grok billing response changed.`

Official OpenUsage and the Grok CLI now read `GET /v1/billing?format=credits`. Missing proto-JSON zeros mean 0, not a schema break.

## Fixes

| Finding | Change |
|---------|--------|
| Monthly parser rejected `monthlyLimit = 0` | Read the CLI credits endpoint. Show Weekly when `currentPeriod.type` is `USAGE_PERIOD_TYPE_WEEKLY`. Missing `creditUsagePercent` is 0%. |
| `onDemandCap: {}` treated as a schema break | Empty object, omitted field, or `{val:0}` is disabled pay-as-you-go. |
| Weekly line lacked `"period": "weekly"` | Added in `plugins/grok/plugin.json`. |
| Credits fields documented under `GET /settings` | Moved under `GET /billing?format=credits`. |
| README still listed only the adapter name | README and README_WEBUI now say weekly pool, plan, and pay-as-you-go cap. |

## Tests

- `plugins/grok/plugin.test.js` — credits URL, omitted percent, string percent, non-weekly omits Weekly, empty/zero/omitted cap, legacy monthly throws with `currentPeriod` log
- `packages/providers/test/openusage-plugin-local-fixtures.test.ts` — fixture expects labels `Weekly` and `Pay as you go`

## Live check

Dashboard after refresh on this SuperGrok Heavy login: plan SuperGrok Heavy, Weekly 0% used / 100% left, Pay as you go Disabled. Screenshot: `docs/reviews/2026-08-18-grok-weekly-after.png`.

## Deferred

Local spend tiles from `~/.grok/logs/unified.jsonl` wait until this card is accepted. The log on this machine has no `inference_done` rows yet.
