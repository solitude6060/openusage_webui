import { describe, expect, test } from "bun:test";
import { OpenUsagePluginProvider, getProviders } from "../src/index";

describe("provider registry", () => {
  test("registers GitHub Copilot through the original OpenUsage plugin adapter", () => {
    const provider = getProviders().find((item) => item.id === "github-copilot");

    expect(provider).toBeInstanceOf(OpenUsagePluginProvider);
    expect(provider?.name).toBe("GitHub Copilot");
  });
});
