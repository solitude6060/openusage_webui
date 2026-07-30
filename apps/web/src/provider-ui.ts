import {
  isMultiAccountProviderId,
  isProviderAccountId,
  MULTI_ACCOUNT_PROVIDER_IDS,
  type ProviderId,
  type ProviderStatus,
} from "../../../packages/core/src/types";

export const CCUSAGE_NOTE = "via ccusage" as const;

export const providerCards: Array<{ providerId: ProviderId; name: string; note?: string }> = [
  { providerId: "ccusage", name: "ccusage" },
  { providerId: "amp", name: "Amp", note: "OpenUsage Plugin" },
  { providerId: "antigravity", name: "Antigravity", note: "OpenUsage Plugin" },
  { providerId: "claude-code", name: "Claude Code", note: "OpenUsage Plugin" },
  { providerId: "codex", name: "Codex", note: "OpenUsage Plugin" },
  { providerId: "cursor", name: "Cursor", note: "OpenUsage Plugin" },
  { providerId: "devin", name: "Devin", note: "OpenUsage Plugin" },
  { providerId: "factory", name: "Factory", note: "OpenUsage Plugin" },
  { providerId: "grok", name: "Grok", note: "OpenUsage Plugin" },
  { providerId: "github-copilot", name: "GitHub Copilot", note: "OpenUsage Plugin" },
  { providerId: "jetbrains-ai-assistant", name: "JetBrains AI Assistant", note: "OpenUsage Plugin" },
  { providerId: "kimi", name: "Kimi", note: "OpenUsage Plugin" },
  { providerId: "kiro", name: "Kiro", note: "OpenUsage Plugin" },
  { providerId: "opencode-go", name: "OpenCode Go", note: "OpenUsage Plugin" },
  { providerId: "perplexity", name: "Perplexity", note: "OpenUsage Plugin" },
  { providerId: "synthetic", name: "Synthetic", note: "OpenUsage Plugin" },
  { providerId: "zai", name: "Z.ai", note: "OpenUsage Plugin" },
  { providerId: "gemini-cli", name: "Gemini CLI / Google AI Pro", note: CCUSAGE_NOTE },
  { providerId: "minimax", name: "MiniMax" },
  { providerId: "manual", name: "Manual" },
];

const refreshableProviders = new Set<ProviderId>([
  "ccusage",
  "amp",
  "antigravity",
  "claude-code",
  "codex",
  "cursor",
  "devin",
  "factory",
  "grok",
  "github-copilot",
  "jetbrains-ai-assistant",
  "kimi",
  "kiro",
  "opencode-go",
  "perplexity",
  "synthetic",
  "zai",
  "manual",
  "minimax",
]);

export function isProviderRefreshable(providerId: ProviderId): boolean {
  return refreshableProviders.has(providerId) || isProviderAccountId(providerId);
}

export function getProviderStatusLabel(provider: { note?: string }): string {
  if (provider.note === CCUSAGE_NOTE) return "Via ccusage";
  return provider.note === "OpenUsage Plugin" ? "Adapter Loaded" : "Detected";
}

const providerLabelMap = new Map(providerCards.map((card) => [card.providerId, card.name]));

export function providerLabel(
  providerId: ProviderId,
  statusName?: string | null,
): string {
  if (statusName && statusName.trim()) return statusName;
  return providerLabelMap.get(providerId) ?? providerId;
}

/** Build Providers page cards, swapping bare multi-account providers for configured accounts. */
export function listProviderCards(statuses: ProviderStatus[]): Array<{
  providerId: ProviderId;
  name: string;
  note?: string;
}> {
  const accountStatuses = statuses.filter((status) => isProviderAccountId(status.providerId));
  const replacedBases = new Set(
    MULTI_ACCOUNT_PROVIDER_IDS.filter((providerId) =>
      accountStatuses.some((status) => status.providerId.startsWith(`${providerId}:`)),
    ),
  );
  const base = providerCards.filter((card) => {
    if (!isMultiAccountProviderId(card.providerId)) return true;
    return !replacedBases.has(card.providerId);
  });
  const extras = accountStatuses.map((status) => ({
    providerId: status.providerId,
    name: status.name,
    note: "OpenUsage Plugin",
  }));
  return [...base, ...extras];
}

// Urgency tones emitted by plugins on a `badge` line (e.g. codex reset-credit
// expiry). Known tones render as a colored status pill; anything else falls back
// to the neutral value chip so legacy badges look unchanged.
const RESET_BADGE_TONES = new Set(["expired", "urgent", "soon", "week", "normal"]);

export function badgeToneClassName(tone: unknown): string {
  return typeof tone === "string" && RESET_BADGE_TONES.has(tone) ? `status-pill reset-${tone}` : "value-chip";
}

// Decide how a reset-credit badge renders, given its raw expiry string, baked tone, and the
// current time. Validating here keeps the render path from feeding an invalid date into
// Intl.DateTimeFormat (which throws and, with no error boundary, would blank the dashboard).
// A credit that has already lapsed gets the "expired" styling regardless of the baked tone,
// so the pill color/dot match the "Expired" text once it crosses the line between refreshes.
export function resetCreditExpiryView(
  expiresAt: unknown,
  tone: unknown,
  nowMs: number,
): { valid: boolean; expired: boolean; toneClass: string } {
  const ms = typeof expiresAt === "string" ? new Date(expiresAt).getTime() : Number.NaN;
  const valid = Number.isFinite(ms);
  const expired = valid && ms <= nowMs;
  return { valid, expired, toneClass: badgeToneClassName(expired ? "expired" : tone) };
}

// The text to show in a plain (non-expiry) badge pill, or null when there is nothing to
// show. Returning null lets the renderer skip the pill entirely instead of drawing an
// empty chip when a badge arrives without its text (e.g. partial/garbled plugin data).
export function plainBadgeText(text: unknown): string | null {
  return typeof text === "string" && text.trim() !== "" ? text : null;
}
