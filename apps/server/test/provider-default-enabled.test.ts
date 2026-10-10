import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequestHandler, startServer } from "../src/index";
import { syncProviderStatus } from "../src/provider-accounts";
import { SqliteStorage } from "../../../packages/storage/src/index";
import type { UsageProvider } from "../../../packages/providers/src/index";

// A provider that opts out of auto-enable (like Ollama, whose credential file exists for everyone
// who runs local models) next to one that does not.
let optInRefreshes = 0;
let normalRefreshes = 0;
const optIn: UsageProvider = {
  id: "kiro", name: "Opt-In Fixture", defaultEnabled: false,
  detect: async () => true, refresh: async () => { optInRefreshes += 1; return []; },
};
const normal: UsageProvider = {
  id: "manual", name: "Manual",
  detect: async () => true, refresh: async () => { normalRefreshes += 1; return []; },
};

let dataDir: string;
let previousDataDir: string | undefined;
let storage: SqliteStorage;

beforeEach(async () => {
  optInRefreshes = 0;
  normalRefreshes = 0;
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-webui-default-enabled-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
  storage = new SqliteStorage();
  await storage.init();
});

afterEach(() => {
  storage.close();
  if (previousDataDir === undefined) delete process.env.OPENUSAGE_WEBUI_DIR;
  else process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

const enabledById = async () =>
  Object.fromEntries((await storage.listProviderStatus()).map((status) => [status.providerId, status.enabled]));

function post(handler: (request: Request) => Promise<Response>, path: string) {
  return handler(new Request(`http://127.0.0.1:6736${path}`, { method: "POST" }));
}

describe("providers that start disabled", () => {
  test("syncProviderStatus (the production startup path) creates their row disabled", async () => {
    await syncProviderStatus(storage, [optIn, normal], []);

    expect(await enabledById()).toEqual({ kiro: false, manual: true });
  });

  test("syncProviderStatus never flips a choice the user already made", async () => {
    await syncProviderStatus(storage, [optIn], []);
    await storage.upsertProviderStatus({ providerId: "kiro", name: "Opt-In Fixture", enabled: true, detected: true });

    await syncProviderStatus(storage, [optIn], []);

    expect(await enabledById()).toEqual({ kiro: true });
  });

  test("startServer seeds injected providers the same way", async () => {
    const server = await startServer({ host: "127.0.0.1", port: 0, providers: [optIn, normal] });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/providers`, { headers: { host: "127.0.0.1:0" } });
      const statuses = (await response.json()) as Array<{ providerId: string; enabled: boolean }>;

      expect(Object.fromEntries(statuses.map((s) => [s.providerId, s.enabled]))).toEqual({ kiro: false, manual: true });
    } finally {
      server.stop(true);
    }
  });

  test("a full refresh skips one that has no status row yet, and still refreshes the others", async () => {
    const handler = createRequestHandler(storage, { host: "127.0.0.1", port: 6736 }, undefined, [optIn, normal]);

    await post(handler, "/api/providers/refresh");

    expect(optInRefreshes).toBe(0);
    expect(normalRefreshes).toBe(1);
  });

  test("an explicit single-provider refresh runs it but does not enable it", async () => {
    const handler = createRequestHandler(storage, { host: "127.0.0.1", port: 6736 }, undefined, [optIn, normal]);

    await post(handler, "/api/providers/kiro/refresh");

    expect(optInRefreshes).toBe(1);
    expect((await enabledById()).kiro).toBe(false);
  });

  test("once the user enables it, full refreshes include it", async () => {
    const handler = createRequestHandler(storage, { host: "127.0.0.1", port: 6736 }, undefined, [optIn, normal]);
    await handler(new Request("http://127.0.0.1:6736/api/providers/kiro/enabled", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }));

    await post(handler, "/api/providers/refresh");

    expect(optInRefreshes).toBe(1);
  });
});
