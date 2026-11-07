import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { getAllowance, type AllowanceCycleSummary, type AllowanceEstimate } from "../lib/api";
import { formatApiMoney, formatDate } from "../lib/format";
import { AllowancePage } from "./allowance-page";
import { formatCompactTokenCount } from "./tokens-page";

vi.mock("../lib/api", () => ({
  getAllowance: vi.fn(),
  updateProviderSettings: vi.fn(),
}));

const DAY_MS = 24 * 60 * 60 * 1000;
const NOV = "2026-11-01T00:00:00.000Z";
const DEC = "2026-12-01T00:00:00.000Z";
const OCT = "2026-10-01T00:00:00.000Z";

function wideViewport() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function current(overrides: Partial<NonNullable<AllowanceCycleSummary["current"]>> = {}) {
  return {
    start: "2026-11-04T00:00:00.000Z",
    end: "2026-11-11T00:00:00.000Z",
    lengthMs: 7 * DAY_MS,
    usedPercent: 23,
    tokens: 0,
    apiCost: null,
    elapsedFraction: 0.5,
    remainingTokens: null,
    remainingApiCost: null,
    projectedEndPercent: 46,
    projectionReliable: true,
    meterFell: false,
    ...overrides,
  };
}

function month(overrides: Record<string, unknown>) {
  return {
    start: NOV,
    end: DEC,
    current: true,
    apiDollars: null,
    tokens: 0,
    tokensFrom: null,
    weeklyParts: [],
    projectedApiDollars: null,
    projectionReliable: false,
    ...overrides,
  };
}

function summary(overrides: Partial<AllowanceCycleSummary> & Pick<AllowanceCycleSummary, "providerId">): AllowanceCycleSummary {
  return {
    windowKey: "weekly",
    windowLabel: "Weekly",
    baseline: { tokens: null, apiDollars: null, dollarsPerPercent: null },
    regimeChanged: false,
    current: current(),
    cycles: [],
    billing: null,
    ...overrides,
  } as AllowanceCycleSummary;
}

function cycle(overrides: Record<string, unknown>) {
  return {
    start: "2026-10-20T00:00:00.000Z",
    end: "2026-10-27T00:00:00.000Z",
    lengthMs: 7 * DAY_MS,
    endPercent: 40,
    consumedPercent: 40,
    segments: [],
    tokensPerPercent: null,
    dollarsPerPercent: null,
    tokensLow: 0,
    tokensHigh: 0,
    apiCostLow: null,
    apiCostHigh: null,
    allowanceLow: null,
    allowanceHigh: null,
    apiDollarsLow: null,
    apiDollarsHigh: null,
    included: false,
    exclusion: "no-tokens",
    ...overrides,
  };
}

function serve(summaries: AllowanceCycleSummary[], estimates: AllowanceEstimate[] = []) {
  vi.mocked(getAllowance).mockImplementation(async (range) =>
    (String(range) === "cycles" ? { span: "cycles", summaries } : { span: "7", days: 7, estimates }) as never);
}

const SUMMARIES = [
  summary({
    providerId: "claude-code",
    billing: {
      anchor: "2026-10-14T04:42:00.000Z",
      anchorSource: "upgrade",
      months: [
        month({
          start: "2026-10-14T04:42:00.000Z",
          end: "2026-11-14T04:42:00.000Z",
          tokens: 20_658_437_239,
          apiDollars: 7180.47,
          projectedApiDollars: 9087.21,
          projectionReliable: true,
        }),
        month({ start: "2026-09-14T04:42:00.000Z", end: "2026-10-14T04:42:00.000Z", current: false, tokens: 9 }),
      ],
    },
    current: current({ usedPercent: 41 }),
  }),
  summary({
    providerId: "codex:codex",
    billing: {
      anchor: null,
      anchorSource: "calendar",
      months: [month({ tokens: 0 }), month({ start: OCT, end: NOV, current: false, tokens: 163_745_997, apiDollars: 186.8 })],
    },
  }),
  summary({
    providerId: "antigravity:local-cli",
    billing: { anchor: null, anchorSource: "calendar", months: [month({}), month({ start: OCT, end: NOV, current: false })] },
    current: current({ usedPercent: 6 }),
  }),
  summary({
    providerId: "grok",
    billing: {
      anchor: "2026-10-05T12:00:00.000Z",
      anchorSource: "setting",
      months: [month({
        start: "2026-11-05T12:00:00.000Z",
        end: "2026-12-05T12:00:00.000Z",
        tokens: 20_448_252,
        apiDollars: 6.01,
        projectedApiDollars: 584,
        projectionReliable: false,
      })],
    },
    current: null,
  }),
  summary({
    providerId: "cursor",
    windowKey: "cursor:total-usage",
    windowLabel: "Total usage",
    current: current({
      start: "2026-10-16T18:06:34.000Z",
      end: "2026-11-16T18:06:34.000Z",
      lengthMs: 31 * DAY_MS,
      usedPercent: 32,
      tokens: 157_457_560,
      apiCost: 113.9,
      elapsedFraction: 0.5,
      projectionReliable: true,
    }),
  }),
  summary({
    providerId: "github-copilot",
    windowKey: "premium",
    windowLabel: "Premium",
    current: current({ start: NOV, end: DEC, lengthMs: 30 * DAY_MS, usedPercent: 0, projectionReliable: false }),
    cycles: [cycle({ tokensLow: 0, tokensHigh: 0 })] as never,
  }),
];

