import { describe, expect, test } from "bun:test";
import { isProviderRefreshable, providerCards } from "./provider-ui";

describe("provider UI metadata", () => {
  test("shows GitHub Copilot as an original OpenUsage plugin provider", () => {
    const copilot = providerCards.find((provider) => provider.providerId === "github-copilot");

    expect(copilot).toMatchObject({
      providerId: "github-copilot",
      name: "GitHub Copilot",
      note: "OpenUsage plugin",
    });
    expect(isProviderRefreshable("github-copilot")).toBe(true);
  });
});
