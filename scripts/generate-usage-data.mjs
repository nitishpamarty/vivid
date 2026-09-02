#!/usr/bin/env node
// Product-usage data generator. Writes data/reports.csv,
// data/report_views_monthly.csv, and data/activity_heatmap.json — Northbeam
// customers' usage of Northbeam's own saved reports, deliberately not shared
// code with generate-data.mjs/generate-people-data.mjs (see the note in the
// latter).

import { writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const OUT_DIR = new URL('../data/', import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260903);
const between = (lo, hi) => lo + rnd() * (hi - lo);

const MONTHS = 36;
function monthLabel(m) {
  const start = new Date(Date.UTC(2023, 9, 1));
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + (m - 1), 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const TEAMS = ['Sales', 'Marketing', 'Customer Success', 'Finance', 'Product'];
const REPORT_NAMES = [
  'Pipeline Coverage', 'Deal Velocity', 'Quota Attainment', 'Territory Performance',
  'Campaign ROI', 'Channel Mix', 'Lead Funnel', 'Attribution Overview',
  'Renewal Risk', 'NPS Trend', 'Onboarding Health', 'Support Load',
  'Budget vs Actuals', 'Vendor Spend', 'Headcount Plan',
  'Feature Adoption', 'Release Impact', 'API Usage', 'Retention Cohorts', 'Executive Summary',
];

// ---- report catalog ----
const reports = REPORT_NAMES.map((name, i) => {
  const owner = TEAMS[i % TEAMS.length];
  const createdMonth = i < 8 ? 1 : Math.min(30, Math.round(between(1, 30)));
  const popularity = between(0.5, 1.6); // per-report baseline draw
  return { id: `REP-${String(i + 1).padStart(3, '0')}`, name, owner, createdMonth, popularity };
});

// ---- monthly views per report, from its createdMonth through month 36 ----
const viewRows = [];
for (const r of reports) {
  let views = Math.round(between(20, 90) * r.popularity);
  for (let m = r.createdMonth; m <= MONTHS; m++) {
    views = Math.max(3, Math.round(views * (1 + between(-0.12, 0.16))));
    const uniqueViewers = Math.max(1, Math.round(views * between(0.25, 0.55)));
    const engagementScore = Math.round(Math.min(100, Math.max(2, (uniqueViewers / views) * 140 * between(0.7, 1.3))));
    viewRows.push({ report_id: r.id, month: monthLabel(m), views, unique_viewers: uniqueViewers, engagement_score: engagementScore });
  }
}

// ---- aggregate weekday x hour-bucket activity pattern (business-hours-weighted) ----
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_BUCKETS = ['0-4', '4-8', '8-12', '12-16', '16-20', '20-24'];
const BUCKET_WEIGHT = [0.05, 0.25, 1.1, 1.3, 0.9, 0.2]; // business-hours peak
const activity = [];
WEEKDAYS.forEach((wd, wi) => {
  const dayWeight = wi < 5 ? between(0.85, 1.15) : between(0.15, 0.35); // weekends much quieter
  HOUR_BUCKETS.forEach((hb, hi) => {
    const views = Math.max(0, Math.round(between(30, 70) * dayWeight * BUCKET_WEIGHT[hi]));
    activity.push({ weekday: wd, hourBucket: hb, views });
  });
});

// ---- write files ----
function toCsv(rows, cols) {
  const esc = (v) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c] ?? '')).join(','))].join('\n') + '\n';
}

writeFileSync(new URL('reports.csv', OUT_DIR), toCsv(
  reports.map((r) => ({ report_id: r.id, name: r.name, owner_team: r.owner, created_month: monthLabel(r.createdMonth) })),
  ['report_id', 'name', 'owner_team', 'created_month'],
));

writeFileSync(new URL('report_views_monthly.csv', OUT_DIR), toCsv(
  viewRows, ['report_id', 'month', 'views', 'unique_viewers', 'engagement_score'],
));

writeFileSync(new URL('activity_heatmap.json', OUT_DIR), JSON.stringify(activity, null, 2));

// ---- self-check ----
assert.equal(reports.length, REPORT_NAMES.length, 'one row per report name');
assert.ok(viewRows.every((r) => r.unique_viewers <= r.views), 'unique viewers can never exceed views');
assert.ok(viewRows.every((r) => r.engagement_score >= 0 && r.engagement_score <= 100), 'engagement score must stay in 0-100');
assert.ok(activity.length === WEEKDAYS.length * HOUR_BUCKETS.length, 'activity grid must be fully populated');
const latestMonth = monthLabel(MONTHS);
const latestViews = viewRows.filter((r) => r.month === latestMonth).reduce((s, r) => s + r.views, 0);
assert.ok(latestViews > 0, 'latest month should have nonzero total views');
console.log(`Month-36 total views: ${latestViews}, reports: ${reports.length}, view rows: ${viewRows.length}`);
console.log('OK: usage data generated.');
