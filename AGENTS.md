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
- **Persistence (Phase 2, built):** one whole-dashboard JSON snapshot per
  report id (`DashboardState` = chart knobs + filters, see
  [src/lib/chartState.ts](src/lib/chartState.ts)), written to localStorage
  on every successful mutating tool call, read back on load with a schema
  version check (an unrecognized version falls back to defaults rather
  than trusting stale shape — bumped to v2 when Phase 3 added `filters` to
  the snapshot, then v3 when `accountName` was added to `filters`; an
  older snapshot is correctly discarded, not migrated).
- **Undo (Phase 2, built):** the last ~10 snapshots kept in an array
  alongside the current one; undo pops the stack. Single stack, no
  branching redo, and it covers filter changes too — one undo after an
  agent chart edit and a person filter click reverts only the filter
  click. Triggered by a Person-lane "Undo" button in the topbar toolbar
  row.
- **Person/Agent activity log (Phase 2, built — [src/components/ActivityLog.tsx](src/components/ActivityLog.tsx)):**
  a dual-lane log that only records an "Agent" line when a real
  `registerTool` execute function actually ran — never a
  simulated/predicted call. This is the trust mechanism for the live-call
  scenario.
- **Functional filters + cross-filtering (Phase 3, built —
  [src/lib/reportFilters.ts](src/lib/reportFilters.ts)):** four
  report-wide filters (`segment`, `region`, `planTier`, `accountName`),
  settable by either a person or the agent, that subset the underlying
  customer/mrr rows feeding all six panels — not just the two
  agent-editable charts.
  - `segment`/`region`/`planTier` are small closed enums — the topbar's
    three `<select>` dropdowns (native elements, not custom pickers — a
    "clear" is just picking "All ..."), or clicking a segment in the
    ARR-mix donut / a region row in the net-new-logos heatmap (clicking
    the already-active one toggles back to "all").
  - `accountName` is free text (any customer name, not a closed enum),
    set by clicking a row in Top Accounts (toggle-off the same way) — a
    single-account drill-down, not a category cross-filter. Top Accounts
    itself always lists the top 5 for the current segment/region/plan
    (ignoring its own `accountName` filter), so it stays a stable picker
    you can switch between instead of collapsing to one row once
    something is selected. `get_report_context` exposes the current top-5
    `{name, arr}` list so the agent has the exact strings
    `set_report_filters.accountName` accepts, rather than needing to
    fuzzy-match a company name itself.
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
  `signup_month`, `churn_month`
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

## Explicit scope

**Built (Phase 1):** the six-panel Northbeam dashboard rendering from real
generated data, static/non-interactive, one report only. Dev server:
`npm install && node scripts/generate-data.mjs && npm run dev`.

**Built (Phase 2):** WebMCP tool registration (`get_report_context`,
`list_report_options`, `update_chart_spec`, `find_field_values`), scoped to
the ARR bridge and retention panels; localStorage persistence + undo; the
Person/Agent activity log.

**Built (Phase 3):** functional segment/region/planTier filters
(dropdowns + click-to-filter on the ARR-mix donut and net-new-logos
heatmap), cross-filtering all six panels; the `set_report_filters` WebMCP
tool so the agent can set the same filters; undo/persistence extended to
cover filter state alongside chart knobs.

**Explicitly deferred, do not build without a new decision:**
- a second dataset or second report
- any general-purpose report abstraction beyond what one report needs
- letting the WebMCP tool surface treat any of the four hand-rolled panels
  as a patchable chart spec — `arr_bridge`/`retention_nrr`/`retention_churn`
  remain the only `update_chart_spec` chart ids. `set_report_filters`
  cross-filters all six panels' underlying data, which is a different
  thing from turning the four hand-rolled ones into agent-editable Vega
  specs — that line hasn't moved.

## Working style note

ponytail is enabled project-scope (see
[.claude/settings.json](.claude/settings.json)) — default to the smallest
correct implementation, no speculative abstraction for a future second
report until there's an actual second report.
