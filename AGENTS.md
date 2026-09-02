# AGENTS.md

This is the source of truth for architecture and scope in this repo,
superseding [HANDOFF.md](HANDOFF.md) (kept for historical pivot rationale
only). Read this before touching anything here.

## Purpose

Vivid proves out one thing: that an AI agent can reshape a live analytics
chart in front of a viewer through browser-native WebMCP tools
(`document.modelContext.registerTool`), with no MCP server, no vision model,
and no simulated calls — only validated tool calls against real state. It's
scoped to a single fictional report (Northbeam, a B2B SaaS revenue
dashboard) on purpose: prove the tool contract and the trust mechanics on
one report before generalizing to a report abstraction that could serve
more than one.

## Architecture decisions

- **Chart-as-data, not chart-as-code.** Only the ARR bridge and the
  NRR/churn retention panel are Vega-Lite specs (rendered via vega-embed) —
  these are the two panels a future WebMCP tool will patch. The KPI cards,
  ARR-mix donut, top-accounts list, and net-new-logos heatmap are
  derived/computed display components (hand-rolled SVG/CSS), not
  agent-editable specs, and should not become Vega-Lite specs without a
  deliberate decision to extend the tool contract.
- The ARR bridge is a true floating waterfall (bars span prior-cumulative to
  new-cumulative). Never build it as a bar+line dual-axis chart.
- NRR% and churn% are always rendered as two separate small-multiple line
  charts, each with its own axis — never overlaid on one shared/dual axis.
- The net-new-logos heatmap uses a diverging (not sequential) color scale,
  since net-new can go negative.
- **WebMCP tool contract (Phase 2, built — [src/lib/registerWebMcpTools.ts](src/lib/registerWebMcpTools.ts)):**
  scoped to the two agent-editable charts (`arr_bridge`, `retention_nrr`,
  `retention_churn` as chart ids). The state is a small knob object per
  chart ([src/lib/chartState.ts](src/lib/chartState.ts):`ChartState`) — the
  Vega-Lite spec is *derived* from it, never patched as raw JSON. Chart
  `mark` is fixed and not a patchable field, which is what enforces the
  "never dual-axis" invariants above at the validation layer, not just by
  convention.
  - `get_report_context` (read-only) — active report id, current chart
    knob state, available fields, active report-wide filters.
  - `list_report_options` (read-only) — the mark/field allow-list for the
    current report's charts, plus the filter allow-list.
  - `update_chart_spec` (mutating) — validated patch, atomic replace, one
    of the two agent-editable charts.
  - `set_report_filters` (mutating, Phase 3) — validated patch to the
    report-wide filters (`segment`, `region`, `planTier`, `accountName`);
    `"all"` clears one. Cross-filters all six panels, not just the two
    chart ids — see the Phase 3 bullet below.
  - `find_account_values` (read-only) — returns a short list of exact
    customer-name matches for account drill-down without expanding the
    default report context beyond its top five.
  - `find_field_values` (read-only) — resolves a phrase to a canonical
    field value (a chart knob or a filter); always returns its best
    guess, no ambiguity/clarification round-trip with the user.
  - Every tool call returns `{ ok: true, data }` or
    `{ ok: false, reason, error }` — a machine-readable reason code plus a
    human-readable message.
  - `document.modelContext` is a draft browser API with no shipped TS lib —
    see [src/lib/webmcp.d.ts](src/lib/webmcp.d.ts) for the ambient types
    this app relies on, and
    [evidence/phase-2/verification-2026-09-01.md](evidence/phase-2/verification-2026-09-01.md)
    for how the registration path was verified without a WebMCP-capable
    browser (a devtools-injected `document.modelContext` polyfill, driving
    the real `registerTool` execute functions).
