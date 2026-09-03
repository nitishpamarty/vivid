import type { AcquisitionChannel } from './types.ts';

export function toggleArrMixChannel(current: AcquisitionChannel | 'all', next: AcquisitionChannel): AcquisitionChannel | 'all' {
  return current === next ? 'all' : next;
}

export function arrMixBarWidth(arr: number, maxArr: number): number {
  if (!Number.isFinite(arr) || arr <= 0 || !Number.isFinite(maxArr) || maxArr <= 0) return 0;
  return (arr / maxArr) * 100;
}

export function formatArrValue(arr: number): string {
  return `$${Math.round(arr / 1000)}k`;
}
