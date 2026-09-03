import { formatTopAccountArr, topAccountsBarWidth } from '../lib/topAccountsPresentation';

interface Account {
  name: string;
  arr: number;
}

interface Props {
  accounts: Account[];
  activeAccount: string;
  onToggle: (name: string) => void;
  presentation?: 'ranked_list' | 'bar';
}

export function TopAccounts({ accounts, activeAccount, onToggle, presentation = 'ranked_list' }: Props) {
  const maxArr = Math.max(...accounts.map((account) => account.arr), 1);

  return (
    <div className={`top-accounts top-accounts-${presentation}`} role="group" aria-label="Top accounts by current ARR">
      {accounts.map((account, index) => {
        const active = activeAccount === account.name;
        return (
          <button
            type="button"
            key={account.name}
            className={`top-account-row ${active ? 'active' : ''}`}
            aria-pressed={active}
            onClick={() => onToggle(account.name)}
          >
            <span className="top-account-rank" aria-hidden="true">{index + 1}</span>
            <span className="top-account-name"><span className="selection-mark" aria-hidden="true">{active ? '✓' : ''}</span>{account.name}</span>
            <span className="top-account-amt">{formatTopAccountArr(account.arr)}</span>
            {presentation === 'bar' && (
              <span className="top-account-bar-track" aria-hidden="true">
                <span className="top-account-bar-fill" style={{ width: `${topAccountsBarWidth(account.arr, maxArr)}%` }} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
