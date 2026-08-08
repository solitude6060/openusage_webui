import { describe, expect, test } from "bun:test";
import { MultiAccountProviderId } from "../../../../packages/core/src/types";
import { getManualPlaceholder, MANUAL_PLACEHOLDERS } from "./pages/settings-page";

describe("settings page manual placeholders", () => {
  test("maps each multi-account provider to its label and home path", () => {
    const providers: MultiAccountProviderId[] = ["codex", "claude-code", "cursor", "antigravity"];

    for (const providerId of providers) {
      const placeholder = getManualPlaceholder(providerId);
      expect(placeholder).toEqual(MANUAL_PLACEHOLDERS[providerId]);
    }
  });

  test("falls back to codex placeholder for unknown provider ids", () => {
    const unknown = getManualPlaceholder("unknown" as MultiAccountProviderId);
    expect(unknown).toEqual(MANUAL_PLACEHOLDERS.codex);
  });

  test("placeholder values match expected labels and paths", () => {
    expect(MANUAL_PLACEHOLDERS.codex).toEqual({
      label: "Codex · Family",
      homePath: "~/.codex-family",
    });
    expect(MANUAL_PLACEHOLDERS["claude-code"]).toEqual({
      label: "Claude · Work",
      homePath: "~/.claude-work",
    });
    expect(MANUAL_PLACEHOLDERS.cursor).toEqual({
      label: "Cursor · Work",
      homePath: "~/.config/cursor-work",
    });
    expect(MANUAL_PLACEHOLDERS.antigravity).toEqual({
      label: "Antigravity · Main",
      homePath: "~/.agy-homes/acct1",
    });
  });
});