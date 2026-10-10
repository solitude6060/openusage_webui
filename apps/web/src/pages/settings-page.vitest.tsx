import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type {
  MultiAccountProviderCapability,
  ProviderAccount,
} from "../../../../packages/core/src/types";
import {
  createProviderAccount,
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
