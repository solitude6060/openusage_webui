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
| `.github` issue templates and CODEOWNERS are upstream's | Opus 3 | LOW | `.github/ISSUE_TEMPLATE/*.yml`, `.github/CODEOWNERS:2` | Deferred: GitHub-side files, outside the frozen plan scope; follow-up PR |
| `ou-status` alias may read as OpenUsage | Opus 6 | LOW | `README.md:74-86` suggested alias only | Deferred: plan excludes a CLI command |

No reviewer found a broken test, string comparison or deployment identifier.
