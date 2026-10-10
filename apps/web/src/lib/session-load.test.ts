import { describe, expect, test } from "bun:test";
import { shouldApplySessionLoad } from "./session-load";

describe("session load generation", () => {
  test("a slower older request does not replace the latest records, error, or filters", () => {
    let latestRequestId = 0;
    let records: string[] = [];
    let error: string | null = "previous";
    let loadedFilters = "previous";

    function publish(requestId: number, next: {
      records?: string[];
      error?: string | null;
      loadedFilters: string;
      failed: boolean;
    }) {
      if (!shouldApplySessionLoad(requestId, latestRequestId)) return;
      loadedFilters = next.loadedFilters;
      if (next.failed) {
        error = next.error ?? "Filter failed";
        return;
      }
      error = null;
      records = next.records ?? [];
    }

    const olderRequestId = ++latestRequestId;
    const newerRequestId = ++latestRequestId;
    publish(newerRequestId, { records: ["fresh"], loadedFilters: "newer", failed: false });
    publish(olderRequestId, { records: ["stale"], loadedFilters: "older", failed: false });
    publish(olderRequestId, { error: "stale failure", loadedFilters: "older", failed: true });

    expect(records).toEqual(["fresh"]);
    expect(error).toBeNull();
    expect(loadedFilters).toBe("newer");
  });

  test("the latest request still publishes its result", () => {
    expect(shouldApplySessionLoad(3, 3)).toBe(true);
  });
});
