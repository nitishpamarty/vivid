import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyReportFilters, DEFAULT_FILTERS } from './reportFilters.ts';
import { netNewLogosByRegion } from './metrics.ts';
import { formatNetNewLogos, netNewLogosBarWidth, netNewLogosByRegionTotals, toggleNetNewLogosRegion } from './netNewLogosPresentation.ts';
import type { NorthbeamData } from './types.ts';

const data: NorthbeamData = {
  customers: [
    { customerId: 'na-new', name: 'NA New', segment: 'SMB', planTier: 'Starter', region: 'NA', channel: 'Paid', contractType: 'Monthly', signupMonth: '2026-07', churnMonth: null },
    { customerId: 'na-churn', name: 'NA Churn', segment: 'SMB', planTier: 'Starter', region: 'NA', channel: 'Paid', contractType: 'Monthly', signupMonth: '2025-01', churnMonth: '2026-08' },
    { customerId: 'emea-new', name: 'EMEA New', segment: 'Enterprise', planTier: 'Enterprise', region: 'EMEA', channel: 'Organic', contractType: 'Annual', signupMonth: '2026-09', churnMonth: null },
  ],
  mrrRows: [],
  cac: [],
};

test('bar totals are the exact filtered six-month heatmap values', () => {
  const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  const all = netNewLogosByRegion(data, months);
  assert.deepEqual(all, { NA: [0, 0, 0, 1, -1, 0], EMEA: [0, 0, 0, 0, 0, 1], APAC: [0, 0, 0, 0, 0, 0], LATAM: [0, 0, 0, 0, 0, 0] });
  assert.deepEqual(netNewLogosByRegionTotals(all), { NA: 0, EMEA: 1, APAC: 0, LATAM: 0 });

  const paid = netNewLogosByRegion(applyReportFilters(data, { ...DEFAULT_FILTERS, channel: 'Paid' }), months);
  assert.deepEqual(netNewLogosByRegionTotals(paid), { NA: 0, EMEA: 0, APAC: 0, LATAM: 0 });
});

test('bar scale is diverging and labels negative, positive, and zero values', () => {
  assert.equal(netNewLogosBarWidth(-4, 8), 25);
  assert.equal(netNewLogosBarWidth(8, 8), 50);
  assert.equal(netNewLogosBarWidth(0, 8), 0);
  assert.equal(formatNetNewLogos(-3), '-3');
  assert.equal(formatNetNewLogos(3), '+3');
  assert.equal(formatNetNewLogos(0), '0');
});

test('region selection toggles off and replaces a prior selection', () => {
  assert.equal(toggleNetNewLogosRegion('all', 'NA'), 'NA');
  assert.equal(toggleNetNewLogosRegion('NA', 'NA'), 'all');
  assert.equal(toggleNetNewLogosRegion('NA', 'EMEA'), 'EMEA');
});
