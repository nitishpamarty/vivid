#!/usr/bin/env node
// Northbeam data generator. Builds data/customers.csv and data/mrr_monthly.csv
// via a bottom-up monthly simulation — each customer's MRR follows its own
// random walk (segment-tuned drift + occasional expansion/contraction
// events) and churns on its own probabilistic roll. Aggregate numbers (ARR,
// NRR, churn%, mix%) emerge from that; nothing is back-solved to hit an
// exact target. A seeded PRNG only (mulberry32) — no Math.random() — so
// re-runs are byte-identical.
//
// Earlier version of this script forced every month's segment $ total to an
// exact deterministic curve via a uniform rescale, which is what made the
// trend lines (NRR/churn especially) look too smooth/manufactured despite
// having per-customer noise underneath — the rescale washed the noise back
// out at the aggregate level. This version doesn't rescale anything.

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
const rnd = mulberry32(20260901);
const between = (lo, hi) => lo + rnd() * (hi - lo);

const MONTHS = 36;
const REGIONS = ['NA', 'EMEA', 'APAC', 'LATAM'];
const REGION_WEIGHTS = { NA: 0.35, EMEA: 0.30, APAC: 0.20, LATAM: 0.15 };
const PLAN_BY_SEGMENT = {
  SMB: ['Starter', 'Team'],
  'Mid-Market': ['Team', 'Business'],
  Enterprise: ['Business', 'Enterprise'],
};
const CHANNELS = ['Paid', 'Organic', 'Referral', 'Partner'];
const CHANNEL_WEIGHTS = { Paid: 0.40, Organic: 0.32, Referral: 0.18, Partner: 0.10 };
function pickChannel() {
  const r = rnd();
  let acc = 0;
  for (const ch of CHANNELS) { acc += CHANNEL_WEIGHTS[ch]; if (r <= acc) return ch; }
  return 'Partner';
}
// Annual-contract odds rise with segment — bigger accounts skew toward annual commitments.
function pickContractType(segment) {
  const annualProb = segment === 'Enterprise' ? 0.85 : segment === 'Mid-Market' ? 0.55 : 0.25;
  return rnd() < annualProb ? 'Annual' : 'Monthly';
}