async function summaryRows() {
  const table = await screen.findByRole("table", { name: "This Billing Month" });
  return within(table).getAllByRole("row").slice(1).map((row) =>
    within(row).getAllByRole("cell").map((cell) => cell.textContent));
}

describe("Monthly summary", () => {
  beforeEach(() => {
    vi.mocked(getAllowance).mockReset();
    wideViewport();
  });

  test("lists this billing month for every provider before any range tab is chosen", async () => {
    serve(SUMMARIES);
    render(<AllowancePage providers={[]} refreshToken={0} />);

    const table = await screen.findByRole("table", { name: "This Billing Month" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent))
      .toEqual(["Provider", "Billing Month", "Tokens", "API Value", "Projected Month End", "Meter Now"]);
    const rows = await summaryRows();
    expect(rows).toHaveLength(6);
    const [claude, codex, antigravity, grok, cursor, copilot] = rows;
    expect(claude).toEqual([
      "Claude Code",
      `${formatDate("2026-10-14T04:42:00.000Z")} – ${formatDate("2026-11-14T04:42:00.000Z")}Detected Upgrade`,
      formatCompactTokenCount(20_658_437_239),
      formatApiMoney(7180.47),
      formatApiMoney(9087.21),
      "41% Weekly",
    ]);
    // A zero month is still a measured month when other months have tokens.
    expect(codex![1]).toBe(`${formatDate(NOV)} – ${formatDate(DEC)}Calendar Month`);
    expect(codex![2]).toBe("0");
    expect(codex![3]).toBe("—");
    expect(antigravity![2]).toBe("No Local Token History");
    expect(grok![1]).toContain("Billing Date Set");
    expect(grok![4]).toBe("—");
    expect(grok![5]).toBe("—");
    expect(cursor).toEqual([
      "Cursor",
      `${formatDate("2026-10-16T18:06:34.000Z")} – ${formatDate("2026-11-16T18:06:34.000Z")}Provider Monthly Window`,
      formatCompactTokenCount(157_457_560),
      formatApiMoney(113.9),
      formatApiMoney(227.8),
      "32% Total usage",
    ]);
    expect(copilot![2]).toBe("No Local Token History");
    expect(copilot![4]).toBe("—");
    expect(screen.getByText("API value is what these tokens would cost at API list prices.")).toBeInTheDocument();
    expect(getAllowance).toHaveBeenCalledWith("cycles");
  });

  test("says why a shared-log account has no billing month", async () => {
    serve([summary({ providerId: "codex:family", billing: null })]);
    render(<AllowancePage providers={[]} refreshToken={0} />);

    const [row] = await summaryRows();
    expect(row![1]).toBe("—");
    expect(row![2]).toBe("Shares Another Account's Session Log");
  });

  test("keeps the range tabs and cycle tables in a collapsed Details section", async () => {
    serve(SUMMARIES);
    render(<AllowancePage providers={[]} refreshToken={0} />);
    await screen.findByRole("table", { name: "This Billing Month" });

    const details = screen.getByText("Details", { selector: "summary" }).closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(within(details).getByRole("group", { name: "Time Range" })).toBeInTheDocument();
    expect(within(details).getByText("How This Is Calculated")).toBeInTheDocument();
    fireEvent.click(within(details).getByRole("button", { name: "Subscription Period" }));
    expect(await within(details).findAllByRole("heading", { name: "Billing Months" })).not.toHaveLength(0);
  });
});

