import type { Department, ReportDef } from '../lib/types';
import { monthLabel } from '../lib/metrics';
import { OWNER_TEAM_VALUES, type UsageFilters as UsageFiltersState } from '../lib/usageFilters';

interface Props {
  filters: UsageFiltersState;
  reportOptions: ReportDef[];
  monthOptions: string[];
  onChange: (patch: Partial<UsageFiltersState>) => void;
}

export function UsageFilters({ filters, reportOptions, monthOptions, onChange }: Props) {
  return (
    <div className="filters">
      <select
        aria-label="Filter by owner team"
        className={`pill-select ${filters.ownerTeam !== 'all' ? 'active' : ''}`}
        value={filters.ownerTeam}
        onChange={(e) => onChange({ ownerTeam: e.target.value as Department | 'all' })}
      >
        {OWNER_TEAM_VALUES.map((v) => <option key={v} value={v}>{v === 'all' ? 'All teams' : v}</option>)}
      </select>
      <select
        aria-label="Filter by report"
        className={`pill-select ${filters.reportId !== 'all' ? 'active' : ''}`}
        value={filters.reportId}
        onChange={(e) => onChange({ reportId: e.target.value })}
      >
        <option value="all">All reports</option>
        {reportOptions.map((r) => <option key={r.reportId} value={r.reportId}>{r.name}</option>)}
      </select>
      <select
        aria-label="As of month"
        className="pill-select"
        value={filters.asOfMonth}
        onChange={(e) => onChange({ asOfMonth: e.target.value })}
      >
        {monthOptions.map((m) => <option key={m} value={m}>As of {monthLabel(m)}</option>)}
      </select>
    </div>
  );
}
