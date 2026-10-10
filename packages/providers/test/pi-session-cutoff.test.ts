import { describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { scanPiSessionUsage } from "../src/providers/pi-session-usage";
import { withIsolatedHome } from "./openusage-plugin-fixture-helpers";

const now = "2026-10-11T12:00:00.000Z";
const cutoff = new Date(now);
cutoff.setDate(cutoff.getDate() - 30);
cutoff.setHours(0, 0, 0, 0);

function line(id: string, timestamp: string, model = "gpt-6.1-sol"): string {
  return JSON.stringify({ type: "message", id, timestamp,
    message: { role: "assistant", provider: "openai-codex", model,
      usage: { totalTokens: 100, cost: { total: 1 } } } });
}

function session(home: string, name: string, lines: string[], modified: Date): string {
  const root = join(home, ".pi/agent/sessions");
  fs.mkdirSync(root, { recursive: true });
  const path = join(root, name);
  fs.writeFileSync(path, lines.join("\n"));
  fs.utimesSync(path, modified, modified);
  return path;
}

describe("Pi file modification cutoff", () => {
  test("does not read or deduplicate files modified before cutoff; includes the exact boundary", async () => {
    await withIsolatedHome((home) => {
      const old = session(home, "a-old.jsonl", [
        line("shared", new Date(cutoff.getTime() - 1).toISOString()),
        line("stale-only", now, "stale-model"),
      ], new Date(cutoff.getTime() - 1000));
      session(home, "z-current.jsonl", [line("shared", now)], cutoff);
      const read = spyOn(fs, "readFileSync");
      try {
        expect(scanPiSessionUsage({ providerId: "codex", card: "codex", homeDir: home, now }))
          .toEqual([expect.objectContaining({ model: "gpt-6.1-sol", totalTokens: 100 })]);
        expect(read).not.toHaveBeenCalledWith(old, "utf8");
      } finally { read.mockRestore(); }
    });
  });

  test("keeps upstream dedup-before-message-cutoff ordering within a recent file", async () => {
    await withIsolatedHome((home) => {
      session(home, "current.jsonl", [
        line("shared", new Date(cutoff.getTime() - 1).toISOString()), line("shared", now),
      ], cutoff);
      expect(scanPiSessionUsage({ providerId: "codex", card: "codex", homeDir: home, now })).toEqual([]);
    });
  });
});
