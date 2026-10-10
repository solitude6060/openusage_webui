import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const serverDir = resolve(import.meta.dir, "..");
let fixtureDir: string;

beforeAll(() => {
  const fixtureRoot = process.env.OPENUSAGE_TEST_ARTIFACTS_DIR
    ?? join(import.meta.dir, "refresh-followups.local");
  mkdirSync(fixtureRoot, { recursive: true });
  fixtureDir = mkdtempSync(join(fixtureRoot, "refresh-bundle-"));
  const build = Bun.spawnSync([process.execPath, "run", "--cwd", serverDir, "build"], {
    stdout: "pipe", stderr: "pipe",
  });
  writeFileSync(join(fixtureDir, "build.log"), Buffer.concat([build.stdout, build.stderr]));
  expect(build.exitCode).toBe(0);
});

describe("default plugin refresh in both server layouts", () => {
  test.each(["src/index.ts", "dist/index.js"])("refreshes Synthetic through %s", (entry) => {
    const home = mkdtempSync(join(fixtureDir, "home-"));
    const bin = join(home, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "curl"), `#!/bin/sh
printf '%s\\r\\n' 'HTTP/1.1 200 OK' 'Content-Type: application/json' '' '{"rollingFiveHourLimit":{"max":100,"remaining":50}}'
`, { mode: 0o755 });
    const probePath = join(home, "probe.ts");
    const resultPath = join(home, "result.json");
    const storageUrl = pathToFileURL(resolve(serverDir, "../../packages/storage/src/index.ts")).href;
    writeFileSync(probePath, `
import { writeFileSync } from "node:fs";
import { SqliteStorage } from ${JSON.stringify(storageUrl)};
const { createRequestHandler } = await import(process.argv[2]);
const storage = new SqliteStorage();
await storage.init();
try {
  // Omit providers and runtime functions so the bundled default provider starts its worker.
  const handler = createRequestHandler(storage, { host: "127.0.0.1", port: 6736 });
  const response = await handler(new Request("http://127.0.0.1:6736/api/providers/synthetic/refresh", { method: "POST" }));
  const result = {
    entry: process.argv[2], status: response.status, body: await response.json(),
    records: await storage.listUsageRecords({ providerId: "synthetic" }),
  };
  writeFileSync(process.argv[3], JSON.stringify(result, null, 2));
} finally {
  storage.close();
}
`);
    const probe = Bun.spawnSync([
      process.execPath, probePath, pathToFileURL(join(serverDir, entry)).href, resultPath,
    ], {
      cwd: home,
      env: {
        HOME: home, PATH: bin, OPENUSAGE_WEBUI_DIR: join(home, "data"),
        SYNTHETIC_API_KEY: "fixture-synthetic-key", TMPDIR: home,
      },
      stdout: "pipe", stderr: "pipe",
    });
    writeFileSync(join(home, "probe.log"), Buffer.concat([probe.stdout, probe.stderr]));
    expect(probe.exitCode).toBe(0);
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    console.log(JSON.stringify({ event: "bundle_refresh_verification", ...result }));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true, results: [{ providerId: "synthetic", ok: true, records: 1 }],
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      providerId: "synthetic", source: "api", tool: "OpenUsage Plugin Snapshot",
      raw: { pluginId: "synthetic", lines: [{
        type: "progress", label: "5h Rate Limit", used: 50, limit: 100,
        format: { kind: "count", suffix: "requests" },
      }] },
    });
  });
});
