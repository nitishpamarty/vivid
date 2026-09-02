# Phase 3 verification (part 2) — 2026-09-02

Covers two changes made on explicit direction, on top of the same-day
[verification-2026-09-02.md](verification-2026-09-02.md) pass:

1. A full rewrite of `scripts/generate-data.mjs` from a top-down
   target-fit generator to a bottom-up Monte Carlo simulation, to fix
   trend lines that looked manufactured — see AGENTS.md's "Data spec"
   section for why and what changed. This explicitly supersedes the old
   exact-anchor data spec; the anchors no longer exist.
2. A fourth report filter, `accountName` (free text, not an enum), with
   click-to-filter on Top Accounts — the same `applyFilterPatch` /
   `set_report_filters` path the segment/region filters already used.

## Data realism check

Computed NRR (trailing-12 cohort) and logo churn for every month with
enough history, off the regenerated CSVs, using the same formulas as
`src/lib/metrics.ts`:

```
month     nrr    churn
2025-10   97.7   2.48
2025-11   94.6   1.69
2025-12   92.2   2.73
2026-01   90.0   1.70
2026-02   94.2   2.73
2026-03   98.0   2.13
2026-04   99.5   2.24
2026-05   99.3   3.23
2026-06   97.7   2.93
2026-07   96.2   2.21
2026-08   97.6   1.70
2026-09   95.9   1.67
```

Real peaks and valleys month to month — not monotonic, not a smooth
authored curve — which was the actual complaint (the *old* generator
already had per-customer random noise; the bug was a uniform monthly
rescale that forced every month's total to an exact target, washing that
noise back out at the aggregate level before it reached NRR/churn/ARR
bridge). Confirmed in the browser: `document.modelContext` polyfill
injected (see [verification-2026-09-01.md](../phase-2/verification-2026-09-01.md)
for the snippet), fresh load, no console errors, KPI sparklines and the
retention panel's two line charts visibly jagged rather than smooth.

Self-check output for this run:
`Month-36 mix: Enterprise 55%, Mid-Market 26%, SMB 19%` /
`Month-36 logo churn: 1.7%, ARR: $4,128,018, CAC: $8504` /
`706 customers, 7873 MRR rows`. All four flavor-named accounts but one
(Vantage Robotics, this run) landed in the actual top 5 — organic, not
forced; the generator logs a note (not a failure) when fewer than 4 of 5
do.

## `accountName` filter

- `get_report_context.execute({})` → `data.topAccounts` returned the
  current top-5 `{name, arr}` list, e.g. `Cedar Health` at `$107,722.92`.
- Clicked "Cedar Health" in the Top Accounts panel (Person path):
  - Activity log: `Person — set account filter to Cedar Health (clicked top accounts)`.
  - ARR card: `$0.11M` (Cedar Health's own ARR only). ARR-mix donut:
    100% Enterprise (Cedar Health's segment). CAC card: unchanged
    ($8,504) — confirms CAC still never filters. NRR: 128% (a single
    account's own trailing-12 change — expected to be a more extreme
    number than a cohort average, which is fine for a drill-down view).
  - Top Accounts panel itself still listed all 5 accounts (Cedar Health
    highlighted) rather than collapsing to one row — confirms the picker
    reads segment/region/plan-filtered data with `accountName` excluded,
    per the design in AGENTS.md.
  - Clicked "Cedar Health" again: filter chip disappeared, dropdowns and
    KPIs reverted to the unfiltered view. Toggle-off works.
- Agent path: `set_report_filters.execute({ patch: { accountName: 'Cedar Health' } })`
  → `{ ok: true, data: { segment: 'all', region: 'all', planTier: 'all', accountName: 'Cedar Health' } }`,
  and `get_report_context` immediately after agreed.
- `set_report_filters.execute({ patch: { accountName: '' } })` →
  `{ ok: false, reason: 'invalid_value', error: '"accountName" must be a non-empty string, got "".' }`
  — empty string correctly rejected (would otherwise have matched no
  customer and looked like a silent no-op rather than an error).

## Schema version

`DashboardState.filters` gained `accountName`, so `SCHEMA_VERSION` in
`chartState.ts` was bumped 2 → 3. Verified directly: wrote a synthetic v2
snapshot to `localStorage` (`segment: 'Enterprise'`, `arr_bridge.windowMonths: 24`,
no `accountName` key) and reloaded. `get_report_context` came back with
full defaults (`filters.segment: 'all'`, `arr_bridge.windowMonths: 12`) —
the stale snapshot was discarded outright, not partially trusted into a
broken `filters.accountName === undefined` state.
