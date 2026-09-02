export type SharedStatus = 'connecting' | 'ready' | 'unavailable';

export function shouldApplyVersion(currentVersion: number, incomingVersion: number): boolean {
  return Number.isSafeInteger(incomingVersion) && incomingVersion >= currentVersion;
}

export function mutationBlockReason(status: SharedStatus): 'not_ready' | 'unavailable' | null {
  if (status === 'connecting') return 'not_ready';
  if (status === 'unavailable') return 'unavailable';
  return null;
}
