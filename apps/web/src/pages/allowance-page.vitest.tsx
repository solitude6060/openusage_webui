import { render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByText("On individual plans the percent is Cursor's combined pool percent; its denominator differs from this dollar limit.")).toBeInTheDocument();
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
    expect(screen.getByText("On individual plans the percent is Cursor's combined pool percent; its denominator differs from this dollar limit.")).toBeInTheDocument();
    expect(screen.queryByText(/Stated Cap/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
