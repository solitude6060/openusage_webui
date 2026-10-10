import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UsageProvider } from "../../../packages/providers/src/index";
import { SqliteStorage } from "../../../packages/storage/src/index";
import { createRequestHandler } from "../src/index";

let dataDir: string;
let previousDataDir: string | undefined;
let storage: SqliteStorage;

beforeEach(async () => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-webui-refresh-flight-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
  storage = new SqliteStorage();
  await storage.init();
});

afterEach(() => {
  storage.close();
  if (previousDataDir === undefined) {
    delete process.env.OPENUSAGE_WEBUI_DIR;
  } else {
    process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

function handler(providers: UsageProvider[]) {
  return createRequestHandler(storage, { host: "127.0.0.1", port: 6736 }, undefined, providers);
}

function refreshAllRequest(): Request {
  return new Request("http://127.0.0.1:6736/api/providers/refresh", { method: "POST" });
}

function refreshManualRequest(): Request {
  return new Request("http://127.0.0.1:6736/api/providers/manual/refresh", { method: "POST" });
}

function countingProvider(refresh: () => Promise<[]>): UsageProvider[] {
  return [{
    id: "manual",
    name: "Manual",
    detect: async () => true,
    refresh,
  }];
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => { resolve = release; });
  return { promise, resolve };
}

describe("provider refresh single flight", () => {
  test("keeps full refresh state inside each handler", async () => {
    const entered = deferred();
    const gate = deferred();
    let secondRefreshes = 0;
    const firstHandler = handler(countingProvider(async () => {
      entered.resolve();
      await gate.promise;
      return [];
    }));
    const secondStorage = new SqliteStorage(join(dataDir, "second.sqlite"));
    await secondStorage.init();
    const secondHandler = createRequestHandler(
      secondStorage, { host: "127.0.0.1", port: 6736 }, undefined,
      [{ id: "minimax", name: "MiniMax", detect: async () => true, refresh: async () => {
        secondRefreshes += 1;
        return [];
      } }],
    );
    const first = firstHandler(refreshAllRequest());
    await entered.promise;
    const second = secondHandler(refreshAllRequest());
    gate.resolve();
    try {
      const [firstResponse, secondResponse] = await Promise.all([first, second]);
      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
      expect(secondRefreshes).toBe(1);
      expect(await secondResponse.json()).toEqual({
        ok: true, results: [{ providerId: "minimax", ok: true, records: 0 }],
      });
      expect((await storage.listProviderStatus()).map((status) => status.providerId)).toEqual(["manual"]);
      expect((await secondStorage.listProviderStatus()).map((status) => status.providerId)).toEqual(["minimax"]);
    } finally {
      secondStorage.close();
    }
  });

  test("runs providers once for concurrent full refresh requests", async () => {
    let refreshes = 0;
    const entered = deferred();
    const gate = deferred();
    const handleRequest = handler(countingProvider(async () => {
      refreshes += 1;
      entered.resolve();
      await gate.promise;
      return [];
    }));

    const firstRequest = handleRequest(refreshAllRequest());
    await entered.promise;
    const secondRequest = handleRequest(refreshAllRequest());
    gate.resolve();
    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(secondBody).toEqual(firstBody);
    expect(firstBody).toEqual({
      ok: true,
      results: [{ providerId: "manual", ok: true, records: 0 }],
    });
    expect(refreshes).toBe(1);

    const third = await handleRequest(refreshAllRequest());
    expect(third.status).toBe(200);
    expect(await third.json()).toEqual(firstBody);
    expect(refreshes).toBe(2);
  });

  test("queues concurrent single-provider refreshes as separate runs", async () => {
    let refreshes = 0;
    let active = 0;
    let maximumActive = 0;
    const entered = deferred();
    const gate = deferred();
    const handleRequest = handler(countingProvider(async () => {
      refreshes += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      entered.resolve();
      await gate.promise;
      active -= 1;
      return [];
    }));

    const firstRequest = handleRequest(refreshManualRequest());
    await entered.promise;
    const secondRequest = handleRequest(refreshManualRequest());
    // Drain runnable request continuations while the first provider stays gated.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const refreshesBeforeRelease = refreshes;
    gate.resolve();
    const [first, second] = await Promise.all([firstRequest, secondRequest]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
    expect(refreshes).toBe(2);
    expect(maximumActive).toBe(1);
    expect(refreshesBeforeRelease).toBe(1);
  });

  test("waits for an in-flight full refresh before a separate single-provider refresh", async () => {
    let refreshes = 0;
    let active = 0;
    let maximumActive = 0;
    const fullGate = deferred();
    const fullEntered = deferred();
    const handleRequest = handler(countingProvider(async () => {
      refreshes += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (refreshes === 1) {
        fullEntered.resolve();
        await fullGate.promise;
      }
      active -= 1;
      return [];
    }));

    const full = handleRequest(refreshAllRequest());
    await fullEntered.promise;
    const single = handleRequest(refreshManualRequest());
    await new Promise<void>((resolve) => setImmediate(resolve));
    const refreshesBeforeRelease = refreshes;
    fullGate.resolve();
    const [fullResponse, singleResponse] = await Promise.all([full, single]);
    expect(fullResponse.status).toBe(200);
    expect(singleResponse.status).toBe(200);
    expect(maximumActive).toBe(1);
    expect(refreshesBeforeRelease).toBe(1);
    expect(refreshes).toBe(2);
  });
});
