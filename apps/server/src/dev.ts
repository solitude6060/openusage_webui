import { join } from "node:path";

const FRONTEND_URL = "http://127.0.0.1:6737";
const FRONTEND_TIMEOUT_MS = 30_000;
const SHUTDOWN_GRACE_MS = 5_000;
const serverCwd = join(import.meta.dir, "..");
const webCwd = join(import.meta.dir, "../../web");

// Vite stays up for the whole dev session and manages its own HMR for the frontend.
const vite = Bun.spawn(["bun", "run", "dev", "--", "--host", "127.0.0.1", "--port", "6737"], {
  cwd: webCwd,
  stdout: "inherit",
  stderr: "inherit",
});

let api: ReturnType<typeof Bun.spawn> | null = null;
let shuttingDown = false;

async function shutdown(code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  api?.kill();
  vite.kill();
  // Wait for the children to actually exit so we never leave an orphan behind, but don't
  // hang forever if one ignores SIGTERM.
  await Promise.race([
    Promise.all([vite.exited, api ? api.exited : Promise.resolve(0)]),
    Bun.sleep(SHUTDOWN_GRACE_MS),
  ]);
  process.exit(code);
}

// Register cleanup BEFORE any await: a Ctrl+C or a failed/slow frontend wait during startup
// must still tear down the already-spawned Vite child instead of orphaning it.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown(0));
}

try {
  await waitForFrontend(FRONTEND_URL);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await shutdown(1);
}

// Only start the API if a signal hasn't already begun shutdown during the frontend wait.
// Otherwise the in-flight shutdown (which ran `api?.kill()` while `api` was still null) would
// never kill a freshly spawned API, orphaning it on port 6736 — its own process.exit ends us
// here instead. The check and the spawn are synchronous (no await between), so no signal can
// land in the gap.
if (!shuttingDown) {
  // The API server runs under `--watch`, so backend edits (including the shared providers
  // package) hot-reload without a manual restart. It's a separate process from Vite, so a
  // backend reload never disturbs the frontend dev server or orphans it.
  api = Bun.spawn(["bun", "--watch", "src/index.ts"], {
    cwd: serverCwd,
    env: { ...process.env, OPENUSAGE_WEBUI_DEV_FRONTEND_URL: FRONTEND_URL },
    stdout: "inherit",
    stderr: "inherit",
  });

  // If either child exits on its own, tear the other down too, propagating a failure code.
  const exited = await Promise.race([
    vite.exited.then((code: number) => ({ who: "Vite", code })),
    api.exited.then((code: number) => ({ who: "API server", code })),
  ]);
  console.error(`${exited.who} exited (code ${exited.code ?? "unknown"}); shutting down dev server.`);
  await shutdown(exited.code ?? 1);
}

async function waitForFrontend(url: string): Promise<void> {
  const deadline = Date.now() + FRONTEND_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) {
      throw new Error("Vite dev server exited before it became ready");
    }
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.ok || response.status === 404) {
        return;
      }
    } catch {
      // fetch threw — server not up yet
    }
    await Bun.sleep(100);
  }
  throw new Error("Vite dev server did not become ready in time");
}
