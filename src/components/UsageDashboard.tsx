import { useMemo } from 'react';
import type { UsageData } from '../lib/types';
import {
  activityGrid, computeUsageKpis, engagementDistribution, HOUR_BUCKETS, topReports, viewsByOwnerTeam,
} from '../lib/usageMetrics';
import { Topbar, type ReportId } from './Topbar';
import { KpiCard } from './KpiRow';
import { Donut } from './Donut';
import { RankedBarList } from './RankedBarList';
import { Heatmap } from './Heatmap';
import { Histogram } from './Histogram';

const TEAM_COLORS = ['#7d52d6', '#2a78d6', '#eb6834', '#1baf7a', '#d6b12a'];

interface Props {
  data: UsageData;
  report: ReportId;
  onChangeReport: (r: ReportId) => void;
}

export function UsageDashboard({ data, report, onChangeReport }: Props) {
  const kpis = useMemo(() => computeUsageKpis(data), [data]);
  const top = useMemo(() => topReports(data, kpis.latest, 5), [data, kpis.latest]);
  const distribution = useMemo(() => engagementDistribution(data, kpis.latest), [data, kpis.latest]);
  const activity = useMemo(() => activityGrid(data), [data]);
  const byTeam = useMemo(() => viewsByOwnerTeam(data, kpis.latest), [data, kpis.latest]);

  const teamTotal = byTeam.reduce((s, t) => s + t.views, 0) || 1;
  const donutSegments = byTeam
    .sort((a, b) => b.views - a.views)
    .map((t, i) => ({ id: t.team, label: t.team, pct: (t.views / teamTotal) * 100, color: TEAM_COLORS[i % TEAM_COLORS.length] }));

  return (
    <div className="northbeam" data-report={report}>
      <div className="shell">
        <Topbar report={report} onChangeReport={onChangeReport} />

        <div className="kpi-row">
          <KpiCard
            label="Report Views" value={kpis.views.toLocaleString()}
            deltaLabel={`${kpis.viewsDeltaPct >= 0 ? '+' : ''}${kpis.viewsDeltaPct.toFixed(0)}% MoM`}
            deltaGood={kpis.viewsDeltaPct >= 0} sparkline={kpis.viewsSpark}
          />
          <KpiCard
            label="Avg Engagement" value={kpis.engagement.toFixed(0)}
            deltaLabel={`${kpis.engagementDeltaPp >= 0 ? '+' : ''}${kpis.engagementDeltaPp.toFixed(0)}pt MoM`}
            deltaGood={kpis.engagementDeltaPp >= 0} sparkline={kpis.engagementSpark}
          />
          <KpiCard
            label="Active Reports" value={String(kpis.activeReports)}
            deltaLabel="viewed this month" deltaGood sparkline={kpis.activeReportsSpark}
          />
          <KpiCard
            label="Unique Viewers" value={kpis.uniqueViewers.toLocaleString()}
            deltaLabel={`${kpis.uniqueViewersDeltaPct >= 0 ? '+' : ''}${kpis.uniqueViewersDeltaPct.toFixed(0)}% MoM`}
            deltaGood={kpis.uniqueViewersDeltaPct >= 0} sparkline={kpis.uniqueViewersSpark}
          />
        </div>

        <div className="grid">
          <div className="stack stack-left">
            <div className="card">
              <p className="panel-title">Activity pattern</p>
              <p className="panel-sub">Views by weekday and hour of day</p>
              <Heatmap columns={HOUR_BUCKETS} rows={activity} mode="sequential" />
            </div>
            <div className="card">
              <p className="panel-title">Engagement distribution</p>
              <p className="panel-sub">Reports by engagement score, this month</p>
              <Histogram bins={distribution} tierLabels={{ low: 'low engagement', mid: 'mid engagement', high: 'high engagement' }} />
            </div>
          </div>

          <div className="stack">
            <div className="card">
              <p className="panel-title">Most viewed reports</p>
              <p className="panel-sub">This month</p>
              <RankedBarList items={top} />
            </div>
            <div className="card">
              <p className="panel-title">Views by owning team</p>
              <p className="panel-sub">This month</p>
              <Donut segments={donutSegments} />
            </div>
          </div>
        </div>

        <footer className="note">Illustrative data for a fictional company — for direction review only.</footer>
      </div>
    </div>
  );
}
