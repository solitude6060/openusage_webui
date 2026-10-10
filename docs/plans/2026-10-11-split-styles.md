# Split The Web Stylesheet — 2026-10-11

`apps/web/src/styles.css` is 1,624 lines; AGENTS.md asks for files under about 500 lines.

Change: split it into files under about 500 lines each by area (for example base/tokens,
layout/shell, components, pages, responsive), imported in the original order so the cascade is
unchanged. No rule edits, no selector renames, no value changes. Pure move.

Acceptance: the concatenation of the new files in import order equals the original file except
for file boundaries (scripted check); built CSS is equivalent; screenshots at 390 px and 1440 px
for all six pages are pixel-identical before and after (database copy, no POST requests);
existing suites and `bun run build:webui` pass.

Routing: Claude `claude-sonnet-5-5` / `xhigh` implements (user choice); triple-review fixed lanes.