function monthLabel(m) {
  const start = new Date(Date.UTC(2023, 9, 1)); // month 1 = Oct 2023, month 36 = Sep 2026
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + (m - 1), 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function pickRegion() {
  const r = rnd();
  let acc = 0;
  for (const reg of REGIONS) { acc += REGION_WEIGHTS[reg]; if (r <= acc) return reg; }
  return 'LATAM';
}
function pickPlan(segment) {
  const opts = PLAN_BY_SEGMENT[segment];
  return opts[rnd() < 0.6 ? 0 : 1];
}

// ============================================================
// Per-segment economics — every number here is a distribution, not a target.
// ============================================================
const ECON = {
  SMB: { startMrr: [40, 260], driftMean: 0.010, driftStd: 0.05, churnBase: 0.029, expProb: 0.05, expMult: [1.12, 1.4], conProb: 0.028, conMult: [0.6, 0.88] },
  'Mid-Market': { startMrr: [300, 1400], driftMean: 0.011, driftStd: 0.04, churnBase: 0.017, expProb: 0.055, expMult: [1.1, 1.3], conProb: 0.026, conMult: [0.65, 0.9] },
  Enterprise: { startMrr: [1200, 3800], driftMean: 0.010, driftStd: 0.03, churnBase: 0.011, expProb: 0.055, expMult: [1.06, 1.2], conProb: 0.022, conMult: [0.72, 0.93] },
};

// New-signup mix drifts upmarket over time (by count — $ mix shifts far more,
// since an Enterprise deal is ~20x an SMB one).
function signupSegmentMix(m) {
  const t = Math.min(1, (m - 1) / 35);
  return { SMB: 0.95 - 0.35 * t, 'Mid-Market': 0.04 + 0.24 * t, Enterprise: 0.01 + 0.11 * t };
}
function pickSignupSegment(m) {
  const mix = signupSegmentMix(m);
  const r = rnd();
  if (r < mix.SMB) return 'SMB';
  if (r < mix.SMB + mix['Mid-Market']) return 'Mid-Market';
  return 'Enterprise';
}

// New-signup volume: proportional to the current base, growth rate
// decelerating from ~16%/mo to ~3%/mo — fast early logo growth, slower
// once the base is large (the realistic shape, not an authored number).
function growthRate(m) {
  const t = (m - 1) / 35;
  return 0.19 - 0.13 * t;
}

// A pricing-change window: elevated SMB/MM churn for a few months, letting
// a dip emerge from the simulation instead of being authored into a target
// curve. Placed a bit past the two-thirds mark, echoing the original story.
const PRICING_CHANGE_MONTHS = new Set([19, 20, 21]);
function churnProbFor(segment, m) {
  const base = ECON[segment].churnBase;
  if (!PRICING_CHANGE_MONTHS.has(m)) return base;
  if (segment === 'SMB') return base * 2.6;
  if (segment === 'Mid-Market') return base * 1.6;
  return base;
}

// ============================================================
// Roster + per-customer state.
// ============================================================
let nextId = 1;
const customers = []; // {id, name, segment, plan, region, signupMonth, churnMonth, mrr}
const NAME_PREFIX = ['Anchor', 'Brightline', 'Cobalt', 'Driftwood', 'Elm', 'Foundry', 'Gale', 'Harbor', 'Ironwood', 'Juniper', 'Kestrel', 'Lattice', 'Meridian', 'Nimbus', 'Outrigger', 'Pinewell', 'Quarry', 'Ridgeline', 'Solstice', 'Timberline', 'Upland', 'Verve', 'Westgate', 'Yarrow', 'Zephyr'];
const NAME_SUFFIX = ['Systems', 'Works', 'Labs', 'Collective', 'Group', 'Studio', 'Partners', 'Logistics', 'Health', 'Robotics', 'Freight', 'Analytics', 'Ventures', 'Digital', 'Supply Co.'];
function fillerName(id) {
  const p = NAME_PREFIX[id % NAME_PREFIX.length];
  const s = NAME_SUFFIX[Math.floor(id / NAME_PREFIX.length) % NAME_SUFFIX.length];
  return `${p} ${s}`;
}

function newCustomer(segment, m, opts = {}) {
  const id = `CUST-${String(nextId).padStart(5, '0')}`;
  nextId++;
  const [lo, hi] = ECON[segment].startMrr;
  const c = {
    id, name: opts.name ?? fillerName(nextId), segment,
    plan: opts.plan ?? pickPlan(segment), region: opts.region ?? pickRegion(),
    channel: opts.channel ?? pickChannel(), contractType: opts.contractType ?? pickContractType(segment),
    signupMonth: m, churnMonth: null,
    mrr: opts.mrr ?? between(lo, hi),
    driftBonus: opts.driftBonus ?? 0,
  };
  customers.push(c);
  return c;
}

// Flavor-named Enterprise accounts — flagship logos: seeded early, above
// the typical Enterprise starting range, with a small persistent drift
// bonus (an anchor account growing faster than a typical same-segment
// customer, which is realistic — not every Enterprise deal is equally
// sticky). Still a random walk on top of that, not a target ARR, so they
// aren't guaranteed to land in the final top 5 — see the soft check below.
const NAMED_SEED = [
  { name: 'Vantage Robotics', month: 4, mrr: 4200, driftBonus: 0.006 },
  { name: 'Cedar Health', month: 6, mrr: 3900, driftBonus: 0.006 },
  { name: 'Fable & Co', month: 8, mrr: 3600, driftBonus: 0.006 },
  { name: 'Loom Systems', month: 10, mrr: 3300, driftBonus: 0.006 },
  { name: 'Praxis Freight', month: 12, mrr: 3000, driftBonus: 0.006 },
];

// ============================================================
// Simulation, one month at a time.
// ============================================================
const active = new Set();
const mrrRows = []; // {customerId, month, mrr, isNew, isExpansion, isContraction, isChurned}
const prevMrr = new Map(); // customerId -> last month's mrr, updated as rows are pushed
const namedQueue = [...NAMED_SEED];

for (let m = 1; m <= MONTHS; m++) {
  // ---- churn roll for existing customers (before this month's row) ----
  if (m > 1) {
    for (const c of active) {
      if (c.signupMonth === m) continue;
      if (rnd() < churnProbFor(c.segment, m)) {
        c.churnMonth = m;
        active.delete(c);
      }
    }
  }

  // ---- MRR drift / expansion / contraction for survivors ----
  for (const c of active) {
    if (c.signupMonth === m) continue; // new signups get their starting MRR, not a drift pass
    const econ = ECON[c.segment];
    const r = rnd();
    let mult;
    if (r < econ.expProb) mult = between(...econ.expMult);
    else if (r < econ.expProb + econ.conProb) mult = between(...econ.conMult);
    else mult = 1 + econ.driftMean + c.driftBonus + (rnd() - 0.5) * 2 * econ.driftStd;
    c.mrr = Math.max(20, c.mrr * mult);
  }

  // ---- new signups this month ----
  if (m === 1) {
    for (let i = 0; i < 24; i++) newCustomer(pickSignupSegment(1), 1);
  } else {
    const n = Math.max(1, Math.round(active.size * growthRate(m) * between(0.6, 1.4)));
    for (let i = 0; i < n; i++) newCustomer(pickSignupSegment(m), m);
  }
  while (namedQueue.length && namedQueue[0].month === m) {
    const seed = namedQueue.shift();
    newCustomer('Enterprise', m, { name: seed.name, plan: 'Enterprise', mrr: seed.mrr, driftBonus: seed.driftBonus });
  }
  for (const c of customers) if (c.signupMonth === m) active.add(c);

  // ---- push this month's rows for everyone active ----
  for (const c of active) {
    const prev = prevMrr.get(c.id);
    const isNew = c.signupMonth === m;
    let isExpansion = false, isContraction = false;
    if (!isNew && prev !== undefined) {
      if (c.mrr > prev * 1.02) isExpansion = true;
      else if (c.mrr < prev * 0.98) isContraction = true;
    }
    mrrRows.push({
      customerId: c.id, month: monthLabel(m), mrr: Math.round(c.mrr * 100) / 100,
      isNew, isExpansion, isContraction, isChurned: false,
    });
    prevMrr.set(c.id, c.mrr);
  }
}

// mark churn flag on each customer's actual last active row
{
  const lastRowIdx = new Map();
  mrrRows.forEach((row, i) => lastRowIdx.set(row.customerId, i));
  for (const c of customers) {
    if (c.churnMonth) {
      const idx = lastRowIdx.get(c.id);
      if (idx !== undefined) mrrRows[idx].isChurned = true;
    }
  }
}

// ============================================================
// CAC — no spend field in the schema (see AGENTS.md), so still synthetic,
// but a noisy rising curve rather than a smooth backsolved one.
// ============================================================
const cacCurve = [];
for (let m = 1; m <= MONTHS; m++) {
  const t = Math.min(1, (m - 1) / 35);
  const base = 3400 + 5200 * Math.pow(t, 1.3);
  cacCurve[m] = Math.max(1500, base * between(0.9, 1.1));
}

// ============================================================
// Write CSVs.
// ============================================================
function toCsv(rows, cols) {
  const esc = (v) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c] ?? '')).join(','))].join('\n') + '\n';
}

