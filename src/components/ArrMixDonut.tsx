import type { AcquisitionChannel } from '../lib/types';
import { arrMixBarWidth, formatArrValue } from '../lib/arrMixPresentation';
import { Donut } from './Donut';

interface Slice {
  label: string;
  channel: AcquisitionChannel;
  arr: number;
  pct: number;
  color: string;
}

interface Props {
  channels: Slice[];
  activeChannel: AcquisitionChannel | 'all';
  onToggle: (channel: AcquisitionChannel) => void;
  presentation?: 'donut' | 'bar';
}

function ArrMixBar({ channels, activeChannel, onToggle }: Omit<Props, 'presentation'>) {
  const maxArr = Math.max(...channels.map((channel) => channel.arr), 1);

  return (
    <div className="arr-mix-bar" role="group" aria-label="ARR by acquisition channel">
      {channels.map((channel) => {
        const active = activeChannel === channel.channel;
        return (
          <button
            type="button"
            key={channel.channel}
            className={`arr-mix-bar-row ${active ? 'active' : ''}`}
            aria-pressed={active}
            onClick={() => onToggle(channel.channel)}
          >
            <span className="arr-mix-bar-head">
              <span className="arr-mix-bar-label"><span className="selection-mark" aria-hidden="true">{active ? '✓' : ''}</span>{channel.label}</span>
              <span className="arr-mix-bar-value">{formatArrValue(channel.arr)} · {channel.pct.toFixed(0)}%</span>
            </span>
            <span className="arr-mix-bar-track" aria-hidden="true">
              <span className="arr-mix-bar-fill" style={{ width: `${arrMixBarWidth(channel.arr, maxArr)}%`, background: channel.color }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ArrMixDonut({ channels, activeChannel, onToggle, presentation = 'donut' }: Props) {
  if (presentation === 'bar') return <ArrMixBar channels={channels} activeChannel={activeChannel} onToggle={onToggle} />;

  return (
    <Donut
      segments={channels.map((s) => ({ id: s.channel, label: s.label, pct: s.pct, color: s.color }))}
      activeId={activeChannel === 'all' ? undefined : activeChannel}
      onToggle={(id) => onToggle(id as AcquisitionChannel)}
    />
  );
}
