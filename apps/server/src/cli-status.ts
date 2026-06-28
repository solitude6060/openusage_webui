import {
  getDatabasePath,
  SqliteStorage,
} from "../../../packages/storage/src/index";
import { getProviders } from "../../../packages/providers/src/index";
import type { ProviderId, UsageRecord } from "../../../packages/core/src/types";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";
const BG_BAR = "\x1b[48;5;236m";
const BG_FILL = "\x1b[48;5;30m";
const BG_WARN = "\x1b[48;5;124m";

const BAR_WIDTH = 30;

function formatRelative(isoString: string, nowMs: number = Date.now()): string {
  const diff = new Date(isoString).getTime() - nowMs;
  if (diff <= 0) return "now";
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m`;
  return "<1m";
}

// Render a `badge` line for the terminal. Reset-credit badges carry their payload in
// `expiresAt` (plus a baked urgency `tone`), NOT `text` — so mirror the WebUI: show a
// live countdown (or "Expired") and the exact expiry date, colored by urgency
// (urgent = red, soon = amber, otherwise grey). A badge without a valid `expiresAt`
// falls back to its plain `text`.
export function formatBadgeLine(line: Record<string, unknown>, nowMs: number = Date.now()): string {
  const label = String(line.label ?? "");
  const expiresAt = typeof line.expiresAt === "string" ? line.expiresAt : undefined;
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;

  if (expiresAt && Number.isFinite(expiresMs)) {
    const expired = expiresMs <= nowMs;
    // A lapsed credit reads as expired regardless of the baked tone (mirrors the WebUI).
    const tone = expired ? "expired" : typeof line.tone === "string" ? line.tone : "";
    const color = tone === "urgent" ? RED : tone === "soon" ? YELLOW : DIM;
    const when = expired ? "Expired" : formatRelative(expiresAt, nowMs);
    const date = new Date(expiresMs).toLocaleString();
    return `  ${DIM}${label.padEnd(16)}${RESET} ${color}${when}${RESET} ${DIM}(expires ${date})${RESET}`;
  }

  const text = String(line.text ?? "");
  return `  ${DIM}${label.padEnd(16)}${RESET} ${YELLOW}${text}${RESET}`;
}

function progressBar(used: number, limit: number): string {
  const pct = Math.min(1, used / limit);
  const filled = Math.round(pct * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const bg = pct >= 0.9 ? BG_WARN : BG_FILL;
  return `${bg}${" ".repeat(filled)}${BG_BAR}${" ".repeat(empty)}${RESET}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

async function main() {
  const doRefresh = process.argv.includes("--refresh") || process.argv.includes("-r");

  const storage = new SqliteStorage();
  await storage.init();

  if (doRefresh) {
    console.log(`${DIM}Refreshing providers...${RESET}`);
    const providers = getProviders();
    const statusMap = new Map(
      (await storage.listProviderStatus()).map((s) => [s.providerId, s]),
    );
    for (const provider of providers) {
      const existing = statusMap.get(provider.id);
      if (existing && !existing.enabled) continue;
      try {
        const detected = await provider.detect();
        const records = await provider.refresh();
        await storage.upsertUsageRecords(records);
        await storage.upsertProviderStatus({
          providerId: provider.id,
          name: provider.name,
          enabled: existing?.enabled ?? true,
          detected,
          lastRefreshAt: new Date().toISOString(),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await storage.upsertProviderStatus({
          providerId: provider.id,
          name: provider.name,
          enabled: existing?.enabled ?? true,
          detected: existing?.detected ?? false,
          lastRefreshAt: new Date().toISOString(),
          lastError: msg,
        });
      }
    }
    console.log("");
  }

  const records = await storage.listUsageRecords({ limit: 100 });
  const statuses = await storage.listProviderStatus();
  const statusMap = new Map(statuses.map((s) => [s.providerId, s]));

  const latestByProvider = new Map<ProviderId, UsageRecord>();
  for (const record of records) {
    if (
      !latestByProvider.has(record.providerId) &&
      isPlainObject(record.raw) &&
      Array.isArray((record.raw as Record<string, unknown>).lines)
    ) {
      latestByProvider.set(record.providerId, record);
    }
  }

  if (latestByProvider.size === 0) {
    console.log(`${DIM}No usage data. Run with --refresh to fetch.${RESET}`);
    storage.close();
    return;
  }

  const providerNames: Record<string, string> = {
    "claude-code": "Claude Code",
    codex: "Codex",
    cursor: "Cursor",
    "github-copilot": "GitHub Copilot",
    minimax: "MiniMax",
  };

  for (const [providerId, record] of latestByProvider) {
    const raw = record.raw as Record<string, unknown>;
    const lines = raw.lines as Array<Record<string, unknown>>;
    const plan = typeof raw.plan === "string" ? raw.plan : "";
    const status = statusMap.get(providerId);
    const name = providerNames[providerId] ?? providerId;

    console.log(
      `${BOLD}${WHITE}${name}${RESET}${plan ? `  ${CYAN}${plan}${RESET}` : ""}`,
    );

    for (const line of lines) {
      if (line.type === "progress") {
        const used = Number(line.used) || 0;
        const limit = Number(line.limit) || 100;
        const remaining = Math.max(0, limit - used);
        const format = line.format as Record<string, unknown> | undefined;
        const kind = isPlainObject(format) ? String(format.kind ?? "percent") : "percent";
        const resetsAt = typeof line.resetsAt === "string" ? line.resetsAt : undefined;

        let valueText: string;
        if (kind === "percent") {
          const usedDisplay = parseFloat(used.toFixed(1));
          const remainingDisplay = parseFloat(remaining.toFixed(1));
          valueText = `${usedDisplay}% used, ${remainingDisplay}% left`;
        } else {
          const suffix = isPlainObject(format) && typeof format.suffix === "string" ? ` ${format.suffix}` : "";
          valueText = `${used}/${limit}${suffix}`;
        }

        const resetText = resetsAt ? `${DIM}resets ${formatRelative(resetsAt)}${RESET}` : "";
        console.log(`  ${String(line.label).padEnd(16)} ${progressBar(used, limit)} ${valueText}  ${resetText}`);
      } else if (line.type === "text") {
        const label = String(line.label);
        const value = String(line.value ?? "");
        console.log(`  ${DIM}${label.padEnd(16)}${RESET} ${value}`);
      } else if (line.type === "badge") {
        console.log(formatBadgeLine(line));
      }
    }

    if (status?.lastRefreshAt) {
      const ago = formatRelative(
        new Date(Date.now() - (Date.now() - new Date(status.lastRefreshAt).getTime())).toISOString(),
      );
      console.log(`  ${DIM}Updated ${new Date(status.lastRefreshAt).toLocaleString()}${RESET}`);
    }
    console.log("");
  }

  storage.close();
}

// Only run when invoked directly (`bun cli-status.ts`), so tests can import the
// pure helpers above without kicking off the whole status report.
if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
