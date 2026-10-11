import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachCodexEventScan } from "../src/codex-event-refresh";
import type { OpenUsagePluginProvider } from "../../../packages/providers/src/index";
import type { CodexEventScanInput, CodexMeterShape } from "../../../packages/providers/src/codex-session-events";
import type { QuotaObservation } from "../../../packages/providers/src/quota-observations";
import { SqliteStorage } from "../../../packages/storage/src/index";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const PROVIDER_ID = "codex:example";

let dataDir = "";
let previousDataDir: string | undefined;

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.OPENUSAGE_WEBUI_DIR;
  else process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = "";
});

test("a stored 7-day Session beside a same-time 5-hour Session is five-hour-primary", async () => {
  const observedAt = "2026-10-09T12:00:00.000Z";
  const shape = await shapeForRows([
    observation({
      windowKey: "session",
      windowLabel: "Session",
      periodMs: WEEK_MS,
      observedAt,
      resetsAt: "2026-10-16T12:00:00.000Z",
      usedPercent: 40,
    }),
    observation({
      windowKey: "session",
      windowLabel: "Session",
      periodMs: FIVE_HOUR_MS,
      observedAt,
      resetsAt: "2026-10-09T17:00:00.000Z",
      usedPercent: 12,
    }),
  ]);
  expect(shape).toBe("five-hour-primary");
});

test("a stored 7-day Session with no shorter Session is weekly-primary", async () => {
  const shape = await shapeForRows([
    observation({
      windowKey: "session",
      windowLabel: "Session",
      periodMs: WEEK_MS,
      observedAt: "2026-10-09T12:00:00.000Z",
      resetsAt: "2026-10-16T12:00:00.000Z",
      usedPercent: 40,
    }),
  ]);
  expect(shape).toBe("weekly-primary");
});

async function shapeForRows(rows: QuotaObservation[]): Promise<CodexMeterShape | null> {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-codex-shape-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
  const storage = new SqliteStorage();
  await storage.init();
  await storage.insertQuotaObservations(rows);
  let scan: CodexEventScanInput | null = null;
  const provider = {
    id: PROVIDER_ID,
    codexHomePath: () => "/home/user/codex",
    setCodexEventScan(input: CodexEventScanInput | null) {
      scan = input;
    },
  } as unknown as OpenUsagePluginProvider;
  try {
    await attachCodexEventScan(storage, provider);
  } finally {
    storage.close();
  }
  if (!scan) throw new Error("event scan was not attached");
  return scan.accounts[0]?.shape ?? null;
}

function observation(row: Pick<QuotaObservation, "windowKey" | "windowLabel" | "periodMs" | "observedAt" | "resetsAt" | "usedPercent">): QuotaObservation {
  return {
    providerId: PROVIDER_ID,
    present: true,
    limitValue: null,
    limitUnit: null,
    usedValue: null,
    ...row,
  };
}