- **Persistence and shared sessions (in progress):** one whole-dashboard
  JSON snapshot per room (`DashboardState` = chart knobs + filters, see
  [src/lib/chartState.ts](src/lib/chartState.ts)), with a monotonically
  increasing version. Reads and Supabase Realtime notifications are scoped by
  room id. Browser mutations go through the `shared-state` Edge Function and
  server-only Postgres RPC, which verifies a SHA-256 capability digest,
  compare-and-swaps the expected version, updates state, and inserts the
  activity row in one transaction. Direct anon/authenticated table writes are
  denied by RLS. This is a no-login bearer-link demo: anyone holding the link
  can edit, and the app cannot prove that an action came from a browser model.
  The capability itself is never persisted or logged. Expiry/cleanup is an
  operator responsibility; no scheduler is included.
- **Undo (Phase 2, built):** the last ~10 snapshots kept in an array
  alongside the current one; undo pops the stack. Single stack, no
  branching redo, and it covers filter changes too — one undo after an
  agent chart edit and a person filter click reverts only the filter
  click. Triggered by a Person-lane "Undo" button in the topbar toolbar
  row.
- **Person/Agent activity log (Phase 2, built — [src/components/ActivityLog.tsx](src/components/ActivityLog.tsx)):**
  a shared application audit trail. The server records one activity row per
  accepted person or WebMCP mutation; it is not tamper-proof agent provenance.
- **Functional filters + cross-filtering (Phase 3, built —
  [src/lib/reportFilters.ts](src/lib/reportFilters.ts); `channel`/
  `contractType` added afterward, on explicit direction):** six
  report-wide filters (`segment`, `region`, `planTier`, `channel`,
  `contractType`, `accountName`), settable by either a person or the
  agent, that subset the underlying customer/mrr rows feeding all six
  panels — not just the two agent-editable charts.
  - `segment`/`region`/`planTier`/`contractType` are small closed enums —
    four of the topbar's `<select>` dropdowns (native elements, not
    custom pickers — a "clear" is just picking "All ..."), or clicking a
    region row in the net-new-logos heatmap (clicking the already-active
    one toggles back to "all").
  - `channel` is also a closed enum but has **no dropdown** — it's set
    only by clicking a slice of the ARR-mix donut (same toggle-off
    pattern), the same click-only shape as `accountName`/Top Accounts.
    This is deliberate: the donut's dimension used to be `segment`, which
    sat right next to `segment`'s own filter dropdown and read as
    redundant. Swapping the donut to `channel` — a dimension with no
    dropdown twin — and moving `segment` off to dropdown-only fixed
    that, without touching `region` (which still doubles with the
    heatmap; only the donut/dropdown pairing was reported as confusing).
  - `accountName` is free text (any customer name, not a closed enum),
    set by clicking a row in Top Accounts (toggle-off the same way) — a
    single-account drill-down, not a category cross-filter. Top Accounts
    itself always lists the top 5 for the current segment/region/plan
    (ignoring its own `accountName` filter), so it stays a stable picker
    you can switch between instead of collapsing to one row once
    something is selected. `get_report_context` exposes the current top-5
    `{name, arr}` list, and the `find_account_values` read-only WebMCP tool
    returns up to eight exact matches for compact discovery. The validator
    accepts any exact known customer name, not only the visible top five.
  - Both paths — dropdown/click and `set_report_filters` — go through the
    exact same `applyFilterPatch`, so a Person-lane log line and an
    Agent-lane one look the same except for the actor.
  - CAC is deliberately **never** filtered — it has no
    customer/segment/region breakdown to filter by (see the data spec
    note below), so it stays constant regardless of active filters. A
    filter combination that matches zero customers degrades to a flat
    $0 chart/0% KPIs rather than crashing (verified in
    [evidence/phase-3/verification-2026-09-02.md](evidence/phase-3/verification-2026-09-02.md)) —
    `Sparkline` guards an empty series, and `arrGrowthYoY` guards a zero
    denominator; NRR's own NaN for a zero-base cohort is pre-existing
    Phase 1 behavior, left as is.