describe("Percent display", () => {
  beforeEach(() => {
    vi.mocked(getAllowance).mockReset();
    wideViewport();
  });

  test("lists each segment's climb instead of a sum above 100", async () => {
    serve([summary({
      providerId: "claude",
      cycles: [cycle({
        consumedPercent: 185,
        exclusion: null,
        included: true,
        segments: [
          { start: "2026-10-20T00:00:00.000Z", end: "2026-10-23T00:00:00.000Z", startPercent: 0, endPercent: 96, tokens: 1, apiCost: null, tokensPerPercent: null, dollarsPerPercent: null },
          { start: "2026-10-23T01:00:00.000Z", end: "2026-10-27T00:00:00.000Z", startPercent: 2, endPercent: 91, tokens: 1, apiCost: null, tokensPerPercent: null, dollarsPerPercent: null },
        ],
      })] as never,
    })]);
    render(<AllowancePage providers={[]} refreshToken={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Subscription Period" }));

    expect(await screen.findAllByText("96% + 89% · Meter Reset Mid-Week")).toHaveLength(2);
    expect(screen.queryByText(/185%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Segments/)).not.toBeInTheDocument();
  });

  test("the billing month table has no weekly used column", async () => {
    serve([summary({
      providerId: "claude",
      billing: { anchor: null, anchorSource: "calendar", months: [month({
        tokens: 10,
        weeklyParts: [{ from: NOV, to: "2026-11-08T00:00:00.000Z", consumedPercent: 150, availablePercent: 100 }],
      })] },
    })]);
    render(<AllowancePage providers={[]} refreshToken={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Subscription Period" }));

    const block = (await screen.findByRole("heading", { name: "Billing Months" })).closest("section")!;
    expect(within(block).getAllByRole("columnheader").map((cell) => cell.textContent))
      .toEqual(["Month", "API Dollars", "Tokens"]);
    expect(screen.queryByText(/150%/)).not.toBeInTheDocument();
  });
});

describe("Reason text", () => {
  beforeEach(() => {
    vi.mocked(getAllowance).mockReset();
    wideViewport();
  });

  test("each cycle exclusion reads as one plain sentence", async () => {
    const reasons = {
      "meter-fell": "The meter dropped before its stated reset time, so this span is not used for estimates.",
      "shared-log": "This account shares its session log with another account, so its tokens cannot be told apart and this span is not used for estimates.",
      "history-truncated": "This span starts before the oldest stored record, so part of its usage is missing and it is not used for estimates.",
      "no-tokens": "No token records fall inside this span, so it is not used for estimates.",
      "below-min-percent": "The meter climbed less than 10 points, too little to measure, so this span is not used for estimates.",
      "edge-uncertain": "More than a quarter of the usage crosses this span's start or end, so it is not used for estimates.",
      "observation-gap": "No meter reading arrived in the last day before this span ended, so it is not used for estimates.",
      "segment-unmeasured": "Part of this span climbed 5 points or more with no tokens recorded, so it is not used for estimates.",
    };
    serve([summary({
      providerId: "claude",
      current: current({ meterFell: true, projectionReliable: false }),
      cycles: Object.keys(reasons).map((exclusion, index) =>
        cycle({ exclusion, start: `2026-10-${String(10 + index).padStart(2, "0")}T00:00:00.000Z` })) as never,
    })]);
    render(<AllowancePage providers={[]} refreshToken={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Subscription Period" }));

    for (const sentence of Object.values(reasons)) {
      expect(await screen.findAllByText(sentence)).toHaveLength(2);
    }
    expect(screen.queryByText("Meter Fell")).not.toBeInTheDocument();
    const block = screen.getByRole("heading", { name: "Current Cycle" }).closest("section")!;
    expect(block.querySelector(".allowance-figure")).not.toHaveTextContent("dropped");
    expect(within(block).getByText(
      "The meter dropped during this cycle before its stated reset time, so the projection is unreliable.",
    )).toBeInTheDocument();
  });

  test("a range card without an estimate states its reason as a sentence", async () => {
    const base = {
      providerId: "antigravity:local-cli",
      windowKey: "weekly",
      windowLabel: "Weekly",
      resetsAt: null,
      percentStart: 2,
      percentEnd: 6,
      tokens: 0,
      estimatedAllowance: null,
      apiCost: null,
      estimatedApiCost: null,
      coarse: false,
      statedLimit: null,
      statedLimitUnit: null,
      models: [],
    };
    const reasons = {
      "meter-fell": "The meter dropped before its stated reset time, so this span is not used for estimates.",
      "shared-log": "This account shares its session log with another account, so its tokens cannot be told apart and this span is not used for estimates.",
      "no-movement": "The meter did not move in this span, so there is nothing to divide the tokens by.",
      "no-tokens": "No token records fall inside this span, so it is not used for estimates.",
      unaligned: "Daily usage totals cannot be lined up with the meter readings in this span, so it has no estimate.",
    };
    serve([], Object.keys(reasons).map((reason, index) => ({
      ...base,
      from: `2026-11-0${index + 1}T00:00:00.000Z`,
      to: `2026-11-0${index + 2}T00:00:00.000Z`,
      reason,
    })) as AllowanceEstimate[]);
    render(<AllowancePage providers={[]} refreshToken={0} />);

    for (const sentence of Object.values(reasons)) {
      expect(await screen.findByText(sentence)).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());
  });
});

describe("S2 follow-ups", () => {
  beforeEach(() => {
    vi.mocked(getAllowance).mockReset();
    wideViewport();
  });

  test("a projected end above 100 reads as running out before the reset", async () => {
    serve([
      summary({ providerId: "codex:codex", current: current({ projectedEndPercent: 153.4, projectionReliable: false }) }),
      summary({ providerId: "grok", current: current({ projectedEndPercent: 100 }) }),
    ]);
    render(<AllowancePage providers={[]} refreshToken={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Subscription Period" }));

    const blocks = (await screen.findAllByRole("heading", { name: "Current Cycle" })).map((heading) => heading.closest("section")!);
    expect(blocks[0]).toHaveTextContent("Projected End Runs Out Before Reset At This Pace");
    expect(blocks[0]).not.toHaveTextContent("153");
    expect(blocks[1]).toHaveTextContent("Projected End 100%");
  });

  test("a rough estimate is secondary text, not a headline", async () => {
    const base = {
      windowKey: "weekly",
      windowLabel: "Weekly",
      to: "2026-11-02T00:00:00.000Z",
      resetsAt: null,
      tokens: 19_900_000,
      apiCost: 5.84,
      statedLimit: null,
      statedLimitUnit: null,
      models: [],
      reason: "ok",
    };
    serve([], [
      { ...base, providerId: "grok", from: "2026-11-01T00:00:00.000Z", percentStart: 0, percentEnd: 1, estimatedAllowance: 1_990_000_000, estimatedApiCost: 584, coarse: true },
      { ...base, providerId: "claude-code", from: "2026-11-01T01:00:00.000Z", percentStart: 0, percentEnd: 20, estimatedAllowance: 99_500_000, estimatedApiCost: 29.2, coarse: false },
    ] as AllowanceEstimate[]);
    const { container } = render(<AllowancePage providers={[]} refreshToken={0} />);

    const rough = await screen.findByText(/The meter moved too little for a reliable estimate/);
    expect(rough).toHaveClass("allowance-meta");
    expect(rough).toHaveTextContent(formatCompactTokenCount(1_990_000_000));
    expect(rough).toHaveTextContent(formatApiMoney(584));
    const figures = [...container.querySelectorAll(".allowance-figure, .allowance-api")].map((node) => node.textContent);
    expect(figures.join(" ")).not.toContain(formatCompactTokenCount(1_990_000_000));
    expect(figures.join(" ")).not.toContain(formatApiMoney(584));
    expect(figures.join(" ")).toContain(formatCompactTokenCount(99_500_000));
    expect(figures.join(" ")).toContain(formatApiMoney(29.2));
    expect(screen.queryByText(/Rough Estimate/)).not.toBeInTheDocument();
  });
});