const customerRows = customers.map((c) => ({
  customer_id: c.id, name: c.name, segment: c.segment, plan_tier: c.plan,
  region: c.region, channel: c.channel, contract_type: c.contractType,
  signup_month: monthLabel(c.signupMonth),
  churn_month: c.churnMonth ? monthLabel(c.churnMonth) : '',
}));
writeFileSync(new URL('customers.csv', OUT_DIR),
  toCsv(customerRows, ['customer_id', 'name', 'segment', 'plan_tier', 'region', 'channel', 'contract_type', 'signup_month', 'churn_month']));

const mrrCsvRows = mrrRows.map((r) => ({
  customer_id: r.customerId, month: r.month, mrr: r.mrr,
  is_new: r.isNew ? 1 : 0, is_expansion: r.isExpansion ? 1 : 0,
  is_contraction: r.isContraction ? 1 : 0, is_churned: r.isChurned ? 1 : 0,
}));
writeFileSync(new URL('mrr_monthly.csv', OUT_DIR),
  toCsv(mrrCsvRows, ['customer_id', 'month', 'mrr', 'is_new', 'is_expansion', 'is_contraction', 'is_churned']));

writeFileSync(new URL('cac_monthly.json', OUT_DIR), JSON.stringify(
  Array.from({ length: MONTHS }, (_, i) => ({ month: monthLabel(i + 1), cac: Math.round(cacCurve[i + 1]) })),
  null, 2,
));