- **Connect Data (built, on explicit direction — [src/components/ExploreDashboard.tsx](src/components/ExploreDashboard.tsx),
  [src/lib/datasets.ts](src/lib/datasets.ts),
  [src/lib/registerExploreWebMcpTools.ts](src/lib/registerExploreWebMcpTools.ts)):**
  a 3rd, separate surface — not a generalization of the two report surfaces above,
  see the "Explicit scope" note below. Picks from a hardcoded catalog of 7
  real Postgres tables (Supabase; schema in
  [supabase/migrations/0001_connect_data.sql](supabase/migrations/0001_connect_data.sql),
  seeded by `scripts/seed-supabase.mjs`), infers each column's type from a
  sample row, and lets a person override a column's *display* type
  client-side (presentation-time cast only, not a schema change — resets on
  reload, labeled as such in the UI; a failed cast becomes `null` with a
  visible warning count, never `NaN`/`Invalid Date`). Rows are fetched
  ordered + capped at 500 with an honest sampled/total-count banner when a
  table is larger — never a silent truncation; exact server-side
  aggregation for large tables (e.g. `mrr_monthly`, ~8k rows) is the correct
  next increment, not built here.
  - **WebMCP tool contract**, same shape/discipline as the Northbeam one
    above: `list_datasets`, `connect_dataset`, `get_dataset_schema`,
    `set_column_display_type` (read/mutate the dataset side),
    `get_chart_contract`/`set_chart_contract` (the chart side).
  - The agent **never** supplies a raw Vega-Lite spec. `set_chart_contract`
    validates a small allow-listed contract (`mark`, `encoding` keyed by
    `x`/`y`/`color`/`theta`, optional `title`) — same "chart-as-data, not
    chart-as-code" invariant `chartState.ts` uses for the Northbeam knobs,
    applied generically instead of per-chart. Validation rejects any
    top-level key outside `mark`/`encoding`/`title` (so `data`/`url`/
    `transform`/`config` can never reach the chart), requires
    mark-appropriate channels (`arc` needs `theta`; `bar`/`line`/`point`
    need `x` and `y`), and requires `aggregate`/`bin` only on a
    `quantitative` channel. `buildVegaLiteSpec` in `datasets.ts` is the only
    place `data.values` is set, from the app's own cast rows — never
    agent-reachable.
  - No Supabase persistence/realtime for this surface — the contract and
    type overrides are local React state only. Its activity log is
    likewise local-only (reuses the `ActivityLog` component, no
    `activity_log` row written).
  - RLS: all 7 tables are read-only to the anon key (`for select using
    (true)`) — a blanket "anyone with the anon key can read all 7 fictional
    tables" policy, correct for this demo dataset, not the template if real
    customer data ever lands in these tables. The service-role key used to
    seed them is never written to a file — passed inline to
    `scripts/seed-supabase.mjs` only.
- **Visual design system:** dataviz skill's validated default palette
  (light theme, categorical/status/diverging colors as-is, no
  re-validation needed). Brand accent = series-1 blue `#2a78d6`, hardcoded
  (a "Northbeam" bespoke teal accent was prototyped via a topbar switcher
  and explicitly rejected; the switcher was removed once the decision was
  final). Typography: Sora (headers), IBM Plex
  Sans (body/UI), IBM Plex Mono (KPI/tabular figures). Canonical visual
  reference: https://claude.ai/code/artifact/83cd2ecd-4ede-4af5-bf86-613245bba22d
  — read it before touching layout/color/type, don't redesign from scratch.

## Data spec (generated — `scripts/generate-data.mjs`)

`data/` contains:

- `customers.csv`: `customer_id`, `name`, `segment`, `plan_tier`, `region`,
  `channel`, `contract_type`, `signup_month`, `churn_month`
- `mrr_monthly.csv`: `customer_id`, `month`, `mrr`, `is_new`,
  `is_expansion`, `is_contraction`, `is_churned`
