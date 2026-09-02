import { useMemo, type CSSProperties } from 'react';
import type { UsageData } from '../lib/types';
import {
  activityGrid, computeUsageKpis, engagementDistribution, HOUR_BUCKETS, monthlyViewTotals, topReports, viewsByOwnerTeam,
} from '../lib/usageMetrics';
import { monthLabel } from '../lib/metrics';
import { Topbar, type ReportId } from './Topbar';

interface Props { data: UsageData; report: ReportId; onChangeReport: (r: ReportId) => void; }

function delta(value: number, suffix: string) { return `${value >= 0 ? '+' : ''}${value.toFixed(0)}${suffix}`; }

export function UsageDashboard({ data, report, onChangeReport }: Props) {
  const kpis = useMemo(() => computeUsageKpis(data), [data]);
  const top = useMemo(() => topReports(data, kpis.latest, 5), [data, kpis.latest]);
  const distribution = useMemo(() => engagementDistribution(data, kpis.latest), [data, kpis.latest]);
  const activity = useMemo(() => activityGrid(data), [data]);
  const byTeam = useMemo(() => viewsByOwnerTeam(data, kpis.latest).sort((a, b) => b.views - a.views), [data, kpis.latest]);
  const momentum = useMemo(() => monthlyViewTotals(data), [data]);
  const activityMax = Math.max(...activity.flatMap((row) => row.values), 1);
  const teamTotal = byTeam.reduce((sum, team) => sum + team.views, 0) || 1;
  const maxTop = top[0]?.value || 1;
  const maxBin = Math.max(...distribution.map((bin) => bin.count), 1);
  const chart = useMemo(() => {
    const width = 640, height = 190, pad = 28;
    const values = momentum.map((point) => point.views);
    const min = Math.min(...values), max = Math.max(...values);
    const x = (index: number) => pad + index * (width - pad * 2) / Math.max(values.length - 1, 1);
    const y = (value: number) => height - pad - ((value - min) / Math.max(max - min, 1)) * (height - pad * 2);
    return { width, height, pad, points: values.map((value, index) => `${x(index)},${y(value)}`).join(' '), x, y, last: values.at(-1) ?? 0 };
  }, [momentum]);

  return <div className="northbeam usage-os" data-report={report}><div className="shell">
    <Topbar report={report} onChangeReport={onChangeReport} />
    <header className="usage-head"><div><p className="usage-kicker">Product intelligence / Activity OS</p><h1>Usage at a glance</h1><p>Find where the product is alive, quiet, or losing momentum.</p></div><div className="usage-period"><strong>{monthLabel(kpis.latest)}</strong>{kpis.activeReports} active reports</div></header>
    <div className="usage-pulse" aria-label="Product usage pulse">
      <div><span>Report views</span><strong>{kpis.views.toLocaleString()} <em>{delta(kpis.viewsDeltaPct, '%')}</em></strong></div>
      <div><span>Unique viewers</span><strong>{kpis.uniqueViewers.toLocaleString()} <em>{delta(kpis.uniqueViewersDeltaPct, '%')}</em></strong></div>
      <div><span>Average engagement</span><strong>{kpis.engagement.toFixed(0)} <em>{delta(kpis.engagementDeltaPp, 'pt')}</em></strong></div>
    </div>
    <div className="usage-grid"><div className="usage-left">
      <section className="usage-panel usage-heatmap-panel"><h2>When the workspace is active</h2><p>Views by weekday and hour of day.</p>
        <div className="usage-heatmap"><span />{HOUR_BUCKETS.map((hour) => <span key={hour}>{hour}</span>)}{activity.flatMap((row) => [<span className="usage-day" key={`${row.label}-label`}>{row.label}</span>, ...row.values.map((value, index) => <span className="usage-cell" key={`${row.label}-${HOUR_BUCKETS[index]}`} style={{ '--heat': `${18 + value / activityMax * 78}%` } as CSSProperties} aria-label={`${row.label} ${HOUR_BUCKETS[index]}: ${value} views`}>{value}</span>)])}</div>
        <div className="usage-legend"><span>Quiet</span><i /><span>Busy</span></div>
      </section>
      <section className="usage-panel usage-momentum"><h2>Usage momentum</h2><p>Monthly report views from October 2023 through {monthLabel(kpis.latest)}.</p>
        <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`Monthly views ending at ${chart.last.toLocaleString()}`}><line x1={chart.pad} y1={chart.height - chart.pad} x2={chart.width - chart.pad} y2={chart.height - chart.pad} /><polyline points={chart.points} /><circle cx={chart.x(momentum.length - 1)} cy={chart.y(chart.last)} r="4" /><text x={chart.pad} y={chart.height - 7}>{monthLabel(momentum[0]?.month ?? '')}</text><text x={chart.width - chart.pad} y={chart.height - 7} textAnchor="end">{monthLabel(kpis.latest)}</text><text className="usage-last-value" x={chart.width - chart.pad} y={chart.y(chart.last) - 11} textAnchor="end">{chart.last.toLocaleString()}</text></svg>
      </section>
    </div><aside className="usage-right">
      <section className="usage-panel"><h2>Reports drawing attention</h2><p>Most viewed this month.</p><div className="usage-ranks">{top.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong><i><b style={{ width: `${item.value / maxTop * 100}%` }} /></i></div>)}</div></section>
      <section className="usage-panel"><h2>Where usage comes from</h2><p>Share of views by owning team.</p><div className="usage-teams">{byTeam.map((team) => <div key={team.team}><span>{team.team}</span><i><b style={{ width: `${team.views / teamTotal * 100}%` }} /></i><em>{Math.round(team.views / teamTotal * 100)}%</em></div>)}</div></section>
      <section className="usage-panel usage-distribution"><h2>Engagement spread</h2><p>Reports by score band this month.</p><div>{distribution.map((bin) => <div key={bin.label}><i><b style={{ height: `${bin.count / maxBin * 100}%` }} /></i><strong>{bin.count}</strong><span>{bin.label}</span></div>)}</div></section>
    </aside></div>
    <footer className="note">Illustrative data for a fictional company — for direction review only.</footer>
  </div></div>;
}
