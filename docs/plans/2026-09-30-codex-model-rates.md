# Codex Model Rate Table

Date: 2026-09-30
Status: Implemented locally on 2026-09-30. Not committed.

ccusage 20.0.26 puts `costUSD` on the day and omits it on each model. The importer then stored that day total on the first model and wrote 0 on the others. OpenAI's standard short-context rates are not zero. Checked on 2026-09-30 against https://developers.openai.com/api/docs/pricing: the published input, cached-input, and output rates reproduce ccusage's day total for the later September days, including gpt-6-astra, gpt-6-sol, gpt-6-luna, and gpt-6.1-sol.

The rate table prices each model from its own input, cached input, cache write, and output tokens. A model price already present on that model is kept. A day total is no longer copied onto the first model. One unpriced row can still keep a leftover day amount. Stored Codex rows are updated from the same table. The table is the standard short-context rate. A daily total does not say which requests used long context or Fast mode. September 5, 8, and 9, 2026 were higher than this table; those days use the table anyway.

Docs to update: `docs/USER_GUIDE_WEBUI.zh-TW.md`, `docs/providers/codex.md`, `status.md`, `tracker.md`, `handover.md`.

Review correction, 2026-10-01: retain explicit model costs first. Allocate a reported day cost only when one model cost remains unknown before applying the table. Apply table estimates only to Codex. An unknown model cannot inherit a remainder derived from estimated prices. Summary source precedence retains original records and prevents confirmed single-account legacy duplication. Historical one-shot rewrites from 2026-09-30 were not repeated by this review; the original backup remains outside the repository.
