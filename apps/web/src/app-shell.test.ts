import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { AUTO_REFRESH_INTERVAL_MS } from "./App";
import { WEB_AUTO_REFRESH_LABEL } from "./pages/settings-page";

describe("WebUI app shell", () => {
  test("declares an explicit favicon to avoid browser favicon.ico probes", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

    expect(html).toContain('rel="icon"');
    expect(html).toContain("/favicon.svg");
    expect(existsSync(new URL("../public/favicon.svg", import.meta.url))).toBe(true);
  });

  test("refreshes providers every 20 minutes", () => {
    expect(AUTO_REFRESH_INTERVAL_MS).toBe(20 * 60_000);
  });

  test("shows the 20 minute refresh interval in settings", () => {
    expect(WEB_AUTO_REFRESH_LABEL).toBe("Every 20 Minutes");
  });
});
