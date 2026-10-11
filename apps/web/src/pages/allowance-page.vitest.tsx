import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { getAllowance } from "../lib/api";
import { AllowancePage } from "./allowance-page";

vi.mock("../lib/api", () => ({
  getAllowance: vi.fn(),
}));

function mockViewport(narrow: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(max-width: 640px)" ? narrow : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe("Allowance calculation notes", () => {
  beforeEach(() => {
    vi.mocked(getAllowance).mockResolvedValue({ span: "7", days: 7, estimates: [] });
  });

  test("puts the explanation in a collapsed details element on a narrow screen", async () => {
    mockViewport(true);
    render(<AllowancePage providers={[]} refreshToken={0} />);

    const summary = await screen.findByText("How This Is Calculated");
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("Estimated allowance divides the tokens used");
    expect(details).toHaveTextContent("Daily totals cannot be split inside a day");
    await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());
  });

  test("keeps the explanation open on a wide screen", async () => {
    mockViewport(false);
    render(<AllowancePage providers={[]} refreshToken={0} />);

    const summary = await screen.findByText("How This Is Calculated");
    expect(summary.closest("details")).toHaveAttribute("open");
    await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());
  });
});

describe("Subscription period", () => {
  beforeEach(() => {
    vi.mocked(getAllowance).mockImplementation(async (range) => {
      if (String(range) === "cycles") {
        return {
          span: "cycles",
          summaries: [
            {
              providerId: "grok",
              windowKey: "weekly",
              windowLabel: "Weekly",
              baseline: {
                tokens: { median: 1_305_000_000, min: 752_000_000, max: 1_688_000_000, n: 3 },
                apiDollars: { median: 411, min: 276, max: 463, n: 3 },
              },
              current: {
                start: "2026-10-04T00:00:00.000Z",
                end: "2026-10-11T00:00:00.000Z",
                lengthMs: 7 * 24 * 60 * 60 * 1000,
                usedPercent: 20,
                tokens: 200,
                apiCost: 4,
                elapsedFraction: 0.5,
                remainingTokens: 800,
                remainingApiCost: 8,
                projectedEndPercent: 40,
                projectionReliable: false,
              },
              cycles: [
                {
                  start: "2026-09-27T00:00:00.000Z",
                  end: "2026-10-04T00:00:00.000Z",
                  lengthMs: 7 * 24 * 60 * 60 * 1000,
                  endPercent: 40,
                  tokensLow: 100,
                  tokensHigh: 165,
                  apiCostLow: 10,
                  apiCostHigh: 16.5,
                  allowanceLow: 250,
                  allowanceHigh: 412.5,
                  apiDollarsLow: 25,
                  apiDollarsHigh: 41.25,
                  included: false,
                  exclusion: "meter-fell",
                },
                {
                  start: "2026-09-20T00:00:00.000Z",
                  end: "2026-09-27T00:00:00.000Z",
                  lengthMs: 7 * 24 * 60 * 60 * 1000,
                  endPercent: 9,
                  tokensLow: 90,
                  tokensHigh: 90,
                  apiCostLow: 1,
                  apiCostHigh: 1,
                  allowanceLow: 1000,
                  allowanceHigh: 1000,
                  apiDollarsLow: 11,
                  apiDollarsHigh: 11,
                  included: false,
                  exclusion: "below-min-percent",
                },
              ],
            },
          ],
        } as never;
      }
      return { span: "7", days: 7, estimates: [] };
    });
  });

  test("shows the baseline, the current cycle, and the exclusion reason", async () => {
    mockViewport(false);
    render(<AllowancePage providers={[]} refreshToken={0} />);
    await waitFor(() => expect(getAllowance).toHaveBeenCalledWith("7"));

    fireEvent.click(screen.getByRole("button", { name: "Subscription Period" }));

    expect(await screen.findByRole("heading", { name: "Baseline" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Current Cycle" })).toBeInTheDocument();
    expect(screen.getAllByText("Meter Fell")).toHaveLength(2);
    expect(screen.getAllByText("Below 10 Percent")).toHaveLength(2);
    expect(screen.getByText("Unreliable")).toBeInTheDocument();
    const details = screen.getByText("How This Is Calculated").closest("details");
    expect(details).toHaveTextContent("last four included periods");
    expect(details).toHaveTextContent("more than an hour before its stated reset");
    expect(details).not.toHaveTextContent("Daily totals cannot be split inside a day");
    expect(getAllowance).toHaveBeenCalledWith("cycles");
  });
});
