import type { AcquisitionChannel } from '../lib/types';
import { Donut } from './Donut';

interface Slice {
  label: string;
  channel: AcquisitionChannel;
  pct: number;
  color: string;
}

interface Props {
  channels: Slice[];
  activeChannel: AcquisitionChannel | 'all';
  onToggle: (channel: AcquisitionChannel) => void;
}

export function ArrMixDonut({ channels, activeChannel, onToggle }: Props) {
  return (
    <Donut
      segments={channels.map((s) => ({ id: s.channel, label: s.label, pct: s.pct, color: s.color }))}
      activeId={activeChannel === 'all' ? undefined : activeChannel}
      onToggle={(id) => onToggle(id as AcquisitionChannel)}
    />
  );
}
