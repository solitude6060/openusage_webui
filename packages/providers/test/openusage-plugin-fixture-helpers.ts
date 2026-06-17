import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { PluginRequestOptions, PluginRequestResponse } from "../src/index";

export function readPluginScript(pluginId: string): string {
  return readFileSync(resolve(import.meta.dir, "../../../plugins", pluginId, "plugin.js"), "utf8");
}

export async function withIsolatedHome<T>(run: (home: string) => Promise<T> | T): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), "openusage-plugin-home-"));
  try {
    return await run(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

export function createJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

export function jsonResponse(value: unknown): PluginRequestResponse {
  return { status: 200, headers: {}, bodyText: JSON.stringify(value) };
}

export function notFoundResponse(): PluginRequestResponse {
  return { status: 404, headers: {}, bodyText: "" };
}

export function requestByUrl(routes: Record<string, unknown>): (opts: PluginRequestOptions) => PluginRequestResponse {
  return (opts) => {
    if (Object.hasOwn(routes, opts.url)) {
      const value = routes[opts.url];
      if (typeof value === "function") {
        return (value as (opts: PluginRequestOptions) => PluginRequestResponse)(opts);
      }
      return jsonResponse(value);
    }
    throw new Error(`Unexpected request: ${opts.method ?? "GET"} ${opts.url}`);
  };
}
