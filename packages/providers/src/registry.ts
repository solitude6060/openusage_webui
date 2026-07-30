import { isAbsolute, relative, resolve } from "node:path";
import type { MultiAccountProviderId, ProviderAccount } from "../../core/src/types";
import { homeEnvForProvider } from "./account-detect";
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

export interface GetProvidersOptions {
  /** Preferred: all configured provider accounts across multi-account providers. */
  providerAccounts?: ProviderAccount[];
  /** @deprecated Prefer providerAccounts */
  codexInstances?: ProviderAccount[];
  env?: NodeJS.ProcessEnv;
}

function createHomedPluginProvider(options: {
  providerId: string;
  name: string;
  pluginId: string;
  baseProviderId: MultiAccountProviderId;
  homePath: string | undefined;
  env: NodeJS.ProcessEnv;
}): UsageProvider {
  const providerEnv = { ...options.env };
  if (options.homePath) {
    providerEnv[homeEnvForProvider(options.baseProviderId)] = options.homePath;
  }
  return new OpenUsagePluginProvider({
    providerId: options.providerId,
    name: options.name,
    pluginId: options.pluginId,
    scriptPath: resolveBundledPluginScriptPath(options.pluginId),
    env: providerEnv,
  });
}

function accountsForProvider(
  providerId: string,
  accounts: ProviderAccount[],
): ProviderAccount[] {
  return accounts.filter((account) => account.providerId === providerId);
}

export function getProviders(options: GetProvidersOptions = {}): UsageProvider[] {
  const env = options.env ?? process.env;
  const accounts = options.providerAccounts ?? options.codexInstances ?? [];

  const plugins = pluginProviders.flatMap((provider) => {
    const providerAccounts = accountsForProvider(provider.providerId, accounts);
    if (
      (provider.providerId === "codex" || provider.providerId === "claude-code") &&
      providerAccounts.length > 0
    ) {
      return providerAccounts.map((account) =>
        createHomedPluginProvider({
          providerId: account.id,
          name: account.label,
          pluginId: provider.pluginId,
          baseProviderId: account.providerId,
          homePath: account.homePath,
          env,
        }),
      );
    }

    if (provider.providerId === "codex" || provider.providerId === "claude-code") {
      return [
        createHomedPluginProvider({
          providerId: provider.providerId,
          name: provider.name,
          pluginId: provider.pluginId,
          baseProviderId: provider.providerId,
          homePath: undefined,
          env,
        }),
      ];
    }

    return [
      new OpenUsagePluginProvider({
        providerId: provider.providerId,
        name: provider.name,
        pluginId: provider.pluginId,
        scriptPath: resolveBundledPluginScriptPath(provider.pluginId),
        env,
      }),
    ];
  });

  return [
    new CcusageProvider(),
    ...plugins,
    new ManualProvider(),
    new MiniMaxProvider(),
  ];
}
