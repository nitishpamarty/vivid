export interface HistogramBin {
  label: string;
  count: number;
  tier: 'low' | 'mid' | 'high';
}

interface Props {
  bins: HistogramBin[];
  tierLabels: { low: string; mid: string; high: string };
}

const TIER_COLOR = { low: 'var(--status-critical)', mid: 'var(--status-warning)', high: 'var(--brand)' };

export function Histogram({ bins, tierLabels }: Props) {
  const max = Math.max(...bins.map((b) => b.count), 1);
  const total = bins.reduce((s, b) => s + b.count, 0) || 1;
  const pctByTier = (tier: HistogramBin['tier']) =>
    (bins.filter((b) => b.tier === tier).reduce((s, b) => s + b.count, 0) / total) * 100;

  return (
    <div className="hist">
      <div className="hist-legend">
        {(['low', 'mid', 'high'] as const).map((tier) => (
          <div className="hist-legend-item" key={tier}>
            <span className="sw" style={{ background: TIER_COLOR[tier] }} />
            {tierLabels[tier]}
            <b style={{ color: TIER_COLOR[tier] }}>{pctByTier(tier).toFixed(0)}%</b>
          </div>
        ))}
      </div>
      <div className="hist-bars">
        {bins.map((b) => (
          <div className="hist-bar" key={b.label}>
            <div className="hist-bar-track">
              <div className="hist-bar-fill" style={{ height: `${(b.count / max) * 100}%`, background: TIER_COLOR[b.tier] }} />
            </div>
            <div className="hist-bar-label">{b.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
