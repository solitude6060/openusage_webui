import {
  runCcusageJson,
  type PluginCcusageQueryOptions,
  type PluginCcusageRunner,
} from "./openusage-plugin-runtime";

export type PluginCcusageBlocksResult =
  | { status: "ok"; data: { blocks: Array<Record<string, unknown>> } }
  | { status: "no_runner" | "runner_failed"; data: null };

// One-hour Claude blocks for the same window as the daily query. ccusage has no Codex equivalent.
export function runPluginCcusageBlocks(
  opts: PluginCcusageQueryOptions,
  homeDir: string,
  commandRunner?: PluginCcusageRunner,
  providerEnv: Record<string, string | undefined> = process.env,
): PluginCcusageBlocksResult {
  const args = ["claude", "blocks", "--json", "--session-length", "1"];
  if (opts.since) args.push("--since", opts.since);
  if (opts.until) args.push("--until", opts.until);
  const result = runCcusageJson("claude", args, opts, homeDir, commandRunner, providerEnv, blockRows);
  return result.status === "ok" ? { status: "ok", data: { blocks: result.data } } : result;
}

function blockRows(value: unknown): Array<Record<string, unknown>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const blocks = (value as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return null;
  return blocks.filter(
    (block): block is Record<string, unknown> => Boolean(block) && typeof block === "object" && !Array.isArray(block),
  );
}
