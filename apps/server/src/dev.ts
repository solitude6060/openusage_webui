import { join } from "node:path";

const FRONTEND_URL = "http://127.0.0.1:6737";
const serverCwd = join(import.meta.dir, "..");
const webCwd = join(import.meta.dir, "../../web");

// Vite stays up for the whole dev session and manages its own HMR for the frontend.
const vite = Bun.spawn(["bun", "run", "dev", "--", "--host", "127.0.0.1", "--port", "6737"], {
  cwd: webCwd,
  stdout: "inherit",
  stderr: "inherit",
});

await waitForFrontend(FRONTEND_URL);

// The API server runs under `--watch`, so backend edits (including the shared providers
// package) hot-reload without a manual restart. It's a separate process from Vite, so a
// backend reload never disturbs the frontend dev server or orphans it.
const api = Bun.spawn(["bun", "--watch", "src/index.ts"], {
  cwd: serverCwd,
  env: { ...process.env, OPENUSAGE_WEBUI_DEV_FRONTEND_URL: FRONTEND_URL },
  stdout: "inherit",
  stderr: "inherit",
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  api.kill();
  vite.kill();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, shutdown);
}

// If either child exits on its own, tear the other down too.
await Promise.race([vite.exited, api.exited]);
shutdown();

async function waitForFrontend(url: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
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
  throw new Error("Vite dev server did not become ready");
}
