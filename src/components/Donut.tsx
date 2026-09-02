export interface DonutSlice {
  id: string;
  label: string;
  pct: number;
  color: string;
}

interface Props {
  segments: DonutSlice[];
  activeId?: string;
  onToggle?: (id: string) => void;
}

export function Donut({ segments, activeId, onToggle }: Props) {
  let acc = 0;
  const stops = segments
    .map((s) => {
      const from = acc;
      acc += s.pct;
      return `${s.color} ${from}% ${acc}%`;
    })
    .join(', ');

  return (
    <div className="donut-wrap">
      <div className="donut" style={{ background: `conic-gradient(${stops})` }} />
      <div className="donut-legend">
        {segments.map((s) => (
          <button
            type="button"
            key={s.id}
            className={`item ${onToggle ? 'filterable' : ''} ${activeId === s.id ? 'active' : ''}`}
            onClick={() => onToggle?.(s.id)}
            disabled={!onToggle}
          >
            <span className="sw" style={{ background: s.color }} />
            {s.label}
            <b>{s.pct.toFixed(0)}%</b>
          </button>
        ))}
      </div>
    </div>
  );
}
