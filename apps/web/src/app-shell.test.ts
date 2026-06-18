import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

describe("WebUI app shell", () => {
  test("declares an explicit favicon to avoid browser favicon.ico probes", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

    expect(html).toContain('rel="icon"');
    expect(html).toContain("/favicon.svg");
    expect(existsSync(new URL("../public/favicon.svg", import.meta.url))).toBe(true);
  });
});
