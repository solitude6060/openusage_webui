# Review: rename the fork to aisubdash (PR #65)

Base: main `c5f21d5af7aec7a25eccae6f2150bd12b688cff8`. Round 1 head: `87bae2d19ecbcae2fd3a55efe7471dc1e2aa1827`.
Raw outputs: `docs/reviews/2026-11-08-rename-aisubdash.local/r1/` (gitignored).

## Round 1 lanes

| Lane | Client and model | Verdict |
| --- | --- | --- |
| 1 | Grok Build `grok-4.7`, xhigh | REQUEST_CHANGES |
| 2 | AGY `gemini-3.8-flash-high`, high | APPROVE |
| 3 | Claude Code `claude-opus-5-5`, high (owner-specified Opus lane; orchestrator is also Claude Code) | REQUEST_CHANGES |

## Triage

| Finding | Source | Severity | Verified evidence | Disposition |
| --- | --- | --- | --- | --- |
| README screenshot still shows "OpenUsage WebUI" | Opus 1 | MEDIUM | `docs/screenshots/webui-dashboard.png` sidebar heading reads "OpenUsage WebUI" | Fixed: heading region repainted as "aisubdash" (Inter 700); other pixels unchanged, so no new usage data is published |
| Upstream README section reads as this fork's own | Grok 1, Opus 2 | MEDIUM | `README.md` lines 103-254 describe the macOS app, download, sponsors | Fixed: a note before the section states it is the upstream README and that only "WebUI Fork Status" describes this fork |
| User guide lacks the fork statement | Grok 2, Opus 4 | MEDIUM / LOW | `docs/USER_GUIDE_WEBUI.zh-TW.md` had no fork line | Fixed: statement added under the title |
| zh-TW fork sentence negation is ambiguous | Grok 3, Opus 5 | LOW | `README_WEBUI.zh-TW.md:3` | Fixed: reworded in both zh-TW files |
| `docs/providers/ollama.md:20` calls the app OpenUsage | Gemini | LOW | Line 20 refers to this app | Fixed |
| `.github` issue templates and CODEOWNERS are upstream's | Opus 3 | LOW | `.github/ISSUE_TEMPLATE/*.yml`, `.github/CODEOWNERS:2` | Deferred: in-repo `.github` files, not listed in the plan scope; tracked in the project `tracker.md` (local, gitignored) (2026-11-08 rename follow-up) |
| `ou-status` alias may read as OpenUsage | Opus 6 | LOW | `README.md:74-86` suggested alias only | Deferred: plan excludes a CLI command |

No reviewer found a broken test, string comparison or deployment identifier.

## Round 2

Head `2d8cc00e1eb8abe44a187a219bceee14cd91cadc`. Raw outputs: `docs/reviews/2026-11-08-rename-aisubdash.local/r2/`.

| Lane | Verdict | Findings |
| --- | --- | --- |
| Grok Build `grok-4.7` xhigh | REQUEST_CHANGES | LOW: upstream note mislabels fork-edited Supported Providers entries (`README.md:133,134,138,143`) |
| AGY `gemini-3.8-flash-high` | APPROVE | none |
| Claude Code `claude-opus-5-5` high | REQUEST_CHANGES | MEDIUM: same as Grok; LOW: `.github` deferral reason wrong and untracked |

The README finding was verified against `README.md:133-143`; both findings accepted. Fixed: the note now says the sections are adapted, and that WebUI, Pi, Tokens-page and Ollama entries describe aisubdash only. Deferral reason corrected and tracked in `tracker.md`.

## Round 3

Head `aeb975775620ca82ce6c256f29420465105f6788`. Raw outputs: `docs/reviews/2026-11-08-rename-aisubdash.local/r3/` (gitignored). Same three lanes and models as round 1.

| Lane | Verdict | Findings |
| --- | --- | --- |
| Grok Build `grok-4.7` xhigh | REQUEST_CHANGES | MEDIUM: note labels whole provider entries as fork-only although they list upstream quota fields; LOW: "Built Entirely with AI" not covered; LOW: fix-log table broken |
| AGY `gemini-3.8-flash-high` | APPROVE | none |
| Claude Code `claude-opus-5-5` high | REQUEST_CHANGES | LOW: fix-log table broken; LOW: `.github` fix has no row; LOW: sections not covered; LOW: whole-entry attribution; NIT: review wording |

All findings verified against `README.md:133-143` and `:235-260` and the fix log, and fixed: the note now treats every section as upstream unless listed, and lists fork additions by fragment.

Gate decision: no round produced a CRITICAL or HIGH finding, so the acceptance criterion of the documentation review termination rule (CORE_PROCESS section 5) was met from round 1 onward. Code files (`apps`, `packages`, `plugins`) are unchanged since the round 1 head, where no lane raised a code finding. Round 3 findings are README and record wording; they were fixed without a fourth round. After round 3, the note also gained the OpenRouter entry (fork commit `fadfeb2f` added that plugin) and "Unless listed here" wording; this change was not model-reviewed.
