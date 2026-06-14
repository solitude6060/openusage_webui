import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequestHandler } from "../src/index";
import { SqliteStorage } from "../../../packages/storage/src/index";

let dataDir: string;
let previousDataDir: string | undefined;
let storage: SqliteStorage;
let handleRequest: (request: Request) => Promise<Response>;

beforeEach(async () => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-webui-api-test-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
  storage = new SqliteStorage();
  await storage.init();
  handleRequest = createRequestHandler(storage, {
    host: "127.0.0.1",
    port: 6736,
  });
});

afterEach(() => {
  storage.close();
  if (previousDataDir === undefined) {
    delete process.env.OPENUSAGE_WEBUI_DIR;
  } else {
    process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("WebUI API", () => {
  test("reports the actual bind port in health", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:6736/api/health"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      host: "127.0.0.1",
      port: 6736,
    });
  });

  test("rejects unexpected Host headers", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:6736/api/health", {
      headers: {
        host: "evil.test",
      },
    }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN_HOST");
  });

  test("returns bad request for unknown provider ids", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:6736/api/providers/unknown/refresh", {
      method: "POST",
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  test("returns bad request for malformed JSON", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:6736/api/manual/usage", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "not json",
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  test("refresh all treats deferred ccusage as a neutral no-op", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:6736/api/providers/refresh", {
      method: "POST",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results).toEqual([
      { providerId: "ccusage", ok: true, records: 0 },
      { providerId: "manual", ok: true, records: 0 },
      { providerId: "minimax", ok: true, records: 0 },
    ]);
  });
});
