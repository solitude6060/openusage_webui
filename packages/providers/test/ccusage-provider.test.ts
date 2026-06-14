import { describe, expect, test } from "bun:test";
import {
  CcusageProvider,
  runCcusageCommand,
  type CcusageCommandRunner,
} from "../src/providers/ccusage";

function makeRunner(
  handler: CcusageCommandRunner,
): { runner: CcusageCommandRunner; calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  return {
    calls,
    runner: async (command, args) => {
      calls.push({ command, args });
      return handler(command, args);
    },
  };
}

describe("CcusageProvider", () => {
  test("detect tries bunx before npx", async () => {
    const { runner, calls } = makeRunner(async (command) => ({
      ok: command === "npx",
      stdout: command === "npx" ? "Usage: ccusage" : "",
      stderr: "",
    }));
    const provider = new CcusageProvider(runner);

    await expect(provider.detect()).resolves.toBe(true);
    expect(calls).toEqual([
      { command: "bunx", args: ["ccusage", "--help"] },
      { command: "npx", args: ["ccusage", "--help"] },
    ]);
  });

  test("refresh returns normalized records from the first JSON command", async () => {
    const { runner, calls } = makeRunner(async (_command, args) => {
      if (args.includes("--help")) {
        return { ok: true, stdout: "Usage: ccusage", stderr: "" };
      }
      return {
        ok: true,
        stdout: JSON.stringify({
          daily: [
            {
              date: "2026-02-21",
              tool: "Claude Code",
              totalTokens: 123,
              totalCost: 0.5,
            },
          ],
        }),
        stderr: "",
      };
    });
    const provider = new CcusageProvider(runner);

    const records = await provider.refresh();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      providerId: "claude-code",
      totalTokens: 123,
      costUsd: 0.5,
    });
    expect(calls).toEqual([
      { command: "bunx", args: ["ccusage", "--help"] },
      { command: "bunx", args: ["ccusage", "daily", "--json"] },
    ]);
  });

  test("refresh falls back to raw output when JSON is unavailable", async () => {
    const { runner } = makeRunner(async (_command, args) => {
      if (args.includes("--help")) {
        return { ok: true, stdout: "Usage: ccusage", stderr: "" };
      }
      return { ok: true, stdout: "Date Tokens Cost\n2026-02-21 123 $0.50", stderr: "" };
    });
    const provider = new CcusageProvider(runner);

    await expect(provider.refresh()).resolves.toEqual([
      expect.objectContaining({
        providerId: "ccusage",
        tool: "ccusage daily",
        source: "cli",
        raw: {
          command: "daily",
          stdout: "Date Tokens Cost\n2026-02-21 123 $0.50",
        },
      }),
    ]);
  });

  test("refresh throws a provider-level error when no runner works", async () => {
    const { runner } = makeRunner(async () => ({ ok: false, stdout: "", stderr: "missing" }));
    const provider = new CcusageProvider(runner);

    await expect(provider.refresh()).rejects.toThrow("ccusage could not be executed");
  });

  test("default command runner times out instead of hanging", async () => {
    const provider = new CcusageProvider(
      async () => new Promise(() => undefined),
      { commandTimeoutMs: 5 },
    );

    await expect(provider.detect()).resolves.toBe(false);
  });

  test("default command runner handles missing executables", async () => {
    await expect(runCcusageCommand("openusage-missing-ccusage-runner", [])).resolves.toEqual({
      ok: false,
      stdout: "",
      stderr: expect.any(String),
    });
  });

  test("valid empty JSON returns no records without raw fallback", async () => {
    const { runner } = makeRunner(async (_command, args) => {
      if (args.includes("--help")) {
        return { ok: true, stdout: "Usage: ccusage", stderr: "" };
      }
      return { ok: true, stdout: JSON.stringify({ daily: [] }), stderr: "" };
    });
    const provider = new CcusageProvider(runner);

    await expect(provider.refresh()).resolves.toEqual([]);
  });
});
