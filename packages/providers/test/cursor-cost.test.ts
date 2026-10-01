import { describe, expect, test } from "bun:test";
import { CursorUsageCollector } from "../src/providers/structured-usage";

function cost(event: Record<string, unknown>) {
  const collector = new CursorUsageCollector();
  collector.capture(200, JSON.stringify({ usageEventsDisplay: [{
    timestamp: "2026-09-30T12:00:00Z", model: "test", tokenUsage: { inputTokens: 100 }, ...event,
  }], totalUsageEventsCount: 1 }));
  return collector.records("cursor")[0]!.costUsd;
}

describe("Cursor event costs", () => {
  for (const usageBasedCosts of ["N/A", "Included", "", "   ", "$3foo", "USD 3", "$1,23.45", "1.2.3"]) {
    test(`keeps ${JSON.stringify(usageBasedCosts)} unknown`, () => {
      expect(cost({ usageBasedCosts })).toBeUndefined();
    });
  }
  test("keeps numeric and formatted zero costs", () => {
    expect(cost({ chargedCents: 0 })).toBe(0);
    expect(cost({ tokenUsage: { inputTokens: 100, totalCents: 0 } })).toBe(0);
    expect(cost({ usageBasedCosts: "$0.00" })).toBe(0);
  });
  test("parses a displayed dollar cost", () => {
    expect(cost({ usageBasedCosts: "$1.23" })).toBe(1.23);
    expect(cost({ usageBasedCosts: "$1,234.56" })).toBe(1234.56);
    expect(cost({ usageBasedCosts: "12.34" })).toBe(12.34);
    expect(cost({ usageBasedCosts: "  $0.50  " })).toBe(0.5);
  });
});
