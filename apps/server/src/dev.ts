import { join } from "node:path";
import { startServer } from "./index";

const webCwd = join(import.meta.dir, "../../web");
const vite = Bun.spawn(["bun", "run", "dev", "--", "--host", "127.0.0.1", "--port", "6737"], {
  cwd: webCwd,
  stdout: "inherit",
  stderr: "inherit",
});

await waitForFrontend("http://127.0.0.1:6737");

const server = await startServer({
  host: "127.0.0.1",
  port: 6736,
  devFrontendUrl: "http://127.0.0.1:6737",
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.stop();
    vite.kill();
    process.exit(0);
  });
}

await vite.exited;
server.stop();

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
      await Bun.sleep(100);
    }
  }
  throw new Error("Vite dev server did not become ready");
}