- `cac_monthly.json`: `{ month, cac }[]` — blended CAC has no source columns
  in the two CSVs above (no marketing-spend field was in scope), so it's a
  synthetic curve, still not derived from customer/MRR rows, but a noisy
  rising one now rather than a smooth backsolved one (see below).

**Bottom-up simulation, not a target curve (revised — the exact-anchor
version below this note is superseded).** The original generator computed
each month's segment $ total from a smooth deterministic curve
(`arr[m]`/`segMix(m)`) and then uniformly rescaled every customer's MRR to
hit that total exactly. That's what made the retention panel's NRR/churn
trend lines (and the ARR bridge, on close inspection) look manufactured —
real per-customer noise existed underneath, but the rescale step washed it
back out at the aggregate level every month. On explicit direction, this
was replaced with a genuine bottom-up Monte Carlo simulation: each
customer's MRR follows its own random walk (segment-tuned mean drift +
noise, plus occasional larger expansion/contraction events), each customer
churns on its own independent probabilistic roll (segment-tuned base rate,
temporarily elevated during a "pricing change" window around months
19–21), and new signups arrive each month at a rate proportional to the
current base with a decelerating growth-rate schedule. **Nothing is
back-solved to hit an exact number anymore** — ARR, NRR, churn%, and mix%
all emerge from the simulation instead of being authored into it. The
generator is still fully deterministic (mulberry32 seeded PRNG, no
`Math.random()`), so re-runs are byte-identical, but re-running with
different `ECON`/`growthRate` constants will land on different numbers —
there are no anchor values to preserve. Read `scripts/generate-data.mjs`
directly for the current parameters rather than trusting a snapshot of
numbers here; its own self-check log (plausibility bounds, not exact
equality) prints the actual month-36 mix/churn/ARR/CAC on every run.

Five flavor-named accounts (Vantage Robotics, Cedar Health, Fable & Co,
Loom Systems, Praxis Freight) are still seeded as Enterprise customers
early, above the typical Enterprise starting range, with a small
persistent "flagship account" drift bonus — but they're a random walk on
top of that, not a target ARR, so they usually but not always land in the
final top 5 (the generator logs a note, not a failure, when fewer than 4
of 5 do). This is what "Vantage Robotics" etc. refer to in the UI and in
[evidence/](evidence/) — real, clickable customers in the generated data,
not hardcoded strings in the app.

Enums:
- `segment`: SMB | Mid-Market | Enterprise
- `plan_tier`: Starter | Team | Business | Enterprise
- `region`: NA | EMEA | APAC | LATAM
- `channel`: Paid | Organic | Referral | Partner — weighted pick per
  customer (40/32/18/10%), independent of segment
- `contract_type`: Monthly | Annual — Annual odds rise with segment
  (25% SMB, 55% Mid-Market, 85% Enterprise), same pattern as `pickPlan`

36 months of history (month 1 = Oct 2023, month 36 = Sep 2026). Segment mix
shifts upmarket over time both by new-signup weighting and by Enterprise's
higher per-account drift, landing around 45–55% Enterprise / 25–35%
Mid-Market / 15–25% SMB by $ at month 36 — a Enterprise-led mix story is
still the shape, just not a pinned percentage.

The `superstore-*.csv` files that used to sit at repo root (pre-pivot
InkPlot leftovers, see HANDOFF.md) have been removed — confirmed with the
user first, since they predated this session.

<details>
<summary>Superseded: the original exact-anchor spec (kept for history, not current)</summary>

Regenerate with `node scripts/generate-data.mjs`; it self-checks its own
rollups (ARR bridge, mix%, the 5 named accounts, churn%, heatmap, CAC) and
exits non-zero if any drift from the anchors below.

