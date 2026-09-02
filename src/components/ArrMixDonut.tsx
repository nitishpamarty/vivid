import type { Segment } from '../lib/types';

interface Slice {
  label: string;
  segment: Segment;
  pct: number;
  color: string;
}

interface Props {
  segments: Slice[];
  activeSegment: Segment | 'all';
  onToggle: (segment: Segment) => void;
}

export function ArrMixDonut({ segments, activeSegment, onToggle }: Props) {
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
            key={s.label}
            className={`item filterable ${activeSegment === s.segment ? 'active' : ''}`}
            onClick={() => onToggle(s.segment)}
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
