import type { Department, UsageData } from './types.ts';
export { monthLabel } from './metrics.ts';

export function monthList(data: UsageData): string[] {
  return [...new Set(data.views.map((r) => r.month))].sort();
}

function viewsIn(data: UsageData, month: string) {
  return data.views.filter((r) => r.month === month);
}

export function totalViews(data: UsageData, month: string): number {
  return viewsIn(data, month).reduce((s, r) => s + r.views, 0);
}

export function monthlyViewTotals(data: UsageData) {
  return monthList(data).map((month) => ({ month, views: totalViews(data, month) }));
}

export function totalUniqueViewers(data: UsageData, month: string): number {
  return viewsIn(data, month).reduce((s, r) => s + r.uniqueViewers, 0);
}

export function activeReportCount(data: UsageData, month: string): number {
  return viewsIn(data, month).length;
}

export function avgEngagement(data: UsageData, month: string): number {
  const rows = viewsIn(data, month);
  if (rows.length === 0) return 0;
  return rows.reduce((s, r) => s + r.engagementScore, 0) / rows.length;
}

export function topReports(data: UsageData, month: string, n = 5) {
  const nameById = new Map(data.reports.map((r) => [r.reportId, r.name]));
  return viewsIn(data, month)
    .map((r) => ({ reportId: r.reportId, label: nameById.get(r.reportId) ?? r.reportId, value: r.views }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

// Views by owner team, for a donut — the team that built each report, not who viewed it.
export function viewsByOwnerTeam(data: UsageData, month: string) {
  const teamByReport = new Map(data.reports.map((r) => [r.reportId, r.ownerTeam]));
  const byTeam = new Map<Department, number>();
  for (const r of viewsIn(data, month)) {
    const team = teamByReport.get(r.reportId);
    if (team) byTeam.set(team, (byTeam.get(team) ?? 0) + r.views);
  }
  return [...byTeam.entries()].map(([team, views]) => ({ team, views }));
}

export interface EngagementBin { label: string; count: number; tier: 'low' | 'mid' | 'high' }

export function engagementDistribution(data: UsageData, month: string): EngagementBin[] {
  const bins: EngagementBin[] = [
    { label: '0-20', count: 0, tier: 'low' },
    { label: '20-40', count: 0, tier: 'low' },
    { label: '40-60', count: 0, tier: 'mid' },
    { label: '60-80', count: 0, tier: 'mid' },
    { label: '80-100', count: 0, tier: 'high' },
  ];
  for (const r of viewsIn(data, month)) {
    const idx = Math.min(4, Math.floor(r.engagementScore / 20));
    bins[idx].count++;
  }
  return bins;
}

const HOUR_BUCKETS = ['0-4', '4-8', '8-12', '12-16', '16-20', '20-24'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function activityGrid(data: UsageData) {
  const byKey = new Map(data.activity.map((c) => [`${c.weekday}|${c.hourBucket}`, c.views]));
  return WEEKDAYS.map((label) => ({
    label,
    values: HOUR_BUCKETS.map((h) => byKey.get(`${label}|${h}`) ?? 0),
  }));
}
export { HOUR_BUCKETS };

// `allMonths`/`asOfMonth` let a caller pass an explicit as-of cutoff (Product
// Usage's asOfMonth filter) so `latest` stays the *selected* month — never
// `undefined` — even when `data` has been scoped down to zero matching rows;
// every metric below degrades to 0 rather than NaN in that case. Defaults
// preserve the original unfiltered-latest-month behavior.
export function computeUsageKpis(data: UsageData, allMonths: string[] = monthList(data), asOfMonth: string = allMonths[allMonths.length - 1]) {
  const latest = asOfMonth;
  const latestIdx = allMonths.indexOf(latest);
  const prevMonth = latestIdx > 0 ? allMonths[latestIdx - 1] : undefined;
  const sparkMonths = latestIdx >= 0 ? allMonths.slice(0, latestIdx + 1).slice(-8) : [];

  const views = totalViews(data, latest);
  const viewsSpark = sparkMonths.map((m) => totalViews(data, m));
  const viewsMoM = prevMonth ? totalViews(data, prevMonth) : 0;
  const viewsDeltaPct = viewsMoM === 0 ? 0 : ((views - viewsMoM) / viewsMoM) * 100;

  const engagement = avgEngagement(data, latest);
  const engagementMoM = prevMonth ? avgEngagement(data, prevMonth) : 0;
  const engagementSpark = sparkMonths.map((m) => avgEngagement(data, m));

  const activeReports = activeReportCount(data, latest);
  const activeReportsSpark = sparkMonths.map((m) => activeReportCount(data, m));

  const uniqueViewers = totalUniqueViewers(data, latest);
  const uniqueViewersSpark = sparkMonths.map((m) => totalUniqueViewers(data, m));
  const uniqueViewersMoM = prevMonth ? totalUniqueViewers(data, prevMonth) : 0;
  const uniqueViewersDeltaPct = uniqueViewersMoM === 0 ? 0 : ((uniqueViewers - uniqueViewersMoM) / uniqueViewersMoM) * 100;

  return {
    views, viewsDeltaPct, viewsSpark,
    engagement, engagementDeltaPp: engagement - engagementMoM, engagementSpark,
    activeReports, activeReportsSpark,
    uniqueViewers, uniqueViewersDeltaPct, uniqueViewersSpark,
    latest, months: allMonths,
  };
}
