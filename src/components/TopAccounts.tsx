interface Account {
  name: string;
  arr: number;
}

interface Props {
  accounts: Account[];
  activeAccount: string;
  onToggle: (name: string) => void;
}

export function TopAccounts({ accounts, activeAccount, onToggle }: Props) {
  const max = Math.max(...accounts.map((a) => a.arr));
  return (
    <div>
      {accounts.map((a) => (
        <button
          type="button"
          key={a.name}
          className={`rank-row filterable ${activeAccount === a.name ? 'active' : ''}`}
          onClick={() => onToggle(a.name)}
        >
          <span className="rank-name">{a.name}</span>
          <span className="rank-amt">${Math.round(a.arr / 1000)}k</span>
          <div className="rank-bar-track">
            <div className="rank-bar-fill" style={{ width: `${(a.arr / max) * 100}%` }} />
          </div>
        </button>
      ))}
    </div>
  );
}
