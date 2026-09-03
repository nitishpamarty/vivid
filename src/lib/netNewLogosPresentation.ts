import type { Region } from './types.ts';

export const NET_NEW_LOGO_REGIONS: Region[] = ['NA', 'EMEA', 'APAC', 'LATAM'];

export function toggleNetNewLogosRegion(current: Region | 'all', next: Region): Region | 'all' {
  return current === next ? 'all' : next;
}

export function netNewLogosByRegionTotals(byRegion: Record<Region, number[]>): Record<Region, number> {
  return Object.fromEntries(
    NET_NEW_LOGO_REGIONS.map((region) => [region, byRegion[region].reduce((total, value) => total + value, 0)]),
  ) as Record<Region, number>;
}

export function netNewLogosBarWidth(value: number, maxAbs: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maxAbs) || maxAbs <= 0) return 0;
  return Math.min(50, (Math.abs(value) / maxAbs) * 50);
}

export function formatNetNewLogos(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}
