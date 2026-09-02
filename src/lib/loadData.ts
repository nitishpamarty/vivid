import type {
  ActivityCell, Customer, Employee, MrrRow, NorthbeamData, PeopleData, ReportDef, ReportViewRow, UsageData,
} from './types';

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
    channel: c[5] as Customer['channel'],
    contractType: c[6] as Customer['contractType'],
    signupMonth: c[7],
    churnMonth: c[8] || null,
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

export async function loadPeopleData(): Promise<PeopleData> {
  const text = await fetch('/data/employees.csv').then((r) => r.text());
  const [, ...rows] = parseCsv(text);
  const employees: Employee[] = rows.map((r) => ({
    employeeId: r[0],
    department: r[1] as Employee['department'],
    region: r[2] as Employee['region'],
    hireMonth: r[3],
    termMonth: r[4] || null,
  }));
  return { employees };
}

export async function loadUsageData(): Promise<UsageData> {
  const [reportsText, viewsText, activity] = await Promise.all([
    fetch('/data/reports.csv').then((r) => r.text()),
    fetch('/data/report_views_monthly.csv').then((r) => r.text()),
    fetch('/data/activity_heatmap.json').then((r) => r.json()) as Promise<ActivityCell[]>,
  ]);

  const [, ...reportRows] = parseCsv(reportsText);
  const reports: ReportDef[] = reportRows.map((r) => ({
    reportId: r[0], name: r[1], ownerTeam: r[2] as ReportDef['ownerTeam'], createdMonth: r[3],
  }));

  const [, ...viewRows] = parseCsv(viewsText);
  const views: ReportViewRow[] = viewRows.map((r) => ({
    reportId: r[0], month: r[1], views: Number(r[2]), uniqueViewers: Number(r[3]), engagementScore: Number(r[4]),
  }));

  return { reports, views, activity };
}
