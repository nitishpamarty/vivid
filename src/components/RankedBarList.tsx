export interface RankedItem {
  label: string;
  value: number;
}

interface Props {
  items: RankedItem[];
  formatValue?: (v: number) => string;
  activeLabel?: string;
  onToggle?: (label: string) => void;
}

export function RankedBarList({ items, formatValue = (v) => String(v), activeLabel, onToggle }: Props) {
  const max = Math.max(...items.map((a) => a.value), 1);
  return (
    <div>
      {items.map((item) => (
        <button
          type="button"
          key={item.label}
          className={`rank-row ${onToggle ? 'filterable' : ''} ${activeLabel === item.label ? 'active' : ''}`}
          onClick={() => onToggle?.(item.label)}
          disabled={!onToggle}
        >
          <span className="rank-name">{item.label}</span>
          <span className="rank-amt">{formatValue(item.value)}</span>
          <div className="rank-bar-track">
            <div className="rank-bar-fill" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </button>
      ))}
    </div>
  );
}
