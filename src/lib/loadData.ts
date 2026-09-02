import type { Customer, MrrRow, NorthbeamData } from './types';

function parseCsv(text: string): string[][] {
  return text
    .trim()
    .split('\n')
    .map((line) => line.split(','));
}

export async function loadNorthbeamData(): Promise<NorthbeamData> {
  const [customersText, mrrText, cacJson] = await Promise.all([
    fetch('/data/customers.csv').then((r) => r.text()),
    fetch('/data/mrr_monthly.csv').then((r) => r.text()),
    fetch('/data/cac_monthly.json').then((r) => r.json()),
  ]);

  const [, ...customerRows] = parseCsv(customersText);
  const customers: Customer[] = customerRows.map((c) => ({
    customerId: c[0],
    name: c[1],
    segment: c[2] as Customer['segment'],
    planTier: c[3] as Customer['planTier'],
    region: c[4] as Customer['region'],
    signupMonth: c[5],
    churnMonth: c[6] || null,
  }));

  const [, ...mrrRowsRaw] = parseCsv(mrrText);
  const mrrRows: MrrRow[] = mrrRowsRaw.map((r) => ({
    customerId: r[0],
    month: r[1],
    mrr: Number(r[2]),
    isNew: r[3] === '1',
    isExpansion: r[4] === '1',
    isContraction: r[5] === '1',
    isChurned: r[6] === '1',
  }));

  return { customers, mrrRows, cac: cacJson };
}
