# Antigravity Fixture Isolation — 2026-10-11

`packages/providers/test/openusage-plugin-api-fixtures.test.ts` test
`adapts the original Antigravity plugin through Cloud Code quota` fails whenever a real
Antigravity language server runs on the developer machine: the plugin's `ctx.host.ls.discover`
(`plugins/antigravity/plugin.js:376`) finds the real process and the test receives
`Unexpected request: POST http://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/GetCommandModelConfigs`.

Change: make the fixture deterministic regardless of local processes by controlling language
server discovery in the test (inject or stub the host `ls.discover` used by the WebUI plugin
runtime, following existing injection patterns such as `request`/`ccusageRunner`). Production
discovery behavior unchanged.

Acceptance: a regression test that fails on `d8479dc` while a fake discoverable language server
is present (simulate it; do not depend on a real Antigravity process), passes after the change;
existing suites pass.

Routing: Claude `claude-sonnet-5-5` / `xhigh` implements (user choice); triple-review fixed lanes.
