import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequestHandler } from "../src/index";
import { SqliteStorage } from "../../../packages/storage/src/index";
import type { UsageProvider } from "../../../packages/providers/src/index";

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
  const providers: UsageProvider[] = [
    {
      id: "ccusage",
      name: "ccusage",
      detect: async () => true,
      refresh: async () => [],
    },
    {
      id: "manual",
      name: "Manual",
      detect: async () => true,
      refresh: async () => [],
    },
    {
      id: "minimax",
      name: "MiniMax",
      detect: async () => true,
      refresh: async () => [],
    },
  ];
  handleRequest = createRequestHandler(storage, {
    host: "127.0.0.1",
    port: 6736,
  }, undefined, providers);
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

  test("refresh all returns per-provider results", async () => {
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

  test("refresh all isolates provider-level failures", async () => {
    handleRequest = createRequestHandler(storage, {
      host: "127.0.0.1",
      port: 6736,
    }, undefined, [
      {
        id: "ccusage",
        name: "ccusage",
        detect: async () => false,
        refresh: async () => {
          throw new Error("ccusage unavailable");
        },
      },
      {
        id: "manual",
        name: "Manual",
        detect: async () => true,
        refresh: async () => [],
      },
    ]);

    const response = await handleRequest(new Request("http://127.0.0.1:6736/api/providers/refresh", {
      method: "POST",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      results: [
        { providerId: "ccusage", ok: false, error: "ccusage unavailable" },
        { providerId: "manual", ok: true, records: 0 },
      ],
    });
  });

  test("serves built frontend index for production SPA routes", async () => {
    const distDir = mkdtempSync(join(tmpdir(), "openusage-webui-dist-test-"));
    try {
      writeFileSync(join(distDir, "index.html"), "<!doctype html><title>OpenUsage Phase 3</title>");
      const productionHandler = createRequestHandler(
        storage,
        { host: "127.0.0.1", port: 6736 },
        undefined,
        [],
        distDir,
      );

      const response = await productionHandler(new Request("http://127.0.0.1:6736/dashboard"));
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html");
      expect(body).toContain("OpenUsage Phase 3");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  test("serves built frontend assets with content types", async () => {
    const distDir = mkdtempSync(join(tmpdir(), "openusage-webui-dist-test-"));
    try {
      mkdirSync(join(distDir, "assets"));
      writeFileSync(join(distDir, "index.html"), "<!doctype html>");
      writeFileSync(join(distDir, "assets", "app.css"), "body { color: black; }");
      const productionHandler = createRequestHandler(
        storage,
        { host: "127.0.0.1", port: 6736 },
        undefined,
        [],
        distDir,
      );

      const response = await productionHandler(new Request("http://127.0.0.1:6736/assets/app.css"));
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/css");
      expect(body).toContain("color: black");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  test("serves built frontend index for the root route", async () => {
    const distDir = mkdtempSync(join(tmpdir(), "openusage-webui-dist-test-"));
    try {
      writeFileSync(join(distDir, "index.html"), "<!doctype html><title>Root App</title>");
      const productionHandler = createRequestHandler(
        storage,
        { host: "127.0.0.1", port: 6736 },
        undefined,
        [],
        distDir,
      );

      const response = await productionHandler(new Request("http://127.0.0.1:6736/"));
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain("Root App");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  test("keeps static asset requests inside the frontend dist directory", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "openusage-webui-parent-test-"));
    const distDir = join(parentDir, "dist");
    try {
      mkdirSync(distDir);
      writeFileSync(join(parentDir, "outside.txt"), "outside secret");
      writeFileSync(join(distDir, "index.html"), "<!doctype html><title>Safe App</title>");
      const productionHandler = createRequestHandler(
        storage,
        { host: "127.0.0.1", port: 6736 },
        undefined,
        [],
        distDir,
      );

      const response = await productionHandler(
        new Request("http://127.0.0.1:6736/..%2foutside.txt"),
      );
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain("Safe App");
      expect(body).not.toContain("outside secret");
    } finally {
      rmSync(parentDir, { recursive: true, force: true });
    }
  });

  test("serves common production asset types with strict content types", async () => {
    const distDir = mkdtempSync(join(tmpdir(), "openusage-webui-dist-test-"));
    try {
      mkdirSync(join(distDir, "assets"));
      writeFileSync(join(distDir, "index.html"), "<!doctype html>");
      writeFileSync(join(distDir, "manifest.json"), "{\"name\":\"OpenUsage\"}");
      writeFileSync(join(distDir, "assets", "font.woff2"), "fake font");
      const productionHandler = createRequestHandler(
        storage,
        { host: "127.0.0.1", port: 6736 },
        undefined,
        [],
        distDir,
      );

      const manifest = await productionHandler(new Request("http://127.0.0.1:6736/manifest.json"));
      const font = await productionHandler(new Request("http://127.0.0.1:6736/assets/font.woff2"));

      expect(manifest.headers.get("content-type")).toBe("application/json");
      expect(font.headers.get("content-type")).toBe("font/woff2");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  test("returns a clear error when built frontend is missing", async () => {
    const distDir = mkdtempSync(join(tmpdir(), "openusage-webui-dist-test-"));
    const log = spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const productionHandler = createRequestHandler(
        storage,
        { host: "127.0.0.1", port: 6736 },
        undefined,
        [],
        distDir,
      );

      const response = await productionHandler(new Request("http://127.0.0.1:6736/dashboard"));
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error.code).toBe("FRONTEND_BUILD_MISSING");
      expect(log).toHaveBeenCalledWith(expect.stringContaining("frontend_build_missing"));
    } finally {
      log.mockRestore();
      rmSync(distDir, { recursive: true, force: true });
    }
  });
});
