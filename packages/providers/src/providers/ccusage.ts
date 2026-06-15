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
    let unmappedStructuredOutput: UsageRecord | null = null;
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
      if (
        parsed.parsed &&
        parsed.rowCount > 0 &&
        records.length === 0 &&
        result.stdout.trim() &&
        !unmappedStructuredOutput
      ) {
        unmappedStructuredOutput = createRawCcusageRecord(result.stdout, command);
      }
    }

    if (unmappedStructuredOutput) {
      return [unmappedStructuredOutput];
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
    await killProcessTree(proc.pid);
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

async function killProcessTree(rootPid: number): Promise<void> {
  const descendants = process.platform === "linux" ? await listDescendantPids(rootPid) : [];
  const targets = [...descendants].reverse();
  killTargets(rootPid, targets, "SIGTERM");
  await Bun.sleep(50);
  killTargets(rootPid, targets, "SIGKILL");
}

async function listDescendantPids(rootPid: number): Promise<number[]> {
  const ps = Bun.spawn(["ps", "-eo", "pid=,ppid="], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(ps.stdout).text().catch(() => "");
  await ps.exited.catch(() => undefined);

  const childrenByParent = new Map<number, number[]>();
  for (const line of output.split("\n")) {
    const [pidText, ppidText] = line.trim().split(/\s+/);
    const pid = Number(pidText);
    const ppid = Number(ppidText);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) {
      continue;
    }
    const children = childrenByParent.get(ppid) ?? [];
    children.push(pid);
    childrenByParent.set(ppid, children);
  }

  const descendants = new Set<number>();
  const stack = [...(childrenByParent.get(rootPid) ?? [])];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (!pid || descendants.has(pid)) {
      continue;
    }
    descendants.add(pid);
    stack.push(...(childrenByParent.get(pid) ?? []));
  }
  return [...descendants];
}

function killTargets(rootPid: number, descendants: number[], signal: NodeJS.Signals): void {
  for (const pid of descendants) {
    killPid(pid, signal);
  }
  if (process.platform === "linux") {
    killPid(-rootPid, signal);
  }
  killPid(rootPid, signal);
}

function killPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // The process may have exited between discovery and cleanup.
  }
}
