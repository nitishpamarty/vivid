export function formatTopAccountArr(arr: number): string {
  return `$${Math.round(arr / 1000)}k`;
}

export function topAccountsBarWidth(arr: number, maxArr: number): number {
  if (!Number.isFinite(arr) || arr <= 0 || !Number.isFinite(maxArr) || maxArr <= 0) return 0;
  return (arr / maxArr) * 100;
}

export function toggleTopAccount(current: string | 'all', next: string): string | 'all' {
  return current === next ? 'all' : next;
}
