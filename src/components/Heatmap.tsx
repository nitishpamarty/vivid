import { Fragment } from 'react';

function divergingColor(v: number): string {
  if (v <= -2) return 'color-mix(in srgb, var(--div-neg-strong) 100%, transparent)';
  if (v < 0) return 'var(--div-neg-mild)';
  if (v === 0) return 'var(--div-neutral)';
  if (v <= 2) return 'color-mix(in srgb, var(--seq-mild) 55%, transparent)';
  return 'var(--seq-strong)';
}

function sequentialColor(v: number, max: number): string {
  if (max <= 0) return 'var(--div-neutral)';
  const t = Math.min(1, v / max);
  if (t === 0) return 'var(--div-neutral)';
  return `color-mix(in srgb, var(--seq-strong) ${Math.round(15 + t * 85)}%, var(--div-neutral))`;
}

interface Row {
  label: string;
  values: number[];
}

interface Props {
  columns: string[];
  rows: Row[];
  mode: 'diverging' | 'sequential';
  formatCell?: (v: number) => string;
  activeRow?: string;
  onToggleRow?: (label: string) => void;
}

export function Heatmap({ columns, rows, mode, formatCell, activeRow, onToggleRow }: Props) {
  const max = mode === 'sequential' ? Math.max(...rows.flatMap((r) => r.values), 1) : 0;
  const format = formatCell ?? ((v: number) => (mode === 'diverging' ? `${v > 0 ? '+' : ''}${v}` : String(v)));
  return (
    <div className="heat-grid" style={{ gridTemplateColumns: `52px repeat(${columns.length}, 1fr)` }}>
      <div className="hcorner" />
      {columns.map((c) => (
        <div className="hlabel" key={c}>{c}</div>
      ))}
      {rows.map((row) => (
        <Fragment key={row.label}>
          <button
            type="button"
            className={`hrow-label ${onToggleRow ? 'filterable' : ''} ${activeRow === row.label ? 'active' : ''}`}
            onClick={() => onToggleRow?.(row.label)}
            disabled={!onToggleRow}
          >
            {row.label}
          </button>
          {row.values.map((v, i) => (
            <div
              className="hcell"
              key={`${row.label}-${i}`}
              style={{ background: mode === 'diverging' ? divergingColor(v) : sequentialColor(v, max) }}
            >
              {format(v)}
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
