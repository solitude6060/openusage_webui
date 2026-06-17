import { join } from "node:path";
import { CcusageProvider } from "./providers/ccusage";
import { ManualProvider } from "./providers/manual";
import { MiniMaxProvider } from "./providers/minimax";
import { OpenUsagePluginProvider } from "./providers/openusage-plugin";
import type { UsageProvider } from "./types";

export function getProviders(): UsageProvider[] {
  return [
    new CcusageProvider(),
    new OpenUsagePluginProvider({
      providerId: "claude-code",
      name: "Claude Code",
      pluginId: "claude",
      scriptPath: join(import.meta.dir, "../../../plugins/claude/plugin.js"),
    }),
    new OpenUsagePluginProvider({
      providerId: "codex",
      name: "Codex",
      pluginId: "codex",
      scriptPath: join(import.meta.dir, "../../../plugins/codex/plugin.js"),
    }),
    new OpenUsagePluginProvider({
      providerId: "github-copilot",
      name: "GitHub Copilot",
      pluginId: "copilot",
      scriptPath: join(import.meta.dir, "../../../plugins/copilot/plugin.js"),
    }),
    new ManualProvider(),
    new MiniMaxProvider(),
  ];
}
