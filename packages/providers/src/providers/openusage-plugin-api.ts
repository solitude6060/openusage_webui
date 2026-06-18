import type { PluginRequestOptions, PluginRequestResponse } from "./openusage-plugin-runtime";

export function normalizePluginResult(result: unknown): { plan: string | null; lines: unknown[] } {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("OpenUsage plugin returned invalid usage data.");
  }
  const value = result as Record<string, unknown>;
  return {
    plan: typeof value.plan === "string" && value.plan.trim() ? value.plan : null,
    lines: Array.isArray(value.lines) ? JSON.parse(JSON.stringify(value.lines)) : [],
  };
}

export function createLineApi(): Record<string, unknown> {
  return {
    text: (opts: Record<string, unknown>) => copyKnown(opts, ["type", "label", "value", "color", "subtitle"], "text"),
    progress: (opts: Record<string, unknown>) =>
      copyKnown(
        opts,
        ["type", "label", "used", "limit", "format", "resetsAt", "periodDurationMs", "color"],
        "progress",
      ),
    badge: (opts: Record<string, unknown>) => copyKnown(opts, ["type", "label", "text", "color", "subtitle"], "badge"),
    barChart: (opts: Record<string, unknown>) => copyKnown(opts, ["type", "label", "points", "note", "color"], "barChart"),
  };
}

function copyKnown(source: Record<string, unknown>, keys: string[], type: string): Record<string, unknown> {
  const out: Record<string, unknown> = { type };
  for (const key of keys) {
    if (key === "type") continue;
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

export function createFormatApi(): Record<string, unknown> {
  return {
    planLabel: (value: unknown) =>
      String(value || "")
        .trim()
        .replace(/(^|\s)([a-z])/g, (_match, space, letter) => space + String(letter).toUpperCase()),
    dollars: (cents: unknown) => Math.round((Number(cents) / 100) * 100) / 100,
    resetIn: (secondsUntil: unknown) => {
      const seconds = Number(secondsUntil);
      if (!Number.isFinite(seconds) || seconds < 0) return null;
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      if (days > 0) return `${days}d ${hours % 24}h`;
      if (hours > 0) return `${hours}h ${minutes % 60}m`;
      if (minutes > 0) return `${minutes}m`;
      return "<1m";
    },
  };
}

export function createBase64Api(): Record<string, unknown> {
  return {
    decode: (value: string) => Buffer.from(normalizeBase64(value), "base64").toString("utf8"),
    encode: (value: string) => Buffer.from(String(value), "utf8").toString("base64"),
  };
}

export function createJwtApi(): Record<string, unknown> {
  return {
    decodePayload: (token: string) => {
      try {
        const [, payload] = String(token).split(".");
        if (!payload) return null;
        return JSON.parse(Buffer.from(normalizeBase64(payload), "base64").toString("utf8"));
      } catch {
        return null;
      }
    },
  };
}

export function createUtilApi(request: (opts: PluginRequestOptions) => PluginRequestResponse): Record<string, unknown> {
  const safeJsonParse = (text: unknown) => {
    try {
      return { ok: true, value: JSON.parse(String(text ?? "")) };
    } catch {
      return { ok: false };
    }
  };
  return {
    tryParseJson: (text: unknown) => {
      try {
        return JSON.parse(String(text ?? ""));
      } catch {
        return null;
      }
    },
    safeJsonParse,
    request,
    requestJson: (opts: PluginRequestOptions) => {
      const resp = request(opts);
      const parsed = safeJsonParse(resp.bodyText);
      return { resp, json: parsed.ok ? parsed.value : null };
    },
    isAuthStatus: (status: unknown) => status === 401 || status === 403,
    retryOnceOnAuth: (opts: { request: (token?: string) => PluginRequestResponse; refresh: () => string | null }) => {
      let resp = opts.request();
      if (resp.status === 401 || resp.status === 403) {
        const token = opts.refresh();
        if (token) resp = opts.request(token);
      }
      return resp;
    },
    parseDateMs: (value: unknown) => {
      const parsed = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(String(value));
      return Number.isFinite(parsed) ? parsed : null;
    },
    toIso: (value: unknown) => {
      if (value === null || value === undefined) return null;
      const ms = typeof value === "number" && Math.abs(value) < 1e10 ? value * 1000 : Number(value);
      const date = Number.isFinite(ms) ? new Date(ms) : new Date(String(value));
      return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    },
    needsRefreshByExpiry: (opts: { nowMs?: number; expiresAtMs?: number; bufferMs?: number }) => {
      const nowMs = Number(opts?.nowMs);
      const expiresAtMs = Number(opts?.expiresAtMs);
      const bufferMs = Number(opts?.bufferMs ?? 0);
      return !Number.isFinite(nowMs) || !Number.isFinite(expiresAtMs) || nowMs + bufferMs >= expiresAtMs;
    },
  };
}

function normalizeBase64(value: string): string {
  let text = String(value).replace(/-/g, "+").replace(/_/g, "/");
  while (text.length % 4) text += "=";
  return text;
}
