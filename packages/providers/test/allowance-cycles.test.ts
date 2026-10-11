import { describe, expect, test } from "bun:test";
import { buildAllowanceCycleSummaries } from "../src/allowance-cycles";
import type { AllowanceObservation } from "../src/allowance-estimate";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function observation(
  observedAt: string,
  usedPercent: number,
  resetsAt: string,
  providerId = "grok",
  periodMs = WEEK_MS,
): AllowanceObservation {
  return {
    providerId,
    observedAt,
    windowKey: "weekly",
    windowLabel: "Weekly",
    periodMs,
    resetsAt,
    present: true,
    usedPercent,
    limitValue: null,
    limitUnit: null,
  };
}

describe("allowance cycle boundaries", () => {
  test("ends a cycle at the next cycle's start when the provider restarts early", () => {
    const summaries = buildAllowanceCycleSummaries(
      [
        observation("2026-10-08T00:00:00.000Z", 10, "2026-10-14T00:00:00.000Z"),
        observation("2026-10-10T00:00:00.000Z", 40, "2026-10-14T00:00:00.000Z"),
        observation("2026-10-10T18:00:00.000Z", 5, "2026-10-17T12:00:00.000Z"),
      ],
      [],
      new Set(),
      new Date("2026-10-11T00:00:00.000Z"),
    );

    expect(summaries.flatMap((item) => item.cycles)).toEqual([
      expect.objectContaining({
        start: "2026-10-07T00:00:00.000Z",
        end: "2026-10-10T12:00:00.000Z",
        lengthMs: 3.5 * DAY_MS,
      }),
    ]);
  });
});

describe("allowance cycle exclusion", () => {
  test("excludes a cycle whose meter falls", () => {
    const summaries = buildAllowanceCycleSummaries(
      [
        observation("2026-10-02T00:00:00.000Z", 10, "2026-10-08T00:00:00.000Z"),
        observation("2026-10-05T00:00:00.000Z", 40, "2026-10-08T00:00:00.000Z"),
        observation("2026-10-07T12:00:00.000Z", 25, "2026-10-08T00:00:00.000Z"),
      ],
      [],
      new Set(),
      new Date("2026-10-09T00:00:00.000Z"),
    );

    expect(summaries.flatMap((item) => item.cycles)).toEqual([
      expect.objectContaining({ included: false, exclusion: "meter-fell", endPercent: 40 }),
    ]);
  });
});
