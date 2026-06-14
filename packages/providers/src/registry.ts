import { CcusageProvider } from "./providers/ccusage";
import { ManualProvider } from "./providers/manual";
import { MiniMaxManualProvider } from "./providers/minimax-manual";
import type { UsageProvider } from "./types";

export function getProviders(): UsageProvider[] {
  return [
    new CcusageProvider(),
    new ManualProvider(),
    new MiniMaxManualProvider(),
  ];
}
