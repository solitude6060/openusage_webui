import { join } from "node:path";
import { startServer } from "./index";

const webCwd = join(import.meta.dir, "../../web");
const vite = Bun.spawn(["bun", "run", "dev", "--", "--host", "127.0.0.1", "--port", "6737"], {
  cwd: webCwd,
  stdout: "inherit",
  stderr: "inherit",
});

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
