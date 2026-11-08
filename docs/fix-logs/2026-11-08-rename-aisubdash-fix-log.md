# Fix log: rename the fork to aisubdash (PR #65)

Review record: `docs/reviews/2026-11-08-rename-aisubdash-review.md`.

| Finding | Fix | Files | Test |
| --- | --- | --- | --- |
| Screenshot shows old name | Repainted sidebar heading | `docs/screenshots/webui-dashboard.png` | Visual check of the cropped heading |
| Upstream README section unlabeled | Added upstream note | `README.md` | Documentation only |
| User guide fork statement | Added statement | `docs/USER_GUIDE_WEBUI.zh-TW.md` | Documentation only |
| zh-TW negation | Reworded | `README_WEBUI.zh-TW.md`, `docs/USER_GUIDE_WEBUI.zh-TW.md` | Documentation only |
| Ollama doc self-reference | Renamed | `docs/providers/ollama.md` | Documentation only |
| Round 2: upstream note mislabels fork entries | Reworded as adapted | `README.md` | Documentation only |
| Round 2: `.github` deferral reason wrong and untracked | Corrected reason; added a local tracker entry | `docs/reviews/2026-11-08-rename-aisubdash-review.md`, `tracker.md` (local, gitignored) | Documentation only |
| Round 3: note scope too wide and missing sections | Default is upstream; fork additions listed by fragment | `README.md` | Documentation only |
| Round 3: fix-log table broken | Removed blank line; added rows | this file | Documentation only |

Deferred: in-repo `.github` issue templates and CODEOWNERS (tracked in `tracker.md`); `ou-status` alias name.