// ============================================================
// Self-check — plausibility bounds, not exact anchors. This generator no
// longer targets specific numbers, so a hard equality assert would just be
// re-introducing the thing we removed. These catch actual bugs (negative
// MRR, a runaway/collapsed roster, a broken churn flag) without pinning the
// story to one exact shape.
// ============================================================
function arrAtMonth(m) {
  const label = monthLabel(m);
  return mrrRows.filter((r) => r.month === label).reduce((s, r) => s + r.mrr, 0) * 12;
}
const arr36 = arrAtMonth(36);
const arr1 = arrAtMonth(1);
assert.ok(arr36 > arr1 * 5, `ARR should grow substantially over 36 months: month 1 $${arr1.toFixed(0)}, month 36 $${arr36.toFixed(0)}`);
assert.ok(arr36 > 1_000_000 && arr36 < 12_000_000, `month-36 ARR out of plausible range: $${arr36.toFixed(0)}`);
assert.ok(mrrRows.every((r) => r.mrr > 0), 'every MRR row must be positive');

{
  const m36Label = monthLabel(36);
  const custById = new Map(customers.map((c) => [c.id, c]));
  const bySeg = { SMB: 0, 'Mid-Market': 0, Enterprise: 0 };
  for (const r of mrrRows) if (r.month === m36Label) bySeg[custById.get(r.customerId).segment] += r.mrr * 12;
  const total = bySeg.SMB + bySeg['Mid-Market'] + bySeg.Enterprise;
  assert.ok(Math.abs(total - arr36) < 1, 'segment mix should sum to total ARR');
  console.log(`Month-36 mix: Enterprise ${(bySeg.Enterprise / total * 100).toFixed(0)}%, Mid-Market ${(bySeg['Mid-Market'] / total * 100).toFixed(0)}%, SMB ${(bySeg.SMB / total * 100).toFixed(0)}%`);

  const top5 = mrrRows.filter((r) => r.month === m36Label).sort((a, b) => b.mrr - a.mrr).slice(0, 5)
    .map((r) => custById.get(r.customerId).name);
  const namedInTop5 = top5.filter((n) => NAMED_SEED.some((s) => s.name === n)).length;
  if (namedInTop5 < 4) console.warn(`NOTE: only ${namedInTop5}/5 flavor-named accounts landed in the final top 5 (organic simulation, not forced) — top 5 is [${top5.join(', ')}]`);

  const activeAtEnd = customers.filter((c) => !c.churnMonth || c.churnMonth > 36).length;
  assert.ok(activeAtEnd > 50, `too few active customers at month 36: ${activeAtEnd}`);

  const churned35to36 = customers.filter((c) => c.churnMonth === 36).length;
  const activeAt35 = customers.filter((c) => c.signupMonth <= 35 && (!c.churnMonth || c.churnMonth > 35)).length;
  const churnPct = (churned35to36 / activeAt35) * 100;
  assert.ok(churnPct >= 0 && churnPct < 10, `month-36 logo churn out of plausible range: ${churnPct.toFixed(1)}%`);
  console.log(`Month-36 logo churn: ${churnPct.toFixed(1)}%, ARR: $${arr36.toLocaleString(undefined, { maximumFractionDigits: 0 })}, CAC: $${Math.round(cacCurve[36])}`);
}

console.log(`OK: ${customers.length} customers, ${mrrRows.length} MRR rows.`);
