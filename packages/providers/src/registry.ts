import { isAbsolute, relative, resolve } from "node:path";
import { CcusageProvider } from "./providers/ccusage";
import { ManualProvider } from "./providers/manual";
import { MiniMaxProvider } from "./providers/minimax";
import { OpenUsagePluginProvider } from "./providers/openusage-plugin";
import type { UsageProvider } from "./types";

const pluginProviders = [
  { providerId: "amp", name: "Amp", pluginId: "amp" },
  { providerId: "antigravity", name: "Antigravity", pluginId: "antigravity" },
  { providerId: "claude-code", name: "Claude Code", pluginId: "claude" },
  { providerId: "codex", name: "Codex", pluginId: "codex" },
  { providerId: "cursor", name: "Cursor", pluginId: "cursor" },
  { providerId: "devin", name: "Devin", pluginId: "devin" },
  { providerId: "factory", name: "Factory", pluginId: "factory" },
  { providerId: "grok", name: "Grok", pluginId: "grok" },
  { providerId: "github-copilot", name: "GitHub Copilot", pluginId: "copilot" },
  { providerId: "jetbrains-ai-assistant", name: "JetBrains AI Assistant", pluginId: "jetbrains-ai-assistant" },
  { providerId: "kimi", name: "Kimi", pluginId: "kimi" },
  { providerId: "kiro", name: "Kiro", pluginId: "kiro" },
  { providerId: "opencode-go", name: "OpenCode Go", pluginId: "opencode-go" },
  { providerId: "perplexity", name: "Perplexity", pluginId: "perplexity" },
  { providerId: "synthetic", name: "Synthetic", pluginId: "synthetic" },
  { providerId: "zai", name: "Z.ai", pluginId: "zai" },
] as const;

const bundledPluginsDir = resolve(import.meta.dir, "../../../plugins");
const bundledPluginIdPattern = /^[a-z0-9-]+$/;

export function resolveBundledPluginScriptPath(pluginId: string): string {
  if (!bundledPluginIdPattern.test(pluginId)) {
    throw new Error("Invalid bundled plugin id.");
  }
  const scriptPath = resolve(bundledPluginsDir, pluginId, "plugin.js");
  const relativePath = relative(bundledPluginsDir, scriptPath);
  if (relativePath.startsWith("..") || relativePath === "" || isAbsolute(relativePath)) {
    throw new Error("Invalid bundled plugin id.");
  }
  return scriptPath;
}

export function getProviders(): UsageProvider[] {
  return [
    new CcusageProvider(),
    ...pluginProviders.map((provider) => new OpenUsagePluginProvider({
      providerId: provider.providerId,
      name: provider.name,
      pluginId: provider.pluginId,
      scriptPath: resolveBundledPluginScriptPath(provider.pluginId),
    })),
    new ManualProvider(),
    new MiniMaxProvider(),
  ];
}
