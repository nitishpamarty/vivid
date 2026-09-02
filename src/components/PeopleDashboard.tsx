import { useMemo } from 'react';
import type { PeopleData } from '../lib/types';
import {
  computePeopleKpis, headcountByDepartment, monthLabel, netChangeByDepartment, tenureDistribution,
} from '../lib/peopleMetrics';
import { Topbar, type ReportId } from './Topbar';
import { KpiCard } from './KpiRow';
import { Donut } from './Donut';
import { RankedBarList } from './RankedBarList';
import { Heatmap } from './Heatmap';
import { Histogram } from './Histogram';

const DEPT_COLORS = ['#c9852f', '#2a78d6', '#1baf7a', '#9b6fd6', '#d6485a', '#5aa9a9', '#8a6a3f'];

interface Props {
  data: PeopleData;
  report: ReportId;
  onChangeReport: (r: ReportId) => void;
}

export function PeopleDashboard({ data, report, onChangeReport }: Props) {
  const kpis = useMemo(() => computePeopleKpis(data), [data]);
  const byDept = useMemo(() => headcountByDepartment(data, kpis.latest), [data, kpis.latest]);
  const tenure = useMemo(() => tenureDistribution(data, kpis.latest, kpis.months), [data, kpis.latest, kpis.months]);
  const last6 = kpis.months.slice(-6);
  const last6Labels = last6.map(monthLabel);
  const netChange = useMemo(() => netChangeByDepartment(data, last6), [data, last6]);

  const deptTotal = byDept.reduce((s, d) => s + d.count, 0) || 1;
  const donutSegments = byDept.map((d, i) => ({
    id: d.department, label: d.department, pct: (d.count / deptTotal) * 100, color: DEPT_COLORS[i % DEPT_COLORS.length],
  }));

  return (
    <div className="northbeam" data-report={report}>
      <div className="shell">
        <Topbar report={report} onChangeReport={onChangeReport} />

        <div className="kpi-row">
          <KpiCard
            label="Headcount" value={String(kpis.headcount)}
            deltaLabel={`${kpis.headcountDeltaPct >= 0 ? '+' : ''}${kpis.headcountDeltaPct.toFixed(1)}% MoM`}
            deltaGood={kpis.headcountDeltaPct >= 0} sparkline={kpis.headcountSpark}
          />
          <KpiCard
            label="Attrition Rate (TTM)" value={`${kpis.attrition.toFixed(1)}%`}
            deltaLabel={`${kpis.attritionDeltaPp >= 0 ? '+' : ''}${kpis.attritionDeltaPp.toFixed(1)}pp QoQ`}
            deltaGood={kpis.attritionDeltaPp <= 0} sparkline={kpis.attritionSpark} invertSpark
          />
          <KpiCard
            label="New Hires" value={String(kpis.newHires)}
            deltaLabel="this month" deltaGood sparkline={kpis.newHiresSpark}
          />
          <KpiCard
            label="Avg Tenure" value={`${(kpis.avgTenure / 12).toFixed(1)}yr`}
            deltaLabel={`${kpis.avgTenureDeltaMonths >= 0 ? '+' : ''}${kpis.avgTenureDeltaMonths.toFixed(1)}mo QoQ`}
            deltaGood={kpis.avgTenureDeltaMonths >= 0} sparkline={kpis.avgTenureSpark}
          />
        </div>

        <div className="grid">
          <div className="stack stack-left">
            <div className="card">
              <p className="panel-title">Tenure distribution</p>
              <p className="panel-sub">Active headcount by time since hire</p>
              <Histogram bins={tenure} tierLabels={{ low: 'under 2yr', mid: '2-4yr', high: '4yr+' }} />
            </div>
            <div className="card">
              <p className="panel-title">Net headcount change</p>
              <p className="panel-sub">By department, last 6 months (hires minus departures)</p>
              <Heatmap columns={last6Labels} rows={netChange} mode="diverging" />
            </div>
          </div>

          <div className="stack">
            <div className="card">
              <p className="panel-title">Headcount mix</p>
              <p className="panel-sub">By department</p>
              <Donut segments={donutSegments} />
            </div>
            <div className="card">
              <p className="panel-title">Headcount by department</p>
              <p className="panel-sub">Current active roster</p>
              <RankedBarList items={byDept.map((d) => ({ label: d.department, value: d.count }))} />
            </div>
          </div>
        </div>

        <footer className="note">Illustrative data for a fictional company — for direction review only.</footer>
      </div>
    </div>
  );
}
