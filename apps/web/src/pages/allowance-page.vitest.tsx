import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { getAllowance, type AllowanceEstimate } from "../lib/api";
import { formatMoney } from "../lib/format";
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

function estimate(overrides: Partial<AllowanceEstimate> & Pick<AllowanceEstimate, "providerId" | "statedLimit" | "statedLimitUnit">): AllowanceEstimate {
  return {
    windowKey: "weekly",
    windowLabel: "Weekly",
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-10-08T00:00:00.000Z",
    resetsAt: null,
    percentStart: 10,
    percentEnd: 20,
    tokens: 1000,
    estimatedAllowance: 10000,
    apiCost: null,
    estimatedApiCost: null,
    coarse: false,
    models: [],
    reason: "ok",
    ...overrides,
  };
}

describe("Allowance stated cap label", () => {
  test("labels a Cursor dollar limit apart from the combined pool estimate", async () => {
    mockViewport(false);
    vi.mocked(getAllowance).mockResolvedValue({
      span: "7",
      days: 7,
      estimates: [
        estimate({
          providerId: "cursor",
          windowKey: "cursor:total-usage",
          windowLabel: "Total usage",
          statedLimit: 400,
          statedLimitUnit: "usd",
        }),
        estimate({
          providerId: "codex",
          statedLimit: 50,
          statedLimitUnit: "usd",
        }),
      ],
    });
    render(<AllowancePage providers={[]} refreshToken={0} />);

    const cursorLimit = await screen.findByText(new RegExp(`Included Dollar Limit ${escapeRegExp(formatMoney(400))}`));
    expect(cursorLimit).not.toHaveTextContent("Stated Cap");
    expect(screen.getByText("When Cursor reports its combined pool percent, that percent has a different denominator from this dollar limit. Team plans, and plans without that percent, use spend divided by this limit.")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Stated Cap ${escapeRegExp(formatMoney(50))}`))).toBeInTheDocument();
    expect(screen.getAllByText(/Included Dollar Limit/)).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());
  });

  test("labels a named Cursor account the same way as the base provider", async () => {
    mockViewport(false);
    vi.mocked(getAllowance).mockResolvedValue({
      span: "7",
      days: 7,
      estimates: [
        estimate({
          providerId: "cursor:work",
          windowKey: "cursor:total-usage",
          windowLabel: "Total usage",
          statedLimit: 400,
          statedLimitUnit: "usd",
        }),
      ],
    });
    render(<AllowancePage providers={[]} refreshToken={0} />);

    const cursorLimit = await screen.findByText(new RegExp(`Included Dollar Limit ${escapeRegExp(formatMoney(400))}`));
    expect(cursorLimit).not.toHaveTextContent("Stated Cap");
    expect(screen.getByText("When Cursor reports its combined pool percent, that percent has a different denominator from this dollar limit. Team plans, and plans without that percent, use spend divided by this limit.")).toBeInTheDocument();
    expect(screen.queryByText(/Stated Cap/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
                dollarsPerPercent: { median: 4.11, min: 2.76, max: 4.63, n: 3 },
              },
              regimeChanged: true,
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
                meterFell: true,
              },
              cycles: [
                {
                  start: "2026-10-10T19:00:00.000Z",
                  end: "2026-10-17T19:00:00.000Z",
                  lengthMs: 7 * 24 * 60 * 60 * 1000,
                  endPercent: 96,
                  consumedPercent: 190,
                  segments: [
                    {
                      start: "2026-10-10T19:00:00.000Z",
                      end: "2026-10-14T04:22:00.000Z",
                      startPercent: 0,
                      endPercent: 96,
                      tokens: 9600,
                      apiCost: 96,
                      tokensPerPercent: 100,
                      dollarsPerPercent: 1,
                    },
                    {
                      start: "2026-10-14T04:42:00.000Z",
                      end: "2026-10-17T19:00:00.000Z",
                      startPercent: 1,
                      endPercent: 95,
                      tokens: 9400,
                      apiCost: 188,
                      tokensPerPercent: 100,
                      dollarsPerPercent: 2,
                    },
                  ],
                  tokensPerPercent: 100,
                  dollarsPerPercent: 1.5,
                  tokensLow: 19000,
                  tokensHigh: 19000,
                  apiCostLow: 284,
                  apiCostHigh: 284,
                  allowanceLow: 10000,
                  allowanceHigh: 10000,
                  apiDollarsLow: 150,
                  apiDollarsHigh: 150,
                  included: true,
                  exclusion: null,
                },
                {
                  start: "2026-09-27T00:00:00.000Z",
                  end: "2026-10-04T00:00:00.000Z",
                  lengthMs: 7 * 24 * 60 * 60 * 1000,
                  endPercent: 40,
                  consumedPercent: 40,
                  segments: [],
                  tokensPerPercent: 2.5,
                  dollarsPerPercent: 0.25,
                  tokensLow: 100,
                  tokensHigh: 165,
                  apiCostLow: 10,
                  apiCostHigh: 16.5,
                  allowanceLow: 250,
                  allowanceHigh: 412.5,
                  apiDollarsLow: 4,
                  apiDollarsHigh: null,
                  included: false,
                  exclusion: "meter-fell",
                },
                {
                  start: "2026-09-20T00:00:00.000Z",
                  end: "2026-09-27T00:00:00.000Z",
                  lengthMs: 7 * 24 * 60 * 60 * 1000,
                  endPercent: 9,
                  consumedPercent: 9,
                  segments: [],
                  tokensPerPercent: 10,
                  dollarsPerPercent: 0.11,
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
    expect(screen.getAllByText("Meter Fell")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "Current Cycle" }).closest("section")).toHaveTextContent("Meter Fell");
    expect(screen.getAllByText("Below 10 Percent")).toHaveLength(2);
    expect(screen.getAllByText("$4.00–Unknown")).toHaveLength(2);
    expect(screen.getAllByText("$11.00")).toHaveLength(2);
    expect(screen.getByText("Unreliable")).toBeInTheDocument();
    expect(screen.getAllByText("190% · 2 Segments")).toHaveLength(2);
    expect(screen.getAllByText("Consumed").length).toBeGreaterThan(0);
    expect(screen.queryByText("End Percent")).not.toBeInTheDocument();
    expect(screen.getByText("API Dollars Per Percent $4.11 median · $2.76–$4.63 · n 3")).toBeInTheDocument();
    expect(screen.getByText("Rate Changed At A Mid-Period Reset · Baseline Uses Only The Newer Side")).toBeInTheDocument();
    const details = screen.getByText("How This Is Calculated").closest("details");
    expect(details).toHaveTextContent("last four included periods");
    expect(details).toHaveTextContent("That median uses only the usage fully inside each period.");
    expect(details).toHaveTextContent("more than an hour before its stated reset");
    expect(details).toHaveTextContent("the meter fell during this period");
    expect(details).toHaveTextContent("reset in place");
    expect(details).toHaveTextContent("the baseline keeps only the newer side");
    expect(details).not.toHaveTextContent("Daily totals cannot be split inside a day");
    expect(getAllowance).toHaveBeenCalledWith("cycles");
  });
});
