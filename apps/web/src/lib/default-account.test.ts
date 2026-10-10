import { describe, expect, test } from "bun:test";
import {
  disabledDefaultAccount,
  initialAccountProviderId,
  shouldShowDefaultAccountNotice,
} from "./default-account";

const defaultHomePath = "/home/real-user";

describe("default account notice", () => {
  test("shows when Antigravity has an enabled non-default account and the selected provider is Codex", () => {
    const selectedProviderId = "codex";
    const accounts = [
      { providerId: "codex", homePath: "/tmp/codex", enabled: true },
      { providerId: "antigravity", homePath: "/home/example/.agy-homes/acct1", enabled: true },
    ];
    const selectedAccounts = accounts.filter((account) => account.providerId === selectedProviderId);
    expect(selectedAccounts).toEqual([
      { providerId: "codex", homePath: "/tmp/codex", enabled: true },
    ]);
    expect(shouldShowDefaultAccountNotice(accounts, defaultHomePath)).toBe(true);
  });

  test("hides when an enabled account home equals defaultHomePath", () => {
    expect(
      shouldShowDefaultAccountNotice(
        [
          { providerId: "codex", homePath: "/tmp/codex", enabled: true },
          { providerId: "antigravity", homePath: `${defaultHomePath}/`, enabled: true },
          { providerId: "antigravity", homePath: "/home/example/.agy-homes/acct1", enabled: true },
        ],
        defaultHomePath,
      ),
    ).toBe(false);
  });

  test("hides when an enabled account home is ~", () => {
    expect(
      shouldShowDefaultAccountNotice(
        [{ providerId: "antigravity", homePath: "~", enabled: true }],
        defaultHomePath,
      ),
    ).toBe(false);
  });

  test("shows when the matching home is disabled and another Antigravity account is enabled", () => {
    expect(
      shouldShowDefaultAccountNotice(
        [
          { providerId: "antigravity", homePath: defaultHomePath, enabled: false },
          { providerId: "antigravity", homePath: "/home/example/.agy-homes/acct1", enabled: true },
        ],
        defaultHomePath,
      ),
    ).toBe(true);
  });

  test("hides when no Antigravity account is enabled", () => {
    expect(
      shouldShowDefaultAccountNotice(
        [
          { providerId: "codex", homePath: "/tmp/codex", enabled: true },
          { providerId: "antigravity", homePath: "/home/example/.agy-homes/acct1", enabled: false },
        ],
        defaultHomePath,
      ),
    ).toBe(false);
    expect(shouldShowDefaultAccountNotice([], defaultHomePath)).toBe(false);
  });

  test("does not treat a database directory as the default home", () => {
    expect(
      shouldShowDefaultAccountNotice(
        [{ providerId: "antigravity", homePath: "/home/example", enabled: true }],
        defaultHomePath,
      ),
    ).toBe(true);
  });
});

describe("disabled default account", () => {
  const spare = {
    id: "antigravity:acct1",
    providerId: "antigravity",
    homePath: "/home/example/.agy-homes/acct1",
    enabled: true,
  };

  test("returns a disabled Antigravity account whose home is ~", () => {
    const disabled = {
      id: "antigravity:local",
      providerId: "antigravity",
      homePath: "~",
      enabled: false,
    };
    expect(disabledDefaultAccount([spare, disabled], defaultHomePath)).toEqual(disabled);
  });

  test("returns a disabled account whose home matches defaultHomePath", () => {
    const disabled = {
      id: "antigravity:local",
      providerId: "antigravity",
      homePath: `${defaultHomePath}/`,
      enabled: false,
    };
    expect(disabledDefaultAccount([disabled, spare], defaultHomePath)).toEqual(disabled);
  });

  test("returns null when the default home account is already enabled", () => {
    expect(
      disabledDefaultAccount(
        [{ ...spare, id: "antigravity:local", homePath: defaultHomePath, enabled: true }],
        defaultHomePath,
      ),
    ).toBeNull();
  });

  test("returns null when no disabled account points at the default home", () => {
    expect(
      disabledDefaultAccount(
        [
          spare,
          {
            id: "codex:local",
            providerId: "codex",
            homePath: "~",
            enabled: false,
          },
        ],
        defaultHomePath,
      ),
    ).toBeNull();
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
