export function shouldApplySessionLoad(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId;
}
