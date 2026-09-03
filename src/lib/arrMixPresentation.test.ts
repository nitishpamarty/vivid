import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrMixBarWidth, formatArrValue, toggleArrMixChannel } from './arrMixPresentation.ts';
import { arrMixByChannel } from './metrics.ts';
import { applyReportFilters, DEFAULT_FILTERS } from './reportFilters.ts';
import type { NorthbeamData } from './types.ts';

const data: NorthbeamData = {
  customers: [
    { customerId: 'paid', name: 'Paid Co', segment: 'SMB', planTier: 'Starter', region: 'NA', channel: 'Paid', contractType: 'Monthly', signupMonth: '2026-01', churnMonth: null },
    { customerId: 'organic', name: 'Organic Co', segment: 'SMB', planTier: 'Starter', region: 'NA', channel: 'Organic', contractType: 'Monthly', signupMonth: '2026-01', churnMonth: null },
  ],
  mrrRows: [
    { customerId: 'paid', month: '2026-09', mrr: 1000, isNew: false, isExpansion: false, isContraction: false, isChurned: false },
    { customerId: 'organic', month: '2026-09', mrr: 500, isNew: false, isExpansion: false, isContraction: false, isChurned: false },
  ],
  cac: [],
};

test('bar presentation uses the same filtered channel ARR values as the donut', () => {
  const allMix = arrMixByChannel(data, '2026-09');
  assert.deepEqual(allMix, { Paid: 12000, Organic: 6000, Referral: 0, Partner: 0 });

  const paidData = applyReportFilters(data, { ...DEFAULT_FILTERS, channel: 'Paid' });
  assert.deepEqual(arrMixByChannel(paidData, '2026-09'), { Paid: 12000, Organic: 0, Referral: 0, Partner: 0 });
  assert.equal(arrMixBarWidth(6000, 12000), 50);
  assert.equal(formatArrValue(12000), '$12k');
});

test('channel selection is accessible in both directions and toggles off', () => {
  assert.equal(toggleArrMixChannel('all', 'Paid'), 'Paid');
  assert.equal(toggleArrMixChannel('Paid', 'Paid'), 'all');
  assert.equal(toggleArrMixChannel('Paid', 'Organic'), 'Organic');
  assert.equal(arrMixBarWidth(0, 12000), 0);
});