**NRR note:** the trailing-12 NRR series originally sketched into the mockup
(112, 109, 105, 101, 99, 96, 98, 101, 103, 105, 106, 108) is **not**
jointly achievable with the ARR-bridge deltas through any honest month-by-month
accounting — month 32 has NRR > 100% (existing customers net-expanding)
simultaneous with a −$20k total delta, which would require negative new-logo
revenue. The generator computed NRR for real off the customer/MRR rows
(trailing-12 cohort formula) and shaped it to match the *story* — a dip
through the pricing-change stretch, recovering to a ~108–116% range by
month 36 — without bit-matching the 12 original values.

Story arc: steady SMB-led growth months 1–24 (small base to $2.6M ARR,
Enterprise segment emerging from ~month 15), then months 25–36 followed
net-new-ARR deltas (in $k) of 150, 140, 160, 130, 90, 40, -60, -20, 110,
220, 260, 360 — a deliberate SMB churn dip at months 31–32 from a pricing
change, recovered by Enterprise expansion from month 33 — landing at
$4.18M ARR, 108% NRR, 2.3% logo churn, $9,240 blended CAC at month 36. Top
5 accounts by current ARR: Vantage Robotics ($312k), Cedar Health ($284k),
Fable & Co ($221k), Loom Systems ($198k), Praxis Freight ($176k). ARR mix
at month 36: Enterprise 43%, Mid-Market 35%, SMB 22%.

</details>

## Data spec — Employees dataset (generated — `scripts/generate-people-data.mjs`)

`data/employees.csv`: `employee_id`, `department`, `region`, `hire_month`,
`term_month`. One row per employee (a roster, not a monthly time series like
`mrr_monthly.csv`). It remains generated and loaded into Supabase because
Connect Data exposes it as one of its seven datasets; there is no People
dashboard or client-side People data loader.

Bottom-up monthly simulation like `generate-data.mjs`: 28 employees seeded
month 1, each month an independent attrition roll (~1.45%/mo base rate) and
a hiring batch sized off a decelerating growth curve (~7%/mo early to
~3.5%/mo late). No pricing-change-style event — steady growth/attrition
only. Lands around 85–95 active headcount by month 36 out of a ~110-120
total-ever-hired roster; the generator's self-check asserts a plausible
range, not an exact anchor (same philosophy as `generate-data.mjs`'s
post-rescale-removal version).

