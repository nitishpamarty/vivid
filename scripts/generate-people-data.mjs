#!/usr/bin/env node
// People-analytics data generator. Writes data/employees.csv via the same
// bottom-up monthly simulation shape as generate-data.mjs (active roster,
// per-month hiring + independent churn rolls) — deliberately not shared code
// with that script; each generator is ~120 lines and touching the revenue
// one risks its committed/evidence-referenced output.

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
const rnd = mulberry32(20260902);

const MONTHS = 36;
function monthLabel(m) {
  const start = new Date(Date.UTC(2023, 9, 1));
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + (m - 1), 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const DEPARTMENTS = ['Engineering', 'Sales', 'Customer Success', 'Marketing', 'Product', 'People', 'Finance'];
const DEPT_WEIGHTS = { Engineering: 0.30, Sales: 0.20, 'Customer Success': 0.15, Marketing: 0.10, Product: 0.10, People: 0.05, Finance: 0.10 };
const REGION_WEIGHTS = { NA: 0.45, EMEA: 0.28, APAC: 0.17, LATAM: 0.10 };

function weightedPick(weights) {
  const r = rnd();
  let acc = 0;
  for (const [k, w] of Object.entries(weights)) { acc += w; if (r <= acc) return k; }
  return Object.keys(weights)[0];
}

// Base monthly attrition probability, roughly 16% annualized.
const CHURN_BASE = 0.0145;

let nextId = 1;
const employees = []; // {id, department, region, hireMonth, termMonth}
const active = new Set();

function hire(m) {
  const id = `EMP-${String(nextId).padStart(4, '0')}`;
  nextId++;
  const e = { id, department: weightedPick(DEPT_WEIGHTS), region: weightedPick(REGION_WEIGHTS), hireMonth: m, termMonth: null };
  employees.push(e);
  active.add(e);
  return e;
}

for (let i = 0; i < 28; i++) hire(1);

for (let m = 2; m <= MONTHS; m++) {
  for (const e of active) {
    if (rnd() < CHURN_BASE) { e.termMonth = m; active.delete(e); }
  }
  const growthRate = 0.07 - 0.035 * ((m - 1) / 35); // decelerating, ~7%/mo early to ~3.5%/mo late
  const hires = Math.max(1, Math.round(active.size * growthRate * (0.5 + rnd())));
  for (let i = 0; i < hires; i++) hire(m);
}

function toCsv(rows, cols) {
  const esc = (v) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c] ?? '')).join(','))].join('\n') + '\n';
}

const rows = employees.map((e) => ({
  employee_id: e.id, department: e.department, region: e.region,
  hire_month: monthLabel(e.hireMonth), term_month: e.termMonth ? monthLabel(e.termMonth) : '',
}));
writeFileSync(new URL('employees.csv', OUT_DIR), toCsv(rows, ['employee_id', 'department', 'region', 'hire_month', 'term_month']));

// ---- self-check ----
assert.ok(employees.length > 100, `expected a sizeable roster over 36 months, got ${employees.length}`);
const headcountAt36 = employees.filter((e) => !e.termMonth || e.termMonth > 36).length;
assert.ok(headcountAt36 > 60 && headcountAt36 < 250, `month-36 headcount out of plausible range: ${headcountAt36}`);
assert.ok(employees.every((e) => DEPARTMENTS.includes(e.department)), 'every employee must have a known department');
const termedAt36 = employees.filter((e) => e.termMonth === 36).length;
const activeAt35 = employees.filter((e) => e.hireMonth <= 35 && (!e.termMonth || e.termMonth > 35)).length;
const attritionPct = (termedAt36 / activeAt35) * 100 * 12; // rough annualized from one month
console.log(`Month-36 headcount: ${headcountAt36}, ~annualized attrition: ${attritionPct.toFixed(1)}%`);
console.log(`OK: ${employees.length} employees generated.`);
