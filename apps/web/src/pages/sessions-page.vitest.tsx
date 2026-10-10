import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { UsageRecord } from "../../../../packages/core/src/types";
import { getUsageRecords } from "../lib/api";
import { formatDate, formatOptionalMoney, formatOptionalNumber } from "../lib/format";
import { SessionsPage } from "./sessions-page";

vi.mock("../lib/api", () => ({
  getUsageRecords: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function record(id: string, model: string): UsageRecord {
  return {
    id,
    providerId: "codex",
    model,
    startedAt: "2026-10-10T01:02:03.000Z",
    source: "cli",
  };
}

// One macrotask lets a stale setState land before the assertion.
async function flushSettledUpdate(settle: () => void) {
  await act(async () => {
    settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openTwoLoads() {
  const older = deferred<UsageRecord[]>();
  const newer = deferred<UsageRecord[]>();
  vi.mocked(getUsageRecords)
    .mockImplementationOnce(() => older.promise)
    .mockImplementationOnce(() => newer.promise);
  render(<SessionsPage providers={[]} refreshToken={0} />);
  await waitFor(() => expect(getUsageRecords).toHaveBeenCalledTimes(1));

  fireEvent.change(screen.getByLabelText("Limit"), { target: { value: "25" } });
  await userEvent.setup().click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(getUsageRecords).toHaveBeenCalledTimes(2));
  expect(getUsageRecords).toHaveBeenNthCalledWith(1, {
    providerId: "",
    from: undefined,
    to: undefined,
    limit: 100,
  });
  expect(getUsageRecords).toHaveBeenNthCalledWith(2, {
    providerId: "",
    from: undefined,
    to: undefined,
    limit: 25,
  });
  return { older, newer };
}

describe("Sessions page load generation", () => {
  test("shows the newer records when an older request succeeds later", async () => {
    const { older, newer } = await openTwoLoads();

    await flushSettledUpdate(() => {
      newer.resolve([record("fresh", "fresh-row")]);
    });
    expect(screen.getAllByText("fresh-row").length).toBeGreaterThan(0);

    await flushSettledUpdate(() => {
      older.resolve([record("stale", "stale-row")]);
    });
    expect(screen.getAllByText("fresh-row").length).toBeGreaterThan(0);
    expect(screen.queryByText("stale-row")).not.toBeInTheDocument();
  });

  test("does not show an error from an older request that fails after a newer success", async () => {
    const { older, newer } = await openTwoLoads();

    await flushSettledUpdate(() => {
      newer.resolve([record("fresh", "fresh-row")]);
    });
    expect(screen.getAllByText("fresh-row").length).toBeGreaterThan(0);

    await flushSettledUpdate(() => {
      older.reject(new Error("Stale Filter Failed"));
    });
    expect(screen.queryByText("Stale Filter Failed")).not.toBeInTheDocument();
    expect(screen.getAllByText("fresh-row").length).toBeGreaterThan(0);
  });

  test("shows an error from the latest request", async () => {
    const { older, newer } = await openTwoLoads();

    await flushSettledUpdate(() => {
      newer.reject(new Error("Latest Filter Failed"));
    });
    expect(screen.getByText("Latest Filter Failed")).toBeInTheDocument();

    await flushSettledUpdate(() => {
      older.reject(new Error("Stale Filter Failed"));
    });
    expect(screen.getByText("Latest Filter Failed")).toBeInTheDocument();
    expect(screen.queryByText("Stale Filter Failed")).not.toBeInTheDocument();
  });
});

describe("Sessions narrow record cards", () => {
  test("renders each record as a stacked card with the narrow fields", async () => {
    const startedAt = "2026-10-10T01:02:03.000Z";
    vi.mocked(getUsageRecords).mockResolvedValue([
      {
        id: "row-1",
        providerId: "codex",
        tool: "cli-tool",
        model: "gpt-test",
        totalTokens: 1200,
        costUsd: 0.25,
        startedAt,
        source: "cli",
      },
    ]);

    render(<SessionsPage providers={[]} refreshToken={0} />);

    const list = await screen.findByRole("list", { name: "Session Records" });
    expect(list).toHaveClass("session-cards");
    expect(list).toHaveTextContent("Started At");
    expect(list).toHaveTextContent(formatDate(startedAt));
    expect(list).toHaveTextContent("Provider");
    expect(list).toHaveTextContent("Codex");
    expect(list).toHaveTextContent("Tool");
    expect(list).toHaveTextContent("cli-tool");
    expect(list).toHaveTextContent("Model");
    expect(list).toHaveTextContent("gpt-test");
    expect(list).toHaveTextContent("Tokens");
    expect(list).toHaveTextContent(formatOptionalNumber(1200));
    expect(list).toHaveTextContent("Cost");
    expect(list).toHaveTextContent(formatOptionalMoney(0.25));
  });
});
