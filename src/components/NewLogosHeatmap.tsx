import { Fragment } from 'react';
import type { Region } from '../lib/types';

function colorFor(v: number): string {
  if (v <= -2) return 'color-mix(in srgb, var(--div-neg-strong) 100%, transparent)';
  if (v < 0) return 'var(--div-neg-mild)';
  if (v === 0) return 'var(--div-neutral)';
  if (v <= 2) return 'color-mix(in srgb, var(--seq-mild) 55%, transparent)';
  return 'var(--seq-strong)';
}

interface Props {
  months: string[];
  byRegion: Record<Region, number[]>;
  activeRegion: Region | 'all';
  onToggle: (region: Region) => void;
}

export function NewLogosHeatmap({ months, byRegion, activeRegion, onToggle }: Props) {
  const regions = Object.keys(byRegion) as Region[];
  return (
    <div className="heat-grid">
      <div className="hcorner" />
      {months.map((m) => (
        <div className="hlabel" key={m}>{m}</div>
      ))}
      {regions.map((r) => (
        <Fragment key={r}>
          <button
            type="button"
            className={`hrow-label filterable ${activeRegion === r ? 'active' : ''}`}
            onClick={() => onToggle(r)}
          >
            {r}
          </button>
          {byRegion[r].map((v, i) => (
            <div className="hcell" key={`${r}-${i}`} style={{ background: colorFor(v) }}>
              {v > 0 ? '+' : ''}{v}
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
