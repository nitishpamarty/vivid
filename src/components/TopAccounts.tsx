import { RankedBarList } from './RankedBarList';

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
  return (
    <RankedBarList
      items={accounts.map((a) => ({ label: a.name, value: a.arr }))}
      formatValue={(v) => `$${Math.round(v / 1000)}k`}
      activeLabel={activeAccount === 'all' ? undefined : activeAccount}
      onToggle={onToggle}
    />
  );
}
