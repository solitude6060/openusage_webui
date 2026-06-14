import type { UsageRecord } from "../../../core/src/types";
import type { UsageProvider } from "../types";
import { createRawCcusageRecord, parseCcusageRecords } from "./ccusage-parser";

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
const COMMAND_TIMEOUT_MS = 15_000;

export interface CcusageProviderOptions {
  commandTimeoutMs?: number;
}

export class CcusageProvider implements UsageProvider {
  id = "ccusage" as const;
  name = "ccusage";

  constructor(
    private readonly runner: CcusageCommandRunner = runCcusageCommand,
    private readonly options: CcusageProviderOptions = {},
  ) {}

  async detect(): Promise<boolean> {
    return (await this.findRunner()) !== null;
  }

  async refresh(): Promise<UsageRecord[]> {
    const runner = await this.findRunner();
    if (!runner) {
      throw new Error("ccusage could not be executed. Install it or run with bunx ccusage first.");
    }

    let sawStructuredOutput = false;
    for (const command of REFRESH_COMMANDS) {
      const result = await this.runWithTimeout(runner, ["ccusage", command, "--json"]);
      if (!result.ok) {
        continue;
      }

      const parsed = parseCcusageRecords(result.stdout, command);
      sawStructuredOutput = sawStructuredOutput || parsed.parsed;
      const records = parsed.records;
      if (records.length > 0) {
        return records;
      }
      if (!parsed.parsed && result.stdout.trim()) {
        return [createRawCcusageRecord(result.stdout, command)];
      }
    }

    if (sawStructuredOutput) {
      return [];
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
            this.options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS,
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

export async function runCcusageCommand(
  command: string,
  args: string[],
): Promise<CcusageCommandResult> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([command, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : "ccusage command failed to spawn",
    };
  }
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
    await proc.exited.catch(() => undefined);
    await Promise.all([
      new Response(proc.stdout).text().catch(() => ""),
      new Response(proc.stderr).text().catch(() => ""),
    ]);
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
