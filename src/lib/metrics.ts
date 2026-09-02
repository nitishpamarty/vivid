import type { AcquisitionChannel, NorthbeamData, Region, Segment } from './types';

// All months present in the dataset, sorted ascending (YYYY-MM sorts lexically).
export function monthList(data: NorthbeamData): string[] {
  return [...new Set(data.mrrRows.map((r) => r.month))].sort();
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
}

export function arrByMonth(data: NorthbeamData): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of data.mrrRows) totals.set(r.month, (totals.get(r.month) ?? 0) + r.mrr * 12);
  return totals;
}

export function activeCustomerIds(data: NorthbeamData, month: string): Set<string> {
  const ids = new Set<string>();
  for (const c of data.customers) {
    if (c.signupMonth <= month && (!c.churnMonth || c.churnMonth > month)) ids.add(c.customerId);
  }
  return ids;
}

export function logoChurnPct(data: NorthbeamData, month: string, prevMonth: string): number {
  const prevActive = activeCustomerIds(data, prevMonth);
  const churnedCount = data.customers.filter((c) => c.churnMonth === month).length;
  return prevActive.size === 0 ? 0 : (churnedCount / prevActive.size) * 100;
}

// Trailing-12 cohort NRR: customers active 12 months ago, their MRR then vs now (0 if gone).
export function nrrTrailing12(data: NorthbeamData, month: string, months: string[]): number {
  const idx = months.indexOf(month);
  if (idx < 12) return NaN;
  const baseMonth = months[idx - 12];
  const baseRows = data.mrrRows.filter((r) => r.month === baseMonth);
  const nowByCustomer = new Map<string, number>();
  for (const r of data.mrrRows) if (r.month === month) nowByCustomer.set(r.customerId, r.mrr);
  let base = 0, now = 0;
  for (const r of baseRows) {
    base += r.mrr;
    now += nowByCustomer.get(r.customerId) ?? 0;
  }
  return base === 0 ? NaN : (now / base) * 100;
}

export function arrMixBySegment(data: NorthbeamData, month: string): Record<Segment, number> {
  const mix: Record<Segment, number> = { SMB: 0, 'Mid-Market': 0, Enterprise: 0 };
  const custById = new Map(data.customers.map((c) => [c.customerId, c]));
  for (const r of data.mrrRows) {
    if (r.month !== month) continue;
    const seg = custById.get(r.customerId)?.segment;
    if (seg) mix[seg] += r.mrr * 12;
  }
  return mix;
}

export function arrMixByChannel(data: NorthbeamData, month: string): Record<AcquisitionChannel, number> {
  const mix: Record<AcquisitionChannel, number> = { Paid: 0, Organic: 0, Referral: 0, Partner: 0 };
  const custById = new Map(data.customers.map((c) => [c.customerId, c]));
  for (const r of data.mrrRows) {
    if (r.month !== month) continue;
    const ch = custById.get(r.customerId)?.channel;
    if (ch) mix[ch] += r.mrr * 12;
  }
  return mix;
}

export function topAccounts(data: NorthbeamData, month: string, n = 5) {
  const custById = new Map(data.customers.map((c) => [c.customerId, c]));
  return data.mrrRows
    .filter((r) => r.month === month)
    .map((r) => ({ name: custById.get(r.customerId)?.name ?? r.customerId, arr: r.mrr * 12 }))
    .sort((a, b) => b.arr - a.arr)
    .slice(0, n);
}

// Net-new logos by region for a set of trailing months.
export function netNewLogosByRegion(data: NorthbeamData, months: string[]): Record<Region, number[]> {
  const regions: Region[] = ['NA', 'EMEA', 'APAC', 'LATAM'];
  const result = Object.fromEntries(regions.map((r) => [r, [] as number[]])) as Record<Region, number[]>;
  for (const region of regions) {
    for (const month of months) {
      const newCount = data.customers.filter((c) => c.region === region && c.signupMonth === month).length;
      const churnedCount = data.customers.filter((c) => c.region === region && c.churnMonth === month).length;
      result[region].push(newCount - churnedCount);
    }
  }
  return result;
}

export interface ArrBridgePoint {
  month: string;
  label: string;
  delta: number;
  priorCum: number;
  newCum: number;
  positive: boolean;
}

export function arrBridge(data: NorthbeamData, allMonths: string[], windowSize = 12): ArrBridgePoint[] {
  const totals = arrByMonth(data);
  const startIdx = allMonths.length - windowSize;
  const out: ArrBridgePoint[] = [];
  for (let i = startIdx; i < allMonths.length; i++) {
    const month = allMonths[i];
    const newCum = totals.get(month) ?? 0;
    const priorCum = totals.get(allMonths[i - 1]) ?? 0;
    out.push({ month, label: monthLabel(month), delta: newCum - priorCum, priorCum, newCum, positive: newCum >= priorCum });
  }
  return out;
}

export interface Kpi {
  value: number;
  deltaLabel: string;
  deltaGood: boolean;
  sparkline: number[];
}

export function computeKpis(data: NorthbeamData) {
  const months = monthList(data);
  const latest = months[months.length - 1];
  const totals = arrByMonth(data);
  const latestIdx = months.length - 1;

  const arr = totals.get(latest) ?? 0;
  const arrYearAgo = totals.get(months[latestIdx - 12]) ?? arr;
  const arrGrowthYoY = arrYearAgo === 0 ? 0 : ((arr - arrYearAgo) / arrYearAgo) * 100; // a filter combo can genuinely zero this out
  const arrSpark = months.slice(-8).map((m) => (totals.get(m) ?? 0) / 1_000_000);

  const nrr = nrrTrailing12(data, latest, months);
  const nrrQuarterAgo = nrrTrailing12(data, months[latestIdx - 3], months);
  const nrrSpark = months.slice(-8).map((m) => nrrTrailing12(data, m, months)).filter((v) => !Number.isNaN(v));

  const churn = logoChurnPct(data, latest, months[latestIdx - 1]);
  const churnQuarterAgo = logoChurnPct(data, months[latestIdx - 3], months[latestIdx - 4]);
  const churnSpark: number[] = [];
  for (let i = latestIdx - 7; i <= latestIdx; i++) churnSpark.push(logoChurnPct(data, months[i], months[i - 1]));

  const cacByMonth = new Map(data.cac.map((c) => [c.month, c.cac]));
  const cac = cacByMonth.get(latest) ?? 0;
  const cacQuarterAgo = cacByMonth.get(months[latestIdx - 3]) ?? cac;
  const cacGrowthQoQ = cacQuarterAgo === 0 ? 0 : ((cac - cacQuarterAgo) / cacQuarterAgo) * 100; // a filter combo can genuinely zero this out
  const cacSpark = months.slice(-8).map((m) => cacByMonth.get(m) ?? 0);

  return {
    arr, arrGrowthYoY, arrSpark,
    nrr, nrrDeltaPp: nrr - nrrQuarterAgo, nrrSpark,
    churn, churnDeltaPp: churn - churnQuarterAgo, churnSpark,
    cac, cacGrowthQoQ, cacSpark,
    latest, months,
  };
}
