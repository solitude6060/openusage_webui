import { describe, expect, test } from "bun:test";
import { formatBadgeLine } from "../src/cli-status";

// Strip ANSI color codes so assertions match on the visible text only.
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("cli-status reset-credit badge", () => {
  const NOW = Date.parse("2026-06-29T00:00:00.000Z");

  test("renders countdown + expiry date for a reset-credit badge (data in expiresAt, no text)", () => {
    // Regression: codex reset-credit badges put their data in `expiresAt`, not `text`.
    // The CLI used to read only `text`, printing an empty "Reset Credit" line.
    const future = new Date(NOW + 13 * 24 * 60 * 60 * 1000).toISOString();
    const out = plain(
      formatBadgeLine({ type: "badge", label: "Reset Credit", tone: "week", expiresAt: future }, NOW),
    );
    expect(out).toContain("Reset Credit");
    expect(out).toContain("13d"); // live countdown
    expect(out.toLowerCase()).toContain("expires"); // exact expiry date
    expect(out.trim()).not.toBe("Reset Credit"); // must NOT be the empty label
  });

  test("shows Expired for a lapsed credit", () => {
    const past = new Date(NOW - 60_000).toISOString();
    const out = plain(
      formatBadgeLine({ type: "badge", label: "Reset Credit", tone: "urgent", expiresAt: past }, NOW),
    );
    expect(out).toContain("Expired");
  });

  test("falls back to text for a plain badge without expiresAt", () => {
    const out = plain(formatBadgeLine({ type: "badge", label: "Plan", text: "Pro" }, NOW));
    expect(out).toContain("Pro");
  });

  test("ignores an unparseable expiresAt and falls back to text", () => {
    const out = plain(
      formatBadgeLine({ type: "badge", label: "Reset Credit", text: "n/a", expiresAt: "not-a-date" }, NOW),
    );
    expect(out).toContain("n/a");
    expect(out).not.toContain("Invalid");
  });
});
