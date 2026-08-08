import { describe, expect, test } from "bun:test";
import { splitDashboardLines } from "./pages/dashboard-page";

describe("Dashboard line grouping", () => {
  test("keeps Fable weekly usage in the card summary", () => {
    const result = splitDashboardLines([
      { type: "progress", label: "Session", used: 3, limit: 100, format: { kind: "percent" } },
      { type: "progress", label: "Weekly", used: 38, limit: 100, format: { kind: "percent" } },
      { type: "progress", label: "Fable Weekly", used: 11, limit: 100, format: { kind: "percent" } },
      { type: "text", label: "Today", value: "$255.45 · 111M tokens" },
      { type: "barChart", label: "Usage Trend", points: [] },
      { type: "text", label: "claude-fable-5", value: "8.1%" },
      { type: "text", label: "Last 30 Days", value: "$3330.76 · 3.1B tokens" },
    ]);

    expect(result.summaryLines.map((line) => line.label)).toEqual([
      "Session",
      "Weekly",
      "Fable Weekly",
      "Today",
    ]);
    expect(result.detailLines.map((line) => line.label)).toEqual([
      "Usage Trend",
      "claude-fable-5",
      "Last 30 Days",
    ]);
  });

  test("hides Codex reset credits and model details", () => {
    const result = splitDashboardLines([
      { type: "progress", label: "Session", used: 32, limit: 100, format: { kind: "percent" } },
      { type: "progress", label: "Weekly", used: 69, limit: 100, format: { kind: "percent" } },
      { type: "progress", label: "Spark", used: 3, limit: 100, format: { kind: "percent" } },
      { type: "progress", label: "Spark Weekly", used: 1, limit: 100, format: { kind: "percent" } },
      { type: "text", label: "Rate Limit Resets", value: "4 available" },
      { type: "text", label: "Credits", value: "$0.00 · 0 credits" },
      { type: "badge", label: "Reset Credit", tone: "normal" },
      { type: "text", label: "Today", value: "$10.45 · 14M tokens" },
      { type: "text", label: "gpt-5.5", value: "93%" },
    ]);

    expect(result.summaryLines.map((line) => line.label)).toEqual([
      "Session",
      "Weekly",
      "Today",
    ]);
    expect(result.detailLines.map((line) => line.label)).toEqual([
      "Spark",
      "Spark Weekly",
      "Rate Limit Resets",
      "Credits",
      "Reset Credit",
      "gpt-5.5",
    ]);
  });

  test("does not promote low-priority details when no summary label matches", () => {
    const result = splitDashboardLines([
      { type: "text", label: "Credits", value: "$0.00 · 0 credits" },
      { type: "text", label: "Rate Limit Resets", value: "4 available" },
      { type: "text", label: "Last 30 Days", value: "$10.00 · 1M tokens" },
      { type: "barChart", label: "Usage Trend", points: [] },
    ]);

    expect(result.summaryLines).toEqual([]);
    expect(result.detailLines.map((line) => line.label)).toEqual([
      "Credits",
      "Rate Limit Resets",
      "Last 30 Days",
      "Usage Trend",
    ]);
  });

  test("leaves sparse providers uncollapsed", () => {
    const lines = [
      { type: "text", label: "Status", value: "No Usage Data" },
      { type: "badge", label: "Detected", text: "Yes" },
    ];

    expect(splitDashboardLines(lines)).toEqual({
      summaryLines: lines,
      detailLines: [],
    });
  });

  test("keeps Cursor overview metrics in the card summary", () => {
    const result = splitDashboardLines([
      { type: "progress", label: "Credits", used: 10, limit: 100, format: { kind: "dollars" } },
      { type: "progress", label: "Total usage", used: 42, limit: 100, format: { kind: "percent" } },
      { type: "progress", label: "Auto usage", used: 5, limit: 100, format: { kind: "percent" } },
      { type: "progress", label: "API usage", used: 20, limit: 100, format: { kind: "percent" } },
      { type: "text", label: "Last 7 Days", value: "$3.50 · 2 calls" },
      { type: "text", label: "claude-4.6-opus-high-thinking", value: "$2.50 · 1 calls" },
      { type: "barChart", label: "Last 7 Days Cost", points: [{ label: "7/1", value: 1 }] },
    ]);

    expect(result.summaryLines.map((line) => line.label)).toEqual([
      "Credits",
      "Total usage",
    ]);
    expect(result.detailLines.map((line) => line.label)).toEqual([
      "Auto usage",
      "API usage",
      "Last 7 Days",
      "claude-4.6-opus-high-thinking",
      "Last 7 Days Cost",
    ]);
  });

  test("keeps Antigravity Account badge in the card summary", () => {
    const result = splitDashboardLines([
      { type: "badge", label: "Account", text: "user@example.com" },
      { type: "progress", label: "Gemini Pro", used: 10, limit: 100, format: { kind: "percent" } },
      { type: "progress", label: "Gemini Flash", used: 20, limit: 100, format: { kind: "percent" } },
      { type: "progress", label: "Claude", used: 30, limit: 100, format: { kind: "percent" } },
      { type: "progress", label: "Other Model", used: 5, limit: 100, format: { kind: "percent" } },
    ]);

    expect(result.summaryLines.map((line) => line.label)).toEqual(["Account", "Gemini Pro"]);
    expect(result.detailLines.map((line) => line.label)).toEqual([
      "Gemini Flash",
      "Claude",
      "Other Model",
    ]);
  });

  test("promotes first progress line when summary is empty but details have progress", () => {
    const result = splitDashboardLines([
      { type: "text", label: "Credits", value: "$0.00" },
      { type: "text", label: "Rate Limit Resets", value: "4 available" },
      { type: "progress", label: "Custom Quota", used: 50, limit: 100, format: { kind: "percent" } },
      { type: "progress", label: "Another Quota", used: 30, limit: 100, format: { kind: "percent" } },
    ]);

    expect(result.summaryLines.map((line) => line.label)).toEqual(["Custom Quota"]);
    expect(result.detailLines.map((line) => line.label)).toEqual([
      "Credits",
      "Rate Limit Resets",
      "Another Quota",
    ]);
  });

  test("promotes first progress line when summary has badges but no progress", () => {
    const result = splitDashboardLines([
      { type: "badge", label: "Account", text: "user@example.com" },
      { type: "badge", label: "Status", text: "Active" },
      { type: "progress", label: "Custom Quota", used: 50, limit: 100, format: { kind: "percent" } },
      { type: "progress", label: "Another Quota", used: 30, limit: 100, format: { kind: "percent" } },
    ]);

    expect(result.summaryLines.map((line) => line.label)).toEqual(["Account", "Status", "Custom Quota"]);
    expect(result.detailLines.map((line) => line.label)).toEqual(["Another Quota"]);
  });
});
