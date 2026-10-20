# Derive The Billing Anchor From A Plan Upgrade

## Need

Billing months on the Allowance page fall back to UTC calendar months until the owner types a billing date. The owner asked for the app to compute the information it needs by itself.

## Evidence

- The Claude OAuth profile (`/api/oauth/profile`) returns `organization.subscription_created_at`, but past charges did not fall on that day of the month. It is not a billing anchor.
- The OAuth endpoints that Claude Code calls include no subscription-period endpoint.
- The snapshot plan label is not a reliable change signal. The `Max 20x` label first appeared when the profile-based label shipped, days after the actual upgrade.
- Anthropic bills through Stripe. A receipt for a Max 5x to Max 20x upgrade showed a new one-month period starting at the upgrade, and a credit for the unused Max 5x time after it. An upgrade therefore restarts the billing period.
- The cycle code already finds that moment as the latest regime boundary (`regimeStart` in `packages/providers/src/allowance-cycles.ts`): a reset inside a weekly cycle whose two sides cost clearly different dollars per percent. On live data it landed one poll after the upgrade.

## Rule

1. A manual `billingAnchor` setting wins.
2. Otherwise the anchor is the latest upgrade: a regime boundary where dollars per percent rose by more than the regime ratio. A downgrade usually takes effect at a period end, so it does not move the anchor. A reset-grant claim drops the meter without changing dollars per percent, so it is not a boundary.
3. Otherwise calendar months.

The detected time is the first reading after the upgrade, so it is late by at most one poll interval.

The open cycle so far is scanned too, so an upgrade applies before its weekly cycle ends. A cycle that starts before the history window is skipped: only part of a side's dollars is inside the window, so its dollars per percent can look like an upgrade.

`regimeStart` only sees cycles inside the 120-day cycle history, so the server saves the derived anchor as the provider setting `upgradeBillingAnchor` and uses the newer of the saved and the live value. Months before the anchor repeat it backward and may not match the earlier real periods; the page says so.

## Changes

- `packages/providers/src/allowance-cycles.ts`: `upgradeStart` (rising regime boundary), passed to billing.
- `packages/providers/src/allowance-billing.ts`: `upgradeAt` input, `anchorSource: "upgrade"`.
- `apps/server/src/quota-history.ts`: read and save `upgradeBillingAnchor`.
- `apps/web/src/lib/api.ts`, `apps/web/src/pages/allowance-billing.tsx`: the new source and its help line.
- Docs: `docs/USER_GUIDE_WEBUI.zh-TW.md`.

## Tests

- An upgrade gives the anchor at the boundary.
- A downgrade gives calendar months.
- A reset grant gives calendar months.
- A manual setting overrides the derived anchor.
- A saved anchor is used after the boundary leaves the history window.
- A reset grant in a cycle cut by the history window gives calendar months.
- An upgrade inside the open cycle applies before the cycle ends.

## Not In Scope

- Months before October have little or no token data; that is a data-retention question, not this rule.
- More than one anchor per provider.
