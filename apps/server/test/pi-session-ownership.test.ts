import { expect, test } from "bun:test";
import { join } from "node:path";
import { SqliteStorage } from "../../../packages/storage/src/index";
import { withIsolatedHome } from "../../../packages/providers/test/openusage-plugin-fixture-helpers";
import { rebuildProvidersFromStorage } from "../src/provider-accounts";

test("configuring Claude accounts removes default Pi usage while preserving native usage", async () => {
  await withIsolatedHome(async (home) => {
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    const storage = new SqliteStorage(join(home, "usage.sqlite"));
    try {
      await storage.init();
      await storage.upsertProviderAccount({ id: "claude-code:work", providerId: "claude-code",
        label: "Work", homePath: join(home, "work"), enabled: true, sortOrder: 0 });
      const base = { providerId: "claude-code", startedAt: "2026-10-10T00:00:00.000Z",
        source: "local-log" as const, totalTokens: 100 };
      await storage.upsertUsageRecords([
        { ...base, id: "pi", tool: "Pi Session" },
        { ...base, id: "native", tool: "ccusage" },
        { ...base, id: "codex-pi", providerId: "codex", tool: "Pi Session" },
        { ...base, id: "manual-pi", source: "manual", tool: "Pi Session" },
      ]);
      await rebuildProvidersFromStorage(storage, { current: [] });
      expect((await storage.listUsageRecords()).map((row) => row.id).sort())
        .toEqual(["codex-pi", "manual-pi", "native"]);
    } finally {
      storage.close();
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });
});
