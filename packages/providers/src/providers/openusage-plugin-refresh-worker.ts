import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ProviderId, UsageRecord } from "../../../core/src/types";

// A hung plugin blocks only this worker. 120s matches the server idle timeout,
// which is longer than the 33s Cursor refresh measured on 2026-10-10.
const PLUGIN_REFRESH_WORKER_TIMEOUT_MS = 120_000;

export interface OpenUsagePluginWorkerOptions {
  providerId: ProviderId;
  name: string;
  pluginId?: string;
  scriptPath?: string;
  scriptText?: string;
  env: Record<string, string | undefined>;
  homeDir: string;
  pluginDataDir: string;
  recordCcusageTokens: boolean;
}

type WorkerResponse =
  | { ok: true; records: UsageRecord[] }
  | { ok: false; error: string };

export function refreshOpenUsagePluginInWorker(
  options: OpenUsagePluginWorkerOptions,
): Promise<UsageRecord[]> {
  const entryUrl = new URL(
    import.meta.url.endsWith(".ts") ? "./openusage-plugin-worker.ts" : "./openusage-plugin-worker.js",
    import.meta.url,
  );
  const entryPath = fileURLToPath(entryUrl);
  if (!existsSync(entryPath)) {
    return Promise.reject(new Error(`OpenUsage plugin worker entry is missing: ${entryPath}`));
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(entryUrl.href);
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      settle();
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new Error("OpenUsage plugin refresh timed out.")));
    }, PLUGIN_REFRESH_WORKER_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      if (isWorkerSuccess(data)) {
        finish(() => resolve(data.records));
        return;
      }
      const message = isWorkerFailure(data) ? data.error : "OpenUsage plugin refresh failed.";
      finish(() => reject(new Error(message)));
    };
    worker.onerror = (event: ErrorEvent) => {
      finish(() => reject(new Error(workerErrorMessage(event))));
    };
    worker.addEventListener("close", (event: Event) => {
      const code = "code" in event ? String((event as { code: unknown }).code) : "unknown";
      finish(() => reject(new Error(`OpenUsage plugin refresh worker exited (${code}).`)));
    });
    worker.postMessage({ options });
  });
}

function isWorkerSuccess(value: unknown): value is { ok: true; records: UsageRecord[] } {
  if (!value || typeof value !== "object") return false;
  const record = value as { ok?: unknown; records?: unknown };
  return record.ok === true && Array.isArray(record.records);
}

function isWorkerFailure(value: unknown): value is { ok: false; error: string } {
  if (!value || typeof value !== "object") return false;
  const record = value as { ok?: unknown; error?: unknown };
  return record.ok === false && typeof record.error === "string";
}

function workerErrorMessage(event: ErrorEvent): string {
  if (typeof event.message === "string" && event.message.trim()) return event.message;
  if (event.error instanceof Error && event.error.message) return event.error.message;
  return "OpenUsage plugin refresh worker failed.";
}
