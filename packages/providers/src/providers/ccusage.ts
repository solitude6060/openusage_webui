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
  timeoutMs?: number,
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
  private detectedRunner: (typeof RUNNERS)[number] | null | undefined;

  constructor(
    private readonly runner: CcusageCommandRunner = runCcusageCommand,
    private readonly options: CcusageProviderOptions = {},
  ) {}

  async detect(): Promise<boolean> {
    this.detectedRunner = await this.findRunner();
    return this.detectedRunner !== null;
  }

  async refresh(): Promise<UsageRecord[]> {
    const runner = await this.takeDetectedRunner();
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

  private async takeDetectedRunner(): Promise<(typeof RUNNERS)[number] | null> {
    if (this.detectedRunner !== undefined) {
      const runner = this.detectedRunner;
      this.detectedRunner = undefined;
      return runner;
    }
    return this.findRunner();
  }

  private async runWithTimeout(command: string, args: string[]): Promise<CcusageCommandResult> {
    const timeoutMs = this.options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.runner(command, args, timeoutMs),
        new Promise<CcusageCommandResult>((resolve) => {
          timer = setTimeout(
            () => resolve({ ok: false, stdout: "", stderr: "ccusage command timed out" }),
            timeoutMs,
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
  timeoutMs = COMMAND_TIMEOUT_MS,
): Promise<CcusageCommandResult> {
  let proc: ReturnType<typeof Bun.spawn>;
  const commandLine = process.platform === "linux" ? ["setsid", command, ...args] : [command, ...args];
  try {
    proc = Bun.spawn(commandLine, {
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
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timeout = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const exited = await Promise.race([proc.exited, timedOut]);
  if (timeout) {
    clearTimeout(timeout);
  }
  if (exited === "timeout") {
    killProcessTree(proc);
    await proc.exited.catch(() => undefined);
    await Promise.all([stdoutPromise.catch(() => ""), stderrPromise.catch(() => "")]);
    return { ok: false, stdout: "", stderr: "ccusage command timed out" };
  }

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return {
    ok: exited === 0,
    stdout,
    stderr,
  };
}

function killProcessTree(proc: ReturnType<typeof Bun.spawn>): void {
  if (process.platform === "linux" && proc.pid) {
    try {
      process.kill(-proc.pid, "SIGTERM");
      setTimeout(() => {
        try {
          process.kill(-proc.pid, "SIGKILL");
        } catch {
          // The process group already exited.
        }
      }, 250).unref();
      return;
    } catch {
      // Fall back to Bun's direct child kill below.
    }
  }
  proc.kill();
}
