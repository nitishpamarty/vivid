import type { Department, UsageData } from './types';
export { monthLabel } from './metrics';

export function monthList(data: UsageData): string[] {
  return [...new Set(data.views.map((r) => r.month))].sort();
}

function viewsIn(data: UsageData, month: string) {
  return data.views.filter((r) => r.month === month);
}

export function totalViews(data: UsageData, month: string): number {
  return viewsIn(data, month).reduce((s, r) => s + r.views, 0);
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
    .map((r) => ({ label: nameById.get(r.reportId) ?? r.reportId, value: r.views }))
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

export function computeUsageKpis(data: UsageData) {
  const months = monthList(data);
  const latest = months[months.length - 1];
  const latestIdx = months.length - 1;

  const views = totalViews(data, latest);
  const viewsSpark = months.slice(-8).map((m) => totalViews(data, m));
  const viewsMoM = totalViews(data, months[latestIdx - 1]);
  const viewsDeltaPct = viewsMoM === 0 ? 0 : ((views - viewsMoM) / viewsMoM) * 100;

  const engagement = avgEngagement(data, latest);
  const engagementMoM = avgEngagement(data, months[latestIdx - 1]);
  const engagementSpark = months.slice(-8).map((m) => avgEngagement(data, m));

  const activeReports = activeReportCount(data, latest);
  const activeReportsSpark = months.slice(-8).map((m) => activeReportCount(data, m));

  const uniqueViewers = totalUniqueViewers(data, latest);
  const uniqueViewersSpark = months.slice(-8).map((m) => totalUniqueViewers(data, m));
  const uniqueViewersMoM = totalUniqueViewers(data, months[latestIdx - 1]);
  const uniqueViewersDeltaPct = uniqueViewersMoM === 0 ? 0 : ((uniqueViewers - uniqueViewersMoM) / uniqueViewersMoM) * 100;

  return {
    views, viewsDeltaPct, viewsSpark,
    engagement, engagementDeltaPp: engagement - engagementMoM, engagementSpark,
    activeReports, activeReportsSpark,
    uniqueViewers, uniqueViewersDeltaPct, uniqueViewersSpark,
    latest, months,
  };
}
