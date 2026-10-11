// Stub so the scan tests fail on the missing behavior. The feat commit replaces this.
export type CodexMeterShape = "weekly-primary" | "five-hour-primary";

export interface CodexEventAccount {
  id: string;
  homePath: string;
  shape: CodexMeterShape | null;
  planType: string | null;
}

export function codexSessionScanRoots(_accounts: Array<{ homePath: string }>): string[] {
  return [];
}

export function meterShapeFromObservations(_rows: unknown[]): CodexMeterShape | null {
  return null;
}

export function scanCodexSessionEvents(_input: unknown): {
  events: never[];
  cursors: never[];
  filesRead: number;
  mapKey: string;
  learnedPlans: never[];
  unmapped: number;
} {
  return { events: [], cursors: [], filesRead: 0, mapKey: "", learnedPlans: [], unmapped: 0 };
}
