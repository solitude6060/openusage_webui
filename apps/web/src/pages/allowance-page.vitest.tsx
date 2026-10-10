import { render, screen, waitFor } from "@testing-library/react";
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
