# Provider Quota History

Date: 2026-09-27
Status: Implemented. On 2026-09-30 the dashboard table was replaced by the Allowance page. Ranges are 1, 3, 5, 7, and 30 days, this calendar month, the current reset cycle, and the previous cycle. See `docs/USER_GUIDE_WEBUI.zh-TW.md` section 5.5.

**Goal:** On the dashboard, show each provider account's quota windows, the tokens counted in that window, and whether the allowance moved or the probe failed.

**Docs to update when this is implemented:** `docs/USER_GUIDE_WEBUI.zh-TW.md`, `README_WEBUI.md`, `README_WEBUI.zh-TW.md`, `docs/providers/codex.md`, `docs/providers/cursor.md` if present.

## What the current records can answer

Checked against `~/.openusage-webui/openusage.sqlite` on 2026-09-27.

Snapshots (`source = api`, tool `OpenUsage Plugin Snapshot`) keep display lines. About 46,000 rows. The dashboard reads the latest 100 usage records and keeps one snapshot per provider.

A quota line looks like `{ type: progress, label: Weekly, used: 3, limit: 100, format: percent, resetsAt, periodDurationMs }`. `limit` is always 100 for these percent lines. The original API object is not stored.

Token rows are separate: one row per provider, UTC day, and model (`ccusage`, `Grok Session`, or `Cursor Usage Event`). They are not tied to a quota window.

Model names on Codex and Claude cards (`gpt-6-astra 49.9%`) are that model's share of local tokens over the ccusage range, about 30 days. They are not that model's weekly quota.

## What they cannot answer

「每個模型每週配到多少 token」 is not in the stored rows.

| Meter | Example on 2026-09-27 | Absolute allowance stored? |
|---|---|---|
| Codex account window | `codex:family` Weekly 3%, resets 2026-10-04. `codex:codex` has Session 58% and no Weekly line. | No. Plugin keeps `used_percent` only. |
| Codex / Claude model text | Share of local tokens | No. Not a quota. |
| Antigravity | Gemini Pro / Flash / Claude, 5-hour window, percent | No. Not a weekly window. |
| Grok | Weekly 41% | No. |
| Cursor | Total / Auto / API usage as percent. API usage is 100%. | The plugin reads `planUsage.limit` in dollars, then stores a percent. The dollar limit is dropped. |
| Copilot | Premium / Chat percent, monthly period | No. |

Probe failures overwrite `provider_status.last_error`. There is no failure history. A missing Weekly line is only visible by opening one snapshot.

Codex and Codex-Family share one `sessions` directory and now store token rows once, on Codex. Their rate-limit windows are different. Family Weekly at 3% must not be divided into the shared token total.

## Recording changes

Add `quota_observations`. One row per account, quota window, and observation time.

- `provider_id`, `observed_at`
- `window_key` (`weekly`, `session`, `model:gemini-pro`, `cursor:total-usage`)
- `window_label`, `period_ms`, `resets_at`
- `present` — false when a window seen in the previous observation is absent
- `used_percent`
- `limit_value`, `limit_unit` (`usd`, `tokens`, `requests`) when the API sends an absolute limit; otherwise null
- `used_value` when the API sends an absolute used amount

Write a row when percent changes by any amount, `resets_at` changes, presence changes, the absolute limit changes, or six hours have passed. Fractional decreases must remain visible to allowance validation. Replay existing snapshots under `quota_backfill_v2` to restore changes omitted by the former one-point threshold; retain existing rows. Do not add another full snapshot.

Also append probe failures (`provider_id`, `failed_at`, `message`) instead of keeping only the latest `last_error`.

Cursor: store `planUsage.limit` and spend in the observation before converting to percent. Claude: if `used` and `limit` are both numbers, store them beside the percent.

Keep the existing daily model token rows. Sum them into a weekly window only when the window is at least one day long. A 5-hour session window stays percent-only.

Do not compute an implied token allowance for a Codex account from the shared session log. For a single-home log (Claude, Grok, Cursor), implied allowance is `tokens in the window / (used_percent / 100)`, shown as an estimate, and only when `used_percent` is at least 20. Below that, the estimate swings too far (Family Weekly at 3% is in this range).

Backfill percent, `resets_at`, and `period_ms` from existing snapshot progress lines. Backfill cannot recover absolute limits that were never stored.

## Dashboard

A quota section, not more lines on the live cards.

Per account, one row per quota window:

- window name and reset time
- current used percent
- tokens summed inside the current window, when the window is daily-or-longer and the token log belongs to that account
- stated limit, when `limit_value` is present
- implied allowance, only under the rule above
- previous completed window's used percent and implied allowance, so a cut or an increase is a change in the allowance, not the rise of used percent during the week
- latest probe failure, and windows that disappeared

Model token rows sit under an account-level Weekly row as a breakdown of local usage. A model gets its own quota row only when the provider sends a model window (Codex `additional_rate_limits`, Antigravity Gemini Pro / Flash / Claude).

## Out of scope for the first slice

- Treating every model name on the card as its own weekly token grant
- Reconstructing 5-hour session windows from daily token rows
- Deleting the 46,000 historical snapshots
