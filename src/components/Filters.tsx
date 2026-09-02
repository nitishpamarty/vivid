import type { PlanTier, Region, Segment } from '../lib/types';
import { PLAN_VALUES, REGION_VALUES, SEGMENT_VALUES, type ReportFilters } from '../lib/reportFilters';

interface Props {
  filters: ReportFilters;
  onChange: (patch: Partial<ReportFilters>) => void;
}

export function Filters({ filters, onChange }: Props) {
  return (
    <div className="filters">
      <select
        className={`pill-select ${filters.segment !== 'all' ? 'active' : ''}`}
        value={filters.segment}
        onChange={(e) => onChange({ segment: e.target.value as Segment | 'all' })}
      >
        {SEGMENT_VALUES.map((v) => <option key={v} value={v}>{v === 'all' ? 'All segments' : v}</option>)}
      </select>
      <select
        className={`pill-select ${filters.region !== 'all' ? 'active' : ''}`}
        value={filters.region}
        onChange={(e) => onChange({ region: e.target.value as Region | 'all' })}
      >
        {REGION_VALUES.map((v) => <option key={v} value={v}>{v === 'all' ? 'All regions' : v}</option>)}
      </select>
      <select
        className={`pill-select ${filters.planTier !== 'all' ? 'active' : ''}`}
        value={filters.planTier}
        onChange={(e) => onChange({ planTier: e.target.value as PlanTier | 'all' })}
      >
        {PLAN_VALUES.map((v) => <option key={v} value={v}>{v === 'all' ? 'All plans' : v}</option>)}
      </select>
    </div>
  );
}
