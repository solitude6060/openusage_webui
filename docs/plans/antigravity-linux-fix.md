# Antigravity Plugin Linux Compatibility Fix

## Problem

The Antigravity OpenUsage plugin was designed for macOS. On Linux, two issues prevent it from working:

### Issue 1: LS Discovery Port

The Antigravity language server on Linux uses `--https_server_port 0`, meaning the OS assigns a random ephemeral port. The plugin looks for `--extension_server_port` in the process cmdline, which doesn't exist on Linux. Even if we fix the flag name, the value is `0` and `readFlagPort` rejects port 0.

The actual listening ports (e.g. `127.0.0.1:40061`) can only be found by scanning the process's open sockets via `/proc/<pid>/fd` cross-referenced with `/proc/net/tcp`.

### Issue 2: OAuth Token Expiry

The DB path fix (`~/.config/Antigravity/...`) is already in place. The OAuth tokens in the state DB may be expired. The plugin attempts to refresh via Google OAuth, but this HTTP call may fail or the refresh token itself may be expired.

## Proposed Fix (2 parts)

### Part A: Socket-Based Port Discovery (runtime)

Add a `discoverListeningPorts(pid)` function to `openusage-plugin-runtime.ts` that:

1. Reads `/proc/<pid>/fd/` to find socket inodes
2. Cross-references with `/proc/net/tcp` (and `/proc/net/tcp6`) to find listening ports
3. Returns the list of ports this process is listening on

Then modify `discoverLanguageServerFromCommandLines` to use this as a fallback when `portFlag` is null or the port value is 0.

```
Flow:
1. Match process by name + markers
2. Try to read port from cmdline flag (existing behavior)
3. If port is null/0, fall back to socket scan
4. Return discovery with discovered ports
```

Estimated scope: ~60 lines in `openusage-plugin-runtime.ts`.

### Part B: Plugin Flag Name (plugin)

Update `plugins/antigravity/plugin.js` `discoverLs` to also try `--https_server_port` as a fallback flag name, and accept port 0 as a signal to use socket-based discovery.

```js
function discoverLs(ctx) {
  // Try the macOS flag first, then the Linux flag
  var result = ctx.host.ls.discover({
    processName: "language_server",
    markers: ["antigravity", "antigravity-ide"],
    csrfFlag: "--csrf_token",
    portFlag: "--extension_server_port",
  })
  if (result) return result
  return ctx.host.ls.discover({
    processName: "language_server",
    markers: ["antigravity", "antigravity-ide"],
    csrfFlag: "--csrf_token",
    portFlag: null,  // triggers socket-based discovery
  })
}
```

Estimated scope: ~5 lines in `plugins/antigravity/plugin.js`.

## Implementation Order

1. Part A (runtime socket scan) — enables any plugin to discover ports without cmdline flags
2. Part B (plugin fallback) — uses Part A for Antigravity specifically
3. Test on Linux with running Antigravity IDE

## Risk

- `/proc/net/tcp` parsing is Linux-specific (fine — this is a Linux port)
- Socket scan adds ~10ms per discovery call
- No risk to macOS behavior — the cmdline flag path runs first

## Files to Change

- `packages/providers/src/providers/openusage-plugin-runtime.ts` — add `discoverListeningPorts`, modify `discoverLanguageServerFromCommandLines`
- `plugins/antigravity/plugin.js` — update `discoverLs` with fallback
- `packages/providers/test/openusage-plugin-isolation.test.ts` — add test for socket discovery
