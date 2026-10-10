import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../src/index";

let dataDir: string;
let previousDataDir: string | undefined;
let server: Awaited<ReturnType<typeof startServer>> | undefined;
let restoreServe: () => void;
let configuredIdleTimeout: number | undefined;

beforeEach(() => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  const fixtureRoot = process.env.OPENUSAGE_TEST_ARTIFACTS_DIR
    ?? join(import.meta.dir, "refresh-followups.local");
  mkdirSync(fixtureRoot, { recursive: true });
  dataDir = mkdtempSync(join(fixtureRoot, "refresh-timeout-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
  const serve = Bun.serve.bind(Bun);
  const serveSpy = spyOn(Bun, "serve").mockImplementation((options) => {
    configuredIdleTimeout = options.idleTimeout;
    // Exercise the real HTTP timeout without waiting 120 seconds per request.
    return serve({ ...options, idleTimeout: 1 });
  });
  restoreServe = () => serveSpy.mockRestore();
});

afterEach(() => {
  server?.stop(true);
  server = undefined;
  restoreServe();
  if (previousDataDir === undefined) delete process.env.OPENUSAGE_WEBUI_DIR;
  else process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
});

function request(path: string, method = "POST") {
  return fetch(`http://127.0.0.1:${server!.port}${path}`, {
    method,
    // startServer's handler is configured with the requested ephemeral port (0).
    headers: { host: "127.0.0.1:0" },
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

describe("refresh request idle timeout", () => {
  test("keeps a running full refresh and its queued single-provider request connected", async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let finished!: () => void;
    const queueFinished = new Promise<void>((resolve) => { finished = resolve; });
    let refreshes = 0;
    let fullRefreshFinished = false;
    server = await startServer({ host: "127.0.0.1", port: 0, providers: [{
      id: "manual", name: "Manual", detect: async () => true,
      refresh: async () => {
        refreshes += 1;
        if (refreshes === 1) {
          entered();
          await Bun.sleep(2200);
          fullRefreshFinished = true;
        } else {
          finished();
        }
        return [];
      },
    }] });
    const overridesWhileQueued: Array<{ path: string; seconds: number; fullRefreshFinished: boolean }> = [];
    const setTimeout = server.timeout.bind(server);
    const timeout = spyOn(server, "timeout").mockImplementation((req, seconds) => {
      overridesWhileQueued.push({ path: new URL(req.url).pathname, seconds, fullRefreshFinished });
      setTimeout(req, seconds);
    });
    const full = request("/api/providers/refresh");
    await started;
    const single = request("/api/providers/manual/refresh");
    const responses = await Promise.allSettled([full, single]);
    // Even on the old code, wait for both provider runs before stopping the server.
    await queueFinished;
    timeout.mockRestore();

    expect(configuredIdleTimeout).toBe(120);
    expect(overridesWhileQueued).toEqual([
      { path: "/api/providers/refresh", seconds: 0, fullRefreshFinished: false },
      { path: "/api/providers/manual/refresh", seconds: 0, fullRefreshFinished: false },
    ]);
    for (const response of responses) {
      expect(response).toEqual({ status: "fulfilled", value: {
        status: 200,
        body: { ok: true, results: [{ providerId: "manual", ok: true, records: 0 }] },
      } });
    }
    expect(refreshes).toBe(2);
  }, 10_000);

  test("leaves ordinary endpoints and non-POST lookalikes at the default timeout", async () => {
    server = await startServer({ host: "127.0.0.1", port: 0, providers: [] });
    const timeout = spyOn(server, "timeout");
    try {
      expect((await request("/api/health", "GET")).status).toBe(200);
      expect((await request("/api/providers/refresh", "GET")).status).toBe(404);
      expect((await request("/api/providers/manual/refresh", "GET")).status).toBe(404);
      expect((await request("/api/providers/manual/refresh/extra")).status).toBe(404);
      expect(configuredIdleTimeout).toBe(120);
      expect(timeout).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
    }
  });
});
