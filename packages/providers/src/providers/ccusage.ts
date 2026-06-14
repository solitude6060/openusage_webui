import type { UsageRecord } from "../../../core/src/types";
import type { UsageProvider } from "../types";
import { createRawCcusageRecord, normalizeCcusageRecords } from "./ccusage-parser";

export interface CcusageCommandResult {
  ok: boolean;
  stdout: string;
  stderr?: string;
}

export type CcusageCommandRunner = (
  command: string,
  args: string[],
) => Promise<CcusageCommandResult>;

const RUNNERS = ["bunx", "npx"] as const;
const REFRESH_COMMANDS = ["daily", "session", "monthly"] as const;
const COMMAND_TIMEOUT_MS = 1500;

export class CcusageProvider implements UsageProvider {
  id = "ccusage" as const;
  name = "ccusage";

  constructor(private readonly runner: CcusageCommandRunner = runCommand) {}

  async detect(): Promise<boolean> {
    return (await this.findRunner()) !== null;
  }

  async refresh(): Promise<UsageRecord[]> {
    const runner = await this.findRunner();
    if (!runner) {
      throw new Error("ccusage could not be executed. Install it or run with bunx ccusage first.");
    }

    for (const command of REFRESH_COMMANDS) {
      const result = await this.runWithTimeout(runner, ["ccusage", command, "--json"]);
      if (!result.ok) {
        continue;
      }

      const records = normalizeCcusageRecords(result.stdout, command);
      if (records.length > 0) {
        return records;
      }
      if (result.stdout.trim()) {
        return [createRawCcusageRecord(result.stdout, command)];
      }
    }

    throw new Error("ccusage did not return usable output");
  }

  private async findRunner(): Promise<(typeof RUNNERS)[number] | null> {
    for (const command of RUNNERS) {
      const result = await this.runWithTimeout(command, ["ccusage", "--help"]);
      if (result.ok) {
        return command;
      }
    }
    return null;
  }

  private async runWithTimeout(command: string, args: string[]): Promise<CcusageCommandResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.runner(command, args),
        new Promise<CcusageCommandResult>((resolve) => {
          timer = setTimeout(
            () => resolve({ ok: false, stdout: "", stderr: "ccusage command timed out" }),
            COMMAND_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

async function runCommand(command: string, args: string[]): Promise<CcusageCommandResult> {
  const proc = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timeout = setTimeout(() => resolve("timeout"), COMMAND_TIMEOUT_MS);
  });
  const exited = await Promise.race([proc.exited, timedOut]);
  if (timeout) {
    clearTimeout(timeout);
  }
  if (exited === "timeout") {
    proc.kill();
    return { ok: false, stdout: "", stderr: "ccusage command timed out" };
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return {
    ok: exited === 0,
    stdout,
    stderr,
  };
}
