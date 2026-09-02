import type { Region } from '../lib/types';
import { Heatmap } from './Heatmap';

interface Props {
  months: string[];
  byRegion: Record<Region, number[]>;
  activeRegion: Region | 'all';
  onToggle: (region: Region) => void;
}

export function NewLogosHeatmap({ months, byRegion, activeRegion, onToggle }: Props) {
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
