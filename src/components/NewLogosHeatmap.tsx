import type { Region } from '../lib/types';
import { formatNetNewLogos, netNewLogosBarWidth, netNewLogosByRegionTotals } from '../lib/netNewLogosPresentation';
import { Heatmap } from './Heatmap';

interface Props {
  months: string[];
  byRegion: Record<Region, number[]>;
  activeRegion: Region | 'all';
  onToggle: (region: Region) => void;
  presentation?: 'heatmap' | 'bar';
}

function NetNewLogosBar({ byRegion, activeRegion, onToggle }: Omit<Props, 'months' | 'presentation'>) {
  const totals = netNewLogosByRegionTotals(byRegion);
  const maxAbs = Math.max(...Object.values(totals).map((value) => Math.abs(value)), 1);

  return (
    <div className="net-new-bar" role="group" aria-label="Net new logos by region">
      {(Object.keys(totals) as Region[]).map((region) => {
        const value = totals[region];
        const active = activeRegion === region;
        const width = netNewLogosBarWidth(value, maxAbs);
        const fillStyle = value < 0
          ? { right: '50%', width: `${width}%` }
          : { left: '50%', width: `${width}%` };
        return (
          <button
            type="button"
            key={region}
            className={`net-new-bar-row ${active ? 'active' : ''}`}
            aria-pressed={active}
            onClick={() => onToggle(region)}
          >
            <span className="net-new-bar-label"><span className="selection-mark" aria-hidden="true">{active ? '✓' : ''}</span>{region}</span>
            <span className="net-new-bar-track" aria-hidden="true">
              <span className="net-new-bar-zero" />
              {value !== 0 && <span className={`net-new-bar-fill ${value < 0 ? 'negative' : 'positive'}`} style={fillStyle} />}
            </span>
            <span className="net-new-bar-value">{formatNetNewLogos(value)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function NewLogosHeatmap({ months, byRegion, activeRegion, onToggle, presentation = 'heatmap' }: Props) {
  if (presentation === 'bar') return <NetNewLogosBar byRegion={byRegion} activeRegion={activeRegion} onToggle={onToggle} />;

  const rows = (Object.keys(byRegion) as Region[]).map((r) => ({ label: r, values: byRegion[r] }));
  return (
    <Heatmap
      columns={months}
      rows={rows}
      mode="diverging"
      activeRow={activeRegion === 'all' ? undefined : activeRegion}
      onToggleRow={(label) => onToggle(label as Region)}
    />
  );
}
