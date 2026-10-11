import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachCodexEventScan } from "../src/codex-event-refresh";
import type { OpenUsagePluginProvider } from "../../../packages/providers/src/index";
import type { CodexEventScanInput } from "../../../packages/providers/src/codex-session-events";
import { SqliteStorage } from "../../../packages/storage/src/index";

let dataDir = "";
let previousDataDir: string | undefined;

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.OPENUSAGE_WEBUI_DIR;
  else process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = "";
});

test("an invalid Codex plan map is empty and does not stop the scan", async () => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-codex-plan-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
  const storage = new SqliteStorage();
  await storage.init();
  await storage.setAppMeta("codex_event_plan_types", "{");
  let scan: CodexEventScanInput | null = null;
  const provider = {
    id: "codex:codex",
    codexHomePath: () => "/home/user/codex",
    setCodexEventScan(input: CodexEventScanInput | null) {
      scan = input;
    },
  } as unknown as OpenUsagePluginProvider;
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((arg) => String(arg)).join(" "));
  };
  let thrown: unknown = null;
  try {
    await attachCodexEventScan(storage, provider);
  } catch (error) {
    thrown = error;
  } finally {
    console.error = original;
    storage.close();
  }
  expect(thrown).toBeNull();
  expect(scan?.accounts[0]?.planType).toBeNull();
  expect(errors.join("\n")).toContain("codex_event_plan_types_invalid");
});

test("a non-object Codex plan map is empty and does not stop the scan", async () => {
  for (const raw of ["[]", "null", "\"plus\""]) {
    previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
    dataDir = mkdtempSync(join(tmpdir(), "openusage-codex-plan-"));
    process.env.OPENUSAGE_WEBUI_DIR = dataDir;
    const storage = new SqliteStorage();
    await storage.init();
    await storage.setAppMeta("codex_event_plan_types", raw);
    let scan: CodexEventScanInput | null = null;
    const provider = {
      id: "codex:codex",
      codexHomePath: () => "/home/user/codex",
      setCodexEventScan(input: CodexEventScanInput | null) {
        scan = input;
      },
    } as unknown as OpenUsagePluginProvider;
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map((arg) => String(arg)).join(" "));
    };
    let thrown: unknown = null;
    try {
      await attachCodexEventScan(storage, provider);
    } catch (error) {
      thrown = error;
    } finally {
      console.error = original;
      storage.close();
    }
    expect(thrown).toBeNull();
    expect(scan?.accounts[0]?.planType).toBeNull();
    expect(errors.join("\n")).toContain("codex_event_plan_types_invalid");
    rmSync(dataDir, { recursive: true, force: true });
    dataDir = "";
  }
});
