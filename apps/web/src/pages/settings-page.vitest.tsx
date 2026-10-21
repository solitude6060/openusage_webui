import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type {
  MultiAccountProviderCapability,
  ProviderAccount,
} from "../../../../packages/core/src/types";
import {
  createProviderAccount,
  detectProviderAccounts,
  listProviderAccountCapabilities,
  listProviderAccounts,
  updateProviderAccount,
} from "../lib/api";
import { SettingsPage } from "./settings-page";

vi.mock("../lib/api", () => ({
  createManualUsage: vi.fn(),
  createProviderAccount: vi.fn(),
  deleteProviderAccount: vi.fn(),
  detectProviderAccounts: vi.fn(),
  listProviderAccountCapabilities: vi.fn(),
  listProviderAccounts: vi.fn(),
  updateProviderAccount: vi.fn(),
}));

const defaultHomePath = "/home/real-user";

function capability(): MultiAccountProviderCapability {
  return {
    providerId: "antigravity",
    name: "Antigravity",
    homeEnvVar: "OPENUSAGE_ANTIGRAVITY_CLI_HOME",
    homeLabel: "Antigravity Home",
    defaultHomePath,
  };
}

function account(overrides: Partial<ProviderAccount>): ProviderAccount {
  return {
    id: "antigravity:acct1",
    providerId: "antigravity",
    label: "Other",
    homePath: "/home/example/.agy-homes/acct1",
    enabled: true,
    sortOrder: 1,
    ...overrides,
  };
}

function renderSettings(accounts: ProviderAccount[]) {
  vi.mocked(listProviderAccountCapabilities).mockResolvedValue([capability()]);
  vi.mocked(listProviderAccounts).mockResolvedValue(accounts);
  vi.mocked(updateProviderAccount).mockResolvedValue({
    ok: true,
    account: accounts[0] ?? account({}),
  });
  vi.mocked(createProviderAccount).mockImplementation(async (input) => ({
    ok: true,
    account: account({
      id: "antigravity:added",
      label: input.label,
      homePath: input.homePath,
      enabled: input.enabled ?? true,
    }),
  }));
  render(<SettingsPage health={null} onCreated={async () => {}} />);
}

describe("Add Default Account", () => {
  test("enables the disabled default-home account and does not add another", async () => {
    const user = userEvent.setup();
    const disabled = account({
      id: "antigravity:local",
      label: "Local",
      homePath: defaultHomePath,
      enabled: false,
      sortOrder: 0,
    });
    renderSettings([
      disabled,
      account({
        id: "antigravity:acct1",
        homePath: "/home/example/.agy-homes/acct1",
        enabled: true,
      }),
    ]);

    await user.click(await screen.findByRole("button", { name: "Add Default Account" }));

    await waitFor(() => {
      expect({
        enabled: vi.mocked(updateProviderAccount).mock.calls,
        added: vi.mocked(createProviderAccount).mock.calls,
      }).toEqual({
        enabled: [["antigravity:local", { enabled: true }]],
        added: [],
      });
    });
  });

  test("adds Antigravity · Local CLI at ~ when no default account exists", async () => {
    const user = userEvent.setup();
    renderSettings([
      account({
        id: "antigravity:acct1",
        homePath: "/home/example/.agy-homes/acct1",
        enabled: true,
      }),
    ]);

    await user.click(await screen.findByRole("button", { name: "Add Default Account" }));

    await waitFor(() => {
      expect({
        added: vi.mocked(createProviderAccount).mock.calls,
        enabled: vi.mocked(updateProviderAccount).mock.calls,
      }).toEqual({
        added: [
          [
            {
              providerId: "antigravity",
              label: "Antigravity · Local CLI",
              homePath: "~",
            },
          ],
        ],
        enabled: [],
      });
    });
  });
});

describe("Detected Homes", () => {
  test("shows each home's Google account and flags one already tracked", async () => {
    const user = userEvent.setup();
    renderSettings([account({ id: "antigravity:acct1", homePath: "/home/example/.agy-homes/acct1" })]);
    vi.mocked(detectProviderAccounts).mockResolvedValue({
      ok: true,
      providerId: "antigravity",
      candidates: [
        { providerId: "antigravity", homePath: "/home/example/.agy-homes/acct1", label: "Antigravity · acct1", hasAuth: true, email: "one@example.com" },
        { providerId: "antigravity", homePath: "/home/example/.config/Antigravity", label: "Antigravity · Local", hasAuth: true, email: "one@example.com" },
        { providerId: "antigravity", homePath: "/home/example", label: "Antigravity · Local CLI", hasAuth: true, email: "two@example.com" },
      ],
    });

    await user.click(await screen.findByRole("button", { name: "Detect Homes" }));

    const ide = (await screen.findByText("/home/example/.config/Antigravity")).closest("li")!;
    expect(ide.textContent).toContain("one@example.com");
    expect(ide.textContent).toContain("Same Google account as Other");
    const cli = screen.getByText("/home/example").closest("li")!;
    expect(cli.textContent).toContain("two@example.com");
    expect(cli.textContent).not.toContain("Same Google account");
  });
});
