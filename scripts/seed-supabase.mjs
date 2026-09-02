// One-off loader: reads the generated data/ files and upserts them into the
// Connect Data tables from supabase/migrations/0001_connect_data.sql.
// Not run by the app — run manually after applying that migration:
//
//   SUPABASE_SERVICE_ROLE_KEY=<key> node --env-file=.env.local scripts/seed-supabase.mjs
//
// .env.local supplies VITE_SUPABASE_URL (already there for the app); the
// service-role key is passed inline only — never written to .env.local or
// any other file, never VITE_-prefixed, never touched by client code.
//
// Upsert-only: inserts new rows and updates existing ones by primary key,
// but does not delete rows absent from a re-run's source file. That's fine
// for this deterministic, regenerated-in-place demo dataset; if a source
// file ever needs to shrink, `truncate table <name>;` first.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dataDir = new URL('../data/', import.meta.url);
const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error('Missing VITE_SUPABASE_URL (from --env-file=.env.local) or SUPABASE_SERVICE_ROLE_KEY (pass inline)');
}
const supabase = createClient(url, serviceKey);

function readData(name) {
  return readFileSync(fileURLToPath(new URL(name, dataDir)), 'utf8');
}

// Comma split only — safe for these specific generated files (no quoting or
// embedded commas), not a general-purpose CSV parser.
function parseCsv(text) {
  const [, ...rows] = text.trim().split('\n').map((line) => line.split(','));
  return rows;
}

// "YYYY-MM" -> "YYYY-MM-01" date string; empty string -> null.
function toMonthDate(s) {
  return s ? `${s}-01` : null;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function upsertBatched(table, rows, conflictKey) {
  for (const batch of chunk(rows, 500)) {
    const { error } = await supabase.from(table).upsert(batch, { onConflict: conflictKey });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
  console.log(`${table}: ${rows.length} rows`);
}

const customers = parseCsv(readData('customers.csv')).map((c) => ({
  customer_id: c[0], name: c[1], segment: c[2], plan_tier: c[3], region: c[4],
  channel: c[5], contract_type: c[6], signup_month: toMonthDate(c[7]), churn_month: toMonthDate(c[8]),
}));
await upsertBatched('customers', customers, 'customer_id');

const mrrMonthly = parseCsv(readData('mrr_monthly.csv')).map((r) => ({
  customer_id: r[0], month: toMonthDate(r[1]), mrr: Number(r[2]),
  is_new: r[3] === '1', is_expansion: r[4] === '1', is_contraction: r[5] === '1', is_churned: r[6] === '1',
}));
await upsertBatched('mrr_monthly', mrrMonthly, 'customer_id,month');

const cacMonthly = JSON.parse(readData('cac_monthly.json')).map((r) => ({
  month: toMonthDate(r.month), cac: r.cac,
}));
await upsertBatched('cac_monthly', cacMonthly, 'month');

const employees = parseCsv(readData('employees.csv')).map((r) => ({
  employee_id: r[0], department: r[1], region: r[2], hire_month: toMonthDate(r[3]), term_month: toMonthDate(r[4]),
}));
await upsertBatched('employees', employees, 'employee_id');

const reports = parseCsv(readData('reports.csv')).map((r) => ({
  report_id: r[0], name: r[1], owner_team: r[2], created_month: toMonthDate(r[3]),
}));
await upsertBatched('reports', reports, 'report_id');

const reportViewsMonthly = parseCsv(readData('report_views_monthly.csv')).map((r) => ({
  report_id: r[0], month: toMonthDate(r[1]), views: Number(r[2]), unique_viewers: Number(r[3]), engagement_score: Number(r[4]),
}));
await upsertBatched('report_views_monthly', reportViewsMonthly, 'report_id,month');

const activityHeatmap = JSON.parse(readData('activity_heatmap.json')).map((r) => ({
  weekday: r.weekday, hour_bucket: r.hourBucket, views: r.views,
}));
await upsertBatched('activity_heatmap', activityHeatmap, 'weekday,hour_bucket');

console.log('Seed complete.');
