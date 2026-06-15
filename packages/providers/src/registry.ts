import { CcusageProvider } from "./providers/ccusage";
import { ManualProvider } from "./providers/manual";
import { MiniMaxProvider } from "./providers/minimax";
import type { UsageProvider } from "./types";

export function getProviders(): UsageProvider[] {
  return [
    new CcusageProvider(),
    new ManualProvider(),
    new MiniMaxProvider(),
  ];
}
