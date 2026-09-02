import type { Department, PeopleData } from './types';
export { monthLabel } from './metrics';

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Derived from the roster itself (min hire month to max hire/term month) —
// employees.csv has no explicit month axis the way mrr_monthly.csv does.
export function monthList(data: PeopleData): string[] {
  const all = data.employees.flatMap((e) => [e.hireMonth, e.termMonth].filter((m): m is string => !!m));
  const min = all.reduce((a, b) => (a < b ? a : b));
  const max = all.reduce((a, b) => (a > b ? a : b));
  const months: string[] = [];
  for (let m = min; m <= max; m = addMonths(m, 1)) months.push(m);
  return months;
}

function activeAt(data: PeopleData, month: string) {
  return data.employees.filter((e) => e.hireMonth <= month && (!e.termMonth || e.termMonth > month));
}

export function headcountAt(data: PeopleData, month: string): number {
  return activeAt(data, month).length;
}

export function newHiresIn(data: PeopleData, month: string): number {
  return data.employees.filter((e) => e.hireMonth === month).length;
}

function termsIn(data: PeopleData, month: string): number {
  return data.employees.filter((e) => e.termMonth === month).length;
}

// Trailing-12-month attrition, annualized: terms over the window divided by
// average headcount over that window.
export function attritionRateTrailing12(data: PeopleData, month: string, months: string[]): number {
  const idx = months.indexOf(month);
  if (idx < 11) return NaN;
  const window = months.slice(idx - 11, idx + 1);
  const terms = window.reduce((s, m) => s + termsIn(data, m), 0);
  const avgHeadcount = window.reduce((s, m) => s + headcountAt(data, m), 0) / window.length;
  return avgHeadcount === 0 ? 0 : (terms / avgHeadcount) * 100;
}

export function avgTenureMonths(data: PeopleData, month: string, months: string[]): number {
  const active = activeAt(data, month);
  if (active.length === 0) return 0;
  const idx = months.indexOf(month);
  const tenures = active.map((e) => idx - months.indexOf(e.hireMonth));
  return tenures.reduce((s, t) => s + t, 0) / tenures.length;
}

export function headcountByDepartment(data: PeopleData, month: string) {
  const byDept = new Map<Department, number>();
  for (const e of activeAt(data, month)) byDept.set(e.department, (byDept.get(e.department) ?? 0) + 1);
  return [...byDept.entries()]
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count);
}

export interface TenureBucket { label: string; count: number; tier: 'low' | 'mid' | 'high' }

export function tenureDistribution(data: PeopleData, month: string, months: string[]): TenureBucket[] {
  const idx = months.indexOf(month);
  const buckets: TenureBucket[] = [
    { label: '0-1yr', count: 0, tier: 'low' },
    { label: '1-2yr', count: 0, tier: 'low' },
    { label: '2-3yr', count: 0, tier: 'mid' },
    { label: '3-4yr', count: 0, tier: 'mid' },
    { label: '4yr+', count: 0, tier: 'high' },
  ];
  for (const e of activeAt(data, month)) {
    const years = (idx - months.indexOf(e.hireMonth)) / 12;
    const bucketIdx = years < 1 ? 0 : years < 2 ? 1 : years < 3 ? 2 : years < 4 ? 3 : 4;
    buckets[bucketIdx].count++;
  }
  return buckets;
}

// Net headcount change (hires - terms) by department, for a set of trailing months — feeds the heatmap.
export function netChangeByDepartment(data: PeopleData, months: string[]) {
  const depts = [...new Set(data.employees.map((e) => e.department))].sort();
  return depts.map((department) => ({
    label: department,
    values: months.map((m) => {
      const hires = data.employees.filter((e) => e.department === department && e.hireMonth === m).length;
      const terms = data.employees.filter((e) => e.department === department && e.termMonth === m).length;
      return hires - terms;
    }),
  }));
}

export function computePeopleKpis(data: PeopleData) {
  const months = monthList(data);
  const latest = months[months.length - 1];
  const latestIdx = months.length - 1;

  const headcount = headcountAt(data, latest);
  const headcountSpark = months.slice(-8).map((m) => headcountAt(data, m));
  const headcountMoM = headcountAt(data, months[latestIdx - 1]);
  const headcountDeltaPct = headcountMoM === 0 ? 0 : ((headcount - headcountMoM) / headcountMoM) * 100;

  const attrition = attritionRateTrailing12(data, latest, months);
  const attritionQuarterAgo = attritionRateTrailing12(data, months[latestIdx - 3], months);
  const attritionSpark = months.slice(-8).map((m) => attritionRateTrailing12(data, m, months)).filter((v) => !Number.isNaN(v));

  const newHires = newHiresIn(data, latest);
  const newHiresSpark = months.slice(-8).map((m) => newHiresIn(data, m));

  const avgTenure = avgTenureMonths(data, latest, months);
  const avgTenureQuarterAgo = avgTenureMonths(data, months[latestIdx - 3], months);
  const avgTenureSpark = months.slice(-8).map((m) => avgTenureMonths(data, m, months));

  return {
    headcount, headcountDeltaPct, headcountSpark,
    attrition, attritionDeltaPp: attrition - attritionQuarterAgo, attritionSpark,
    newHires, newHiresSpark,
    avgTenure, avgTenureDeltaMonths: avgTenure - avgTenureQuarterAgo, avgTenureSpark,
    latest, months,
  };
}
