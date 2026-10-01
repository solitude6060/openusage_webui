# Allowance Ranges And Codex Session Length

Date: 2026-09-30
Status: Implemented locally on 2026-09-30. Not committed.

The Allowance page needs the current subscription cycle, the previous cycle, 30 days, and this calendar month, beside 1, 3, 5, and 7 days. This month follows the computer's local calendar. Asia/Taipei is the clock on this machine.

Regular Codex is missing because `plugins/codex/plugin.js` stamps the primary meter as 5 hours. Stored resets for `codex:codex` since 2026-09-23 are about 7 days ahead, and the percent only returned to zero when a new cycle started. Codex-Family's session meter really does reset within 5 hours, so a short reset stays out. The account that owns the real `sessions` directory can be estimated from its own meter. The symlink account stays unconverted.

Docs to update: `docs/USER_GUIDE_WEBUI.zh-TW.md`, `docs/providers/codex.md`, `status.md`, `tracker.md`, `handover.md`.

Review correction, 2026-10-01: measurement endpoints must be actual observations within the selected range. Daily aggregates that overlap an endpoint or reset are not converted. Session duration evidence stays within the same reset timestamp; historical long sessions cannot qualify later five-hour sessions. See `docs/reviews/2026-10-01-grok-session-review.md`.