`department` (`Engineering | Sales | Customer Success | Marketing | Product
| People | Finance`) and `region` (reuses the Revenue report's `NA | EMEA |
APAC | LATAM` enum) are the only breakdown dimensions.

## Data spec — Product Usage report (generated — `scripts/generate-usage-data.mjs`)

- `data/reports.csv`: `report_id`, `name`, `owner_team`, `created_month` —
  20 fictional saved reports (e.g. "Pipeline Coverage", "Renewal Risk"),
  each owned by one of five teams, created at a random month 1–30.
- `data/report_views_monthly.csv`: `report_id`, `month`, `views`,
  `unique_viewers`, `engagement_score` — one row per report per month from
  its `created_month` through month 36, a per-report random walk in views
  with `unique_viewers` and `engagement_score` derived from it.
- `data/activity_heatmap.json`: `{ weekday, hourBucket, views }[]` — a
  synthetic, business-hours-weighted weekday × 6-hour-bucket activity
  pattern. This is deliberately **not** tied to `report_views_monthly.csv`
  or to a specific date range — it's an aggregate "typical week" shape (like
  the Tableau Server Content Analytics inspiration's calendar heatmap),
  not a per-report or per-date breakdown.

## Data spec — Connect Data tables (`supabase/migrations/0001_connect_data.sql`, seeded by `scripts/seed-supabase.mjs`)

Real Postgres tables mirroring the three Data spec sections above, one per
generated file: `customers`, `mrr_monthly`, `cac_monthly`, `employees`,
`reports`, `report_views_monthly`, `activity_heatmap`. Same columns as their
source CSV/JSON, snake_cased; month-granularity columns (`month`,
`signup_month`, `churn_month`, `hire_month`, `term_month`,
`created_month`) are real Postgres `date`, stored as the 1st of the month
(`"2023-10"` → `2023-10-01`), not left as text. Primary keys: single-column
where the source has a natural id (`customer_id`, `employee_id`,
`report_id`, `month` for `cac_monthly`), composite where it's a monthly
fact table (`(customer_id, month)`, `(report_id, month)`,
`(weekday, hour_bucket)`) — these are also `scripts/seed-supabase.mjs`'s
upsert conflict targets. Seeding is upsert-only, explicitly: it inserts/
updates by primary key but does not delete rows a re-run's source file no
longer has — fine for this deterministic, regenerated-in-place dataset;
`truncate table <name>;` first if a source file ever needs to shrink.

## Explicit scope

**Built (Phase 1):** the six-panel Northbeam dashboard rendering from real
generated data, static/non-interactive, one report only. Dev server:
`npm install && node scripts/generate-data.mjs && npm run dev`.

**Built (Phase 2):** WebMCP tool registration (`get_report_context`,
`list_report_options`, `update_chart_spec`, `find_account_values`,
`find_field_values`), scoped to
the ARR bridge and retention panels; shared room persistence + undo; the
Person/Agent activity log.

**Built (Phase 3):** functional segment/region/planTier filters
(dropdowns + click-to-filter on the ARR-mix donut and net-new-logos
heatmap), cross-filtering all six panels; the `set_report_filters` WebMCP
tool so the agent can set the same filters; undo/persistence extended to
cover filter state alongside chart knobs.

**Built (Product Usage, on explicit direction):** a static Activity OS
surface alongside Revenue, switched via `Topbar.tsx`. It uses a dark,
activity-oriented treatment with real generated-data pulse, heatmap, monthly
momentum, top reports, team shares, and engagement spread. It has no WebMCP
tools, filters, undo, or persistence. The former People report was removed;
its generated employees dataset remains for Connect Data.

**Built (Connect Data, on explicit direction):** a 3rd tab, separate from
the two report surfaces above — pick a real Postgres table, override a column's
display type, and an agent co-authors the resulting chart via a validated
contract (`set_chart_contract`), not a raw spec. See the Connect Data bullet
under "Architecture decisions" and its Data spec section above. This is
deliberately **not** the deferred "report-abstraction layer" below: no
  registry/plugin system, no reuse of the Revenue/Product Usage report shape,
  no WebMCP tools added to those reports — it's a distinct, generic
  surface that happens to sit behind a 3rd tab, not a third report.

**Explicitly deferred, do not build without a new decision:**
- letting the WebMCP tool surface treat any of the four hand-rolled Revenue
  panels as a patchable chart spec — `arr_bridge`/`retention_nrr`/`retention_churn`
  remain the only `update_chart_spec` chart ids. `set_report_filters`
  cross-filters all six Revenue panels' underlying data, which is a different
  thing from turning the four hand-rolled ones into agent-editable Vega
  specs — that line hasn't moved.
- WebMCP tools, filters, undo, or persistence for Product Usage — it is
  intentionally static for now.
- a general-purpose report-abstraction layer (registry/plugin system) for
  Revenue/Product Usage — two hand-coded report surfaces are still the
  current shape. Connect Data above
  is a separate, already-generic surface; it doesn't retroactively make this
  one a thing to build.
- migrating Revenue/Product Usage off local CSV/JSON onto Supabase — Connect
  Data added Postgres tables for its own 7 datasets, it didn't move the
  two report surfaces' data layer.
- persistence/realtime sync, server-side aggregation, arbitrary-CSV
  ingestion, or transforms beyond type casting for Connect Data itself —
  see the "Explicitly out of scope" list this feature shipped with (now
  folded into the bullets above and the Data spec section).

## Working style note

ponytail is enabled project-scope (see
[.claude/settings.json](.claude/settings.json)) — default to the smallest
correct implementation, no speculative abstraction for a future second
report until there's an actual second report.
