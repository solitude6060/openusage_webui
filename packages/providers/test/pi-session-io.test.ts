import { describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import type { UsageRecord } from "../../core/src/types";
import { scanPiSessionUsage } from "../src/providers/pi-session-usage";
import { withIsolatedHome, writeJson } from "./openusage-plugin-fixture-helpers";

const now = "2026-10-11T12:00:00.000Z";
const entry = { type: "message", id: "healthy", timestamp: "2026-10-10T12:00:00.000Z",
  message: { role: "assistant", provider: "openai-codex", model: "gpt-6.1-sol",
    usage: { totalTokens: 100, cost: { total: 1 } } } };

describe("Pi session read failures", () => {
  test.each(["file", "directory"])("skips an unreadable %s and retains healthy siblings", async (kind) => {
    await withIsolatedHome((home) => {
      const root = join(home, ".pi/agent/sessions");
      const blocked = join(root, kind === "file" ? "a-private.jsonl" : "a-private");
      writeJson(join(root, "z-healthy.jsonl"), entry);
      if (kind === "file") writeJson(blocked, { ...entry, id: "blocked" });
      else writeJson(join(blocked, "private.jsonl"), { ...entry, id: "blocked" });
      const error = Object.assign(new Error("PRIVATE_CONTENT_AND_PATH"), { code: "EACCES" });
      const read = fs.readFileSync;
      const list = fs.readdirSync;
      const fault = kind === "file"
        ? spyOn(fs, "readFileSync").mockImplementation(((path: fs.PathOrFileDescriptor, ...args: unknown[]) => {
          if (String(path) === blocked) throw error;
          return Reflect.apply(read, fs, [path, ...args]);
        }) as typeof read)
        : spyOn(fs, "readdirSync").mockImplementation(((path: fs.PathLike, ...args: unknown[]) => {
          if (String(path) === blocked) throw error;
          return Reflect.apply(list, fs, [path, ...args]);
        }) as typeof list);
      const log = spyOn(console, "error").mockImplementation(() => {});
      try {
        let rows: UsageRecord[] = [];
        expect(() => { rows = scanPiSessionUsage({ providerId: "codex", card: "codex", homeDir: home, now }); }).not.toThrow();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.totalTokens).toBe(100);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith("Pi session token scan failed:", "EACCES");
        expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_CONTENT_AND_PATH");
        expect(JSON.stringify(log.mock.calls)).not.toContain(blocked);
      } finally {
        fault.mockRestore();
        log.mockRestore();
      }
    });
  });

  test("a missing sessions root returns empty without logging an error", async () => {
    await withIsolatedHome((home) => {
      const log = spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(scanPiSessionUsage({ providerId: "codex", card: "codex", homeDir: home, now })).toEqual([]);
        expect(log).not.toHaveBeenCalled();
      } finally { log.mockRestore(); }
    });
  });
});
