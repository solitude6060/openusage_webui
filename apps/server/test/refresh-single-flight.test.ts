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
    const handleRequest = handler(countingProvider(async () => {
      refreshes += 1;
      await Bun.sleep(50);
      return [];
    }));

    const [first, second] = await Promise.all([
      handleRequest(refreshAllRequest()),
      handleRequest(refreshAllRequest()),
    ]);
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

  test("keeps concurrent single-provider refreshes independent", async () => {
    let refreshes = 0;
    const handleRequest = handler(countingProvider(async () => {
      refreshes += 1;
      await Bun.sleep(40);
      return [];
    }));

    const [first, second] = await Promise.all([
      handleRequest(refreshManualRequest()),
      handleRequest(refreshManualRequest()),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
    expect(refreshes).toBe(2);
  });

  test("does not fold a single-provider refresh into an in-flight full refresh", async () => {
    let refreshes = 0;
    let releaseFull: () => void = () => undefined;
    const fullGate = new Promise<void>((resolve) => {
      releaseFull = resolve;
    });
    let enteredFull: () => void = () => undefined;
    const fullEntered = new Promise<void>((resolve) => {
      enteredFull = resolve;
    });
    const handleRequest = handler(countingProvider(async () => {
      refreshes += 1;
      if (refreshes === 1) {
        enteredFull();
        await fullGate;
      }
      return [];
    }));

    const full = handleRequest(refreshAllRequest());
    await fullEntered;
    const single = handleRequest(refreshManualRequest());
    await Bun.sleep(30);
    expect(refreshes).toBe(2);
    releaseFull();
    const [fullResponse, singleResponse] = await Promise.all([full, single]);
    expect(fullResponse.status).toBe(200);
    expect(singleResponse.status).toBe(200);
  });
});
