import { Sparkline } from './Sparkline';

interface KpiCardProps {
  label: string;
  value: string;
  deltaLabel: string;
  deltaGood: boolean;
  sparkline: number[];
  invertSpark?: boolean;
  attainment?: { pct: number; caption: string };
}

function KpiCard({ label, value, deltaLabel, deltaGood, sparkline, invertSpark, attainment }: KpiCardProps) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="row2">
        <span className={`delta ${deltaGood ? 'good' : 'warn'}`}>{deltaLabel}</span>
        <Sparkline values={sparkline} invert={invertSpark} />
      </div>
      {attainment && (
        <div className="attain">
          <div className="track"><div className="fill" style={{ width: `${Math.min(100, attainment.pct)}%` }} /></div>
          <div className="cap">{attainment.caption}</div>
        </div>
      )}
    </div>
  );
}

export interface KpiRowProps {
  arr: number;
  arrGrowthYoY: number;
  arrSpark: number[];
  nrr: number;
  nrrDeltaPp: number;
  nrrSpark: number[];
  churn: number;
  churnDeltaPp: number;
  churnSpark: number[];
  cac: number;
  cacGrowthQoQ: number;
  cacSpark: number[];
}

const ARR_TARGET = 5_000_000;

export function KpiRow(p: KpiRowProps) {
  return (
    <div className="kpi-row">
      <KpiCard
        label="ARR"
        value={`$${(p.arr / 1_000_000).toFixed(2)}M`}
        deltaLabel={`${p.arrGrowthYoY >= 0 ? '+' : ''}${p.arrGrowthYoY.toFixed(0)}% YoY`}
        deltaGood={p.arrGrowthYoY >= 0}
        sparkline={p.arrSpark}
        attainment={{ pct: (p.arr / ARR_TARGET) * 100, caption: `${((p.arr / ARR_TARGET) * 100).toFixed(1)}% of $5.0M target` }}
      />
      <KpiCard
        label="Net Revenue Retention"
        value={`${p.nrr.toFixed(0)}%`}
        deltaLabel={`${p.nrrDeltaPp >= 0 ? '+' : ''}${p.nrrDeltaPp.toFixed(0)}pp QoQ`}
        deltaGood={p.nrrDeltaPp >= 0}
        sparkline={p.nrrSpark}
      />
      <KpiCard
        label="Logo Churn"
        value={`${p.churn.toFixed(1)}%`}
        deltaLabel={`${p.churnDeltaPp >= 0 ? '+' : ''}${p.churnDeltaPp.toFixed(1)}pp QoQ`}
        deltaGood={p.churnDeltaPp <= 0}
        sparkline={p.churnSpark}
        invertSpark
      />
      <KpiCard
        label="Blended CAC"
        value={`$${p.cac.toLocaleString()}`}
        deltaLabel={`${p.cacGrowthQoQ >= 0 ? '+' : ''}${p.cacGrowthQoQ.toFixed(0)}% QoQ`}
        deltaGood={p.cacGrowthQoQ <= 0}
        sparkline={p.cacSpark}
      />
    </div>
  );
}
