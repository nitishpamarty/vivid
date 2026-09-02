import type { ContractType, PlanTier, Region, Segment } from '../lib/types';
import { CONTRACT_VALUES, PLAN_VALUES, REGION_VALUES, SEGMENT_VALUES, type ReportFilters } from '../lib/reportFilters';

interface Props {
  filters: ReportFilters;
  onChange: (patch: Partial<ReportFilters>) => void;
}

export function Filters({ filters, onChange }: Props) {
  return (
    <div className="filters">
      <select
        aria-label="Filter by segment"
        className={`pill-select ${filters.segment !== 'all' ? 'active' : ''}`}
        value={filters.segment}
        onChange={(e) => onChange({ segment: e.target.value as Segment | 'all' })}
      >
        {SEGMENT_VALUES.map((v) => <option key={v} value={v}>{v === 'all' ? 'All segments' : v}</option>)}
      </select>
      <select
        aria-label="Filter by region"
        className={`pill-select ${filters.region !== 'all' ? 'active' : ''}`}
        value={filters.region}
        onChange={(e) => onChange({ region: e.target.value as Region | 'all' })}
      >
        {REGION_VALUES.map((v) => <option key={v} value={v}>{v === 'all' ? 'All regions' : v}</option>)}
      </select>
      <select
        aria-label="Filter by plan tier"
        className={`pill-select ${filters.planTier !== 'all' ? 'active' : ''}`}
        value={filters.planTier}
        onChange={(e) => onChange({ planTier: e.target.value as PlanTier | 'all' })}
      >
        {PLAN_VALUES.map((v) => <option key={v} value={v}>{v === 'all' ? 'All plans' : v}</option>)}
      </select>
      <select
        aria-label="Filter by contract type"
        className={`pill-select ${filters.contractType !== 'all' ? 'active' : ''}`}
        value={filters.contractType}
        onChange={(e) => onChange({ contractType: e.target.value as ContractType | 'all' })}
      >
        {CONTRACT_VALUES.map((v) => <option key={v} value={v}>{v === 'all' ? 'All contracts' : v}</option>)}
      </select>
    </div>
  );
}
