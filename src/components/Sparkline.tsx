interface Props {
  values: number[];
  invert?: boolean; // true when a falling line is the "good" direction (e.g. churn)
}

export function Sparkline({ values, invert }: Props) {
  const w = 84, h = 26, pad = 3;
  if (values.length === 0) return <svg className="spark" viewBox={`0 0 ${w} ${h}`} />;
  const min = Math.min(...values), max = Math.max(...values);
  const norm = (v: number) => (max === min ? h / 2 : h - pad - ((v - min) / (max - min)) * (h - pad * 2));
  const step = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => [pad + i * step, norm(v)] as const);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const good = invert ? values[values.length - 1] < values[0] : values[values.length - 1] >= values[0];
  const color = good ? 'var(--success-text)' : 'var(--status-critical)';

  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`}>
      <path d={d} fill="none" style={{ stroke: color }} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.2} style={{ fill: color }} />
    </svg>
  );
}
