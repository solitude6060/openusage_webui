import { describe, expect, test } from "bun:test";
import {
  defaultHomeCandidates,
  initialAccountProviderId,
  shouldShowDefaultAccountNotice,
} from "./default-account";

const homes = ["~", "/home/example"];

describe("default account notice", () => {
  test("shows when an enabled Antigravity account is not the default home", () => {
    expect(
      shouldShowDefaultAccountNotice(
        "antigravity",
        [{ homePath: "/home/example/.agy-homes/acct1", enabled: true }],
        homes,
      ),
    ).toBe(true);
  });

  test("hides when an enabled account is the default home", () => {
    expect(
      shouldShowDefaultAccountNotice(
        "antigravity",
        [
          { homePath: "/home/example/.agy-homes/acct1", enabled: true },
          { homePath: "/home/example/", enabled: true },
        ],
        homes,
      ),
    ).toBe(false);
    expect(
      shouldShowDefaultAccountNotice(
        "antigravity",
        [{ homePath: "~", enabled: true }],
        homes,
      ),
    ).toBe(false);
  });

  test("hides when the default home is only disabled or no account is enabled", () => {
    expect(
      shouldShowDefaultAccountNotice(
        "antigravity",
        [
          { homePath: "/home/example", enabled: false },
          { homePath: "/home/example/.agy-homes/acct1", enabled: true },
        ],
        homes,
      ),
    ).toBe(true);
    expect(
      shouldShowDefaultAccountNotice(
        "antigravity",
        [{ homePath: "/home/example/.agy-homes/acct1", enabled: false }],
        homes,
      ),
    ).toBe(false);
  });

  test("does not apply the Antigravity home rule to other providers", () => {
    expect(
      shouldShowDefaultAccountNotice(
        "codex",
        [{ homePath: "/home/example/.codex-family", enabled: true }],
        homes,
      ),
    ).toBe(false);
  });

  test("reads the default home from the standard database path", () => {
    expect(defaultHomeCandidates("/home/example/.openusage-webui/openusage.sqlite")).toEqual([
      "~",
      "/home/example",
    ]);
  });
});

describe("provider account selector", () => {
  test("defaults to the first provider that has accounts", () => {
    expect(
      initialAccountProviderId(
        [{ providerId: "codex" }, { providerId: "claude-code" }, { providerId: "antigravity" }],
        [{ providerId: "antigravity" }, { providerId: "claude-code" }],
      ),
    ).toBe("claude-code");
    expect(
      initialAccountProviderId(
        [{ providerId: "codex" }, { providerId: "antigravity" }],
        [],
      ),
    ).toBe("codex");
  });
});
