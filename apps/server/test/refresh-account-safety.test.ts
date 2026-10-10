import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UsageRecord } from "../../../packages/core/src/types";
import type { UsageProvider } from "../../../packages/providers/src/index";
import { SqliteStorage } from "../../../packages/storage/src/index";
import { createRequestHandler } from "../src/index";
import type { ProvidersRef } from "../src/provider-accounts";

let dataDir: string;
let previousDataDir: string | undefined;
let storage: SqliteStorage;
const providerId = "codex:work";

beforeEach(async () => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-refresh-account-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
  storage = new SqliteStorage();
  await storage.init();
  await storage.upsertProviderAccount({
    id: providerId, providerId: "codex", label: "Work", homePath: dataDir,
    enabled: true, sortOrder: 0,
  });
  await storage.upsertProviderStatus({ providerId, name: "Work", enabled: true, detected: true });
});

afterEach(() => {
  storage.close();
  if (previousDataDir === undefined) delete process.env.OPENUSAGE_WEBUI_DIR;
  else process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => { resolve = release; });
  return { promise, resolve };
}

function request(path = "/api/providers/refresh", method = "POST", body?: unknown) {
  return new Request(`http://127.0.0.1:6736${path}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function snapshot(): UsageRecord {
  return {
    id: "old-snapshot", providerId, tool: "OpenUsage Plugin Snapshot", source: "api",
    startedAt: "2026-10-10T00:00:00.000Z",
    raw: { lines: [{ type: "progress", label: "Weekly", used: 10, limit: 100, unit: "%" }] },
  };
}

function pendingProvider(outcome: "success" | "failure") {
  const entered = deferred();
  const gate = deferred();
  const provider: UsageProvider = {
    id: providerId, name: "Work", detect: async () => true,
    refresh: async () => {
      entered.resolve();
      await gate.promise;
      if (outcome === "failure") throw new Error("old probe failed");
      return [snapshot()];
    },
  };
  return { provider, entered, gate };
}

describe("refresh account safety", () => {
  for (const change of ["delete", "replace", "remove-status"] as const) {
    for (const outcome of ["success", "failure"] as const) {
      test(`drops ${outcome} writes after ${change} during refresh`, async () => {
        const pending = pendingProvider(outcome);
        const providersRef: ProvidersRef = { current: [pending.provider] };
        const handle = createRequestHandler(
          storage, { host: "127.0.0.1", port: 6736 }, undefined, providersRef, undefined,
          async () => {
            const account = await storage.getProviderAccount(providerId);
            providersRef.current = account
              ? [{ ...pending.provider, name: account.label, refresh: async () => [] }]
              : [];
          },
        );
        const refresh = handle(request());
        await pending.entered.promise;
        if (change === "remove-status") {
          await storage.deleteProviderStatus(providerId);
        } else {
          const response = await handle(request(
            `/api/provider-accounts/${providerId}`, change === "delete" ? "DELETE" : "PATCH",
            change === "replace" ? { label: "New Work", homePath: join(dataDir, "new-home") } : undefined,
          ));
          expect(response.status).toBe(200);
        }
        const writes = [
          spyOn(storage, "upsertUsageRecords"), spyOn(storage, "upsertProviderStatus"),
          spyOn(storage, "insertQuotaObservations"), spyOn(storage, "insertProbeFailure"),
        ];
        pending.gate.resolve();
        try {
          const response = await refresh;
          expect(response.status).toBe(200);
          for (const write of writes) expect(write).not.toHaveBeenCalled();
          expect(await response.json()).toEqual({ ok: true, results: [] });
        } finally {
          for (const write of writes) write.mockRestore();
        }
      });
    }
  }

  for (const outcome of ["success", "failure"] as const) {
    test(`preserves a disable request during a ${outcome} refresh`, async () => {
      const pending = pendingProvider(outcome);
      const handle = createRequestHandler(
        storage, { host: "127.0.0.1", port: 6736 }, undefined, [pending.provider],
      );
      const refresh = handle(request());
      await pending.entered.promise;
      const disabled = await handle(request(`/api/providers/${providerId}/enabled`, "PATCH", { enabled: false }));
      expect(disabled.status).toBe(200);
      pending.gate.resolve();
      expect((await refresh).status).toBe(200);
      expect((await storage.listProviderStatus())[0]).toMatchObject({
        providerId, enabled: false, ...(outcome === "failure" ? { lastError: "old probe failed" } : {}),
      });
      expect((await storage.getProviderAccount(providerId))?.enabled).toBe(false);
    });
  }

  test("queues a fresh full refresh after replacement and shares only that new run", async () => {
    const pending = pendingProvider("success");
    const providersRef: ProvidersRef = { current: [pending.provider] };
    const newGate = deferred();
    let newRefreshes = 0;
    const handle = createRequestHandler(
      storage, { host: "127.0.0.1", port: 6736 }, undefined, providersRef,
    );
    const oldRefresh = handle(request());
    await pending.entered.promise;
    providersRef.current = [{
      ...pending.provider, name: "New Work", refresh: async () => {
        newRefreshes += 1;
        await newGate.promise;
        return [];
      },
    }];
    const newRefresh = handle(request());
    pending.gate.resolve();
    const oldResponse = await oldRefresh;
    const sharedNewRefresh = handle(request());
    newGate.resolve();
    const [newResponse, sharedResponse] = await Promise.all([newRefresh, sharedNewRefresh]);
    expect(await oldResponse.json()).toEqual({ ok: true, results: [] });
    expect(await newResponse.json()).toEqual({
      ok: true, results: [{ providerId, ok: true, records: 0 }],
    });
    expect(await sharedResponse.json()).toEqual({
      ok: true, results: [{ providerId, ok: true, records: 0 }],
    });
    expect(newRefreshes).toBe(1);
  });
});
