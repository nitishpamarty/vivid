# Governed Revenue Chart Editing — Implementation Plan

## Purpose

Enable safe in-place editing of curated Revenue panels by reusing the new
Connect Data / Agentic Exploration Canvas patterns. This replaces the earlier
plan, which assumed that chart contracts, query safety, canvas cards, and
persistence had not yet been built.

This is not arbitrary chart authoring. The application keeps ownership of
Revenue metrics, active filters, calculation, rendering, persistence, and
safety invariants. A person or agent can choose only chart-specific,
pre-approved presentations.

## Current baseline to reuse

The roadmap at `docs/agentic-exploration-canvas-roadmap.md` and its current
implementation provide:

- Versioned, validated, intent-only Connect Data chart contracts and app-owned
  Vega-Lite construction (`src/lib/datasets.ts`).
- Typed governed aggregate queries, an explicit relationship catalog, a
  bounded aggregate Edge Function, and query WebMCP tools.
- Canvas cards, validators, WebMCP card tools, and a persisted collaboration
  model with version checks and audit records.
- Reusable WebMCP cleanup and polyfill-based registration test patterns.

Revenue should reuse those **patterns**—contract versioning, structured
validation, tool registration, atomic state changes, testing conventions—not
the canvas UI or aggregate-query execution. The ARR bridge and retention
metrics are curated report calculations, not generic aggregate charts.

## Product boundary

| Surface | Job | Owner of data/rendering |
|---|---|---|
| Connect Data | Create governed new chart cards from datasets/semantic queries. | Canvas query + chart pipeline. |
| Revenue report | Change approved presentations of fixed curated panels. | Revenue metrics + panel adapters. |

Revenue uses a local adapter registry, not raw Vega specifications or a
cross-report framework.

## Non-negotiable rules

- Read `AGENTS.md` before every task.
- No raw SQL, raw Vega/Vega-Lite, data values, URLs, transforms, config,
  expressions, arbitrary fields, or arbitrary aggregation in Revenue tools.
- Existing filters continue to feed every approved alternate view.
- ARR bridge remains a floating waterfall; NRR and churn remain distinct
  small-multiple line charts; heatmaps remain diverging for negative values.
- Top Accounts remains a stable top-five picker that ignores `accountName`.
- Accepted edits use the existing shared-room snapshot/version/undo/activity
  pipeline. There is no second state store.
- Connect Data, People, and Product Usage are not to be modified for this
  work. Do not add dependencies or commit.

## Target contract and flow

```ts
type ReportChartContract =
  | { version: 1; chartId: 'arr_mix'; presentation: 'donut' | 'bar' }
  | { version: 1; chartId: 'top_accounts'; presentation: 'ranked_list' | 'bar' }
  | { version: 1; chartId: 'net_new_logos'; presentation: 'heatmap' | 'bar' }
  | { version: 1; chartId: 'arr_bridge'; presentation: 'waterfall' }
  | { version: 1; chartId: 'retention_nrr'; presentation: 'line' }
  | { version: 1; chartId: 'retention_churn'; presentation: 'line' };
```

```text
set_report_chart_contract(chartId, contract)
        -> Revenue adapter registry + validator
        -> existing DashboardState / room version / undo / log
        -> current filtered Revenue metric selector
        -> approved SVG/CSS or existing Vega-Lite renderer
```

The fixed chart entries make discovery consistent, but the validator rejects
any change that would alter their invariant presentation.

## Dependencies and parallelism

```text
Phase 0: audit + contract decision
            -> Phase 1: registry/state/tool foundation
            -> Phase 2: ARR Mix pilot
            -> Phase 3: Top Accounts ─┐
               Phase 4: Net New Logos ┴-> Phase 5: integration/evidence
```

- Run 0, 1, and 2 sequentially.
- Run 3 and 4 in parallel only after 2 is merged; use separate worktrees from
  the same commit.
- Run 5 after both parallel branches merge.
- Never run two tasks against the same checkout concurrently.

## Phase 0 — Audit and contract decision

**Sequential; no feature changes.**

### Deliverable

A concise decision note under `docs/` defining the Revenue adapter registry,
state migration, tool compatibility, and test matrix.

### Prompt

```text
In /Users/nitish/projects/vivid, perform Phase 0 of
EDITABLE_CHARTS_IMPLEMENTATION_PLAN.md.

Read AGENTS.md, this plan, and docs/agentic-exploration-canvas-roadmap.md in
full. Inspect current Connect Data chart contracts, validators, canvas tools,
persistence, WebMCP cleanup/tests, plus Revenue chartState, report tools,
shared state, undo, and activity logging. Existing work may be uncommitted;
preserve it.

Do not implement a user-facing feature. Add a concise evidence-backed decision
note under docs/ that defines:
1. Which Connect Data mechanisms Revenue reuses directly (versioning,
   validation result shape, cleanup helper, tool test pattern) and which it
   must not reuse (canvas UI, generic aggregate queries, raw Vega semantics).
2. The exact ReportChartContract union and allowed presentation values for
   arr_bridge, retention_nrr, retention_churn, arr_mix, top_accounts, and
   net_new_logos.
3. A Revenue-local adapter registry shape: default, validator, renderer
   selection, and invariant per chart.
4. How this belongs in existing DashboardState without another state store.
5. The transition strategy for get_report_context, list_report_options,
   update_chart_spec, and filters. Do not leave competing mutable write paths.
6. Migration/rollback risks and focused tests.

Do not change behavior, migrations, registrations, or production data. Run
read-only checks needed for evidence. Do not commit. Report the note path,
files inspected, and checks run.
```

## Phase 1 — Revenue registry, state, and WebMCP foundation

**Sequential after the Phase 0 decision is accepted.**

### Deliverable

One validated Revenue contract source of truth inside the existing shared
snapshot, plus discovery/read/write WebMCP APIs. Defaults exactly preserve
today's visuals.

### Prompt

```text
Implement Phase 1 of EDITABLE_CHARTS_IMPLEMENTATION_PLAN.md in
/Users/nitish/projects/vivid.

Read AGENTS.md, this plan, and the accepted Phase 0 decision note. Inspect
Connect Data's validation, WebMCP cleanup, and tests for patterns only; do not
copy the canvas or aggregate-query system into Revenue.

1. Add the approved versioned ReportChartContract and a small Revenue-local
   adapter registry for all six Revenue chart ids.
2. Put those contracts in the existing DashboardState, with defaults that
   render exactly as today. Use existing shared room persistence, versioning,
   undo, and activity log; create no parallel state or endpoint.
3. Implement pure strict validation with structured results. Reject unknown
   keys/versions/ids/presentations and all raw-spec/data/query escape hatches
   atomically.
4. Implement the Phase-0-decided tool surface (expected:
   list_report_chart_options, get_report_chart_contract,
   set_report_chart_contract), reusing safe cleanup and polyfill tests.
5. Preserve/migrate legacy tools exactly as the decision note specifies, with
   one mutable source of truth.
6. Do not alter rendered behavior yet. Fixed ARR/retention variants must reject
   incompatible presentation changes.
7. Add focused validation, registration, persistence, remote update, undo, and
   exactly-once log tests. Run relevant tests, typecheck, build, and
   git diff --check.

Do not touch Connect Data, People, Product Usage, migrations, dependencies, or
commit. Report files changed and verification results.
```

## Phase 2 — ARR Mix pilot

**Sequential after Phase 1.**

### Deliverable

ARR Mix supports its existing donut and a bar presentation from the exact same
filtered channel/ARR values.

### Prompt

```text
Implement Phase 2 of EDITABLE_CHARTS_IMPLEMENTATION_PLAN.md in
/Users/nitish/projects/vivid.

Read AGENTS.md, this plan, and completed Phases 0/1. Inspect the actual
adapter registry/state/tool path and ArrMixDonut/Donut before editing. Treat
Phase 1 as stable.

Implement arr_mix's approved donut/bar presentations only:
- Use only the Phase 1 contract. No generic field selection, query input,
  aggregation, raw Vega, values, URL, or transforms.
- Keep donut as default and preserve current labels, percentages, color
  semantics, accessibility, and responsive behavior.
- Add an accessible, deterministic, labeled bar view using the same filtered
  acquisition-channel ARR metrics.
- Preserve click-channel-to-filter and click-again-to-clear in both views;
  active selection cannot rely on color alone.
- Confirm a WebMCP mutation updates visible UI, shared snapshot, reload state,
  undo, and one activity event.
- Add focused tests for both render modes, unchanged filtered metric derivation,
  interactions, persistence/undo, and invalid-contract rejection.

Run tests, typecheck, build, git diff --check, and a shared-link manual check
if available. Do not touch other panels, Connect Data, schema, dependencies,
or commit. Report results.
```

## Phase 3 — Top Accounts adapter

**Parallel with Phase 4 only after Phase 2; separate worktree.**

### Deliverable

Top Accounts supports `ranked_list` and `bar` without losing its stable top-five
picker semantics.

### Prompt

```text
Implement Phase 3 of EDITABLE_CHARTS_IMPLEMENTATION_PLAN.md in a separate
worktree based on the completed Phase 2 commit.

Read AGENTS.md, this plan, and completed Phase 0/1/2 work. Another task may
edit Net New Logos in parallel; avoid shared foundation files and report any
integration-sensitive changes.

Add only the top_accounts adapter:
- Permit ranked_list and bar; name/current ARR are fixed semantics. Reject
  arbitrary fields, measures, queries, sort expressions, raw specs, or data.
- Preserve the intentional stable-picker rule: top five respects all report
  filters except its own accountName filter.
- Preserve click-account-to-set accountName and click-again-to-clear in both
  views, with accessible selection state.
- Bar view is deterministic, responsive, labeled, and uses the same filtered
  top-five values.
- Route every mutation through the Phase 1 contract/state/tool/persistence/
  undo/log path.
- Add focused validation, stable-picker, interaction, and shared-state/undo
  tests. Run tests, typecheck, build, and git diff --check.

Do not touch arr_mix, net_new_logos, fixed charts, Connect Data, schema,
dependencies, or commit. Report isolated and integration-sensitive files.
```

## Phase 4 — Net New Logos adapter

**Parallel with Phase 3 only after Phase 2; separate worktree.**

### Deliverable

Net New Logos supports its existing diverging heatmap and a bar view aggregated
by region over the same six-month filtered window.

### Prompt

```text
Implement Phase 4 of EDITABLE_CHARTS_IMPLEMENTATION_PLAN.md in a separate
worktree based on the completed Phase 2 commit.

Read AGENTS.md, this plan, and completed Phase 0/1/2 work. Another task may
edit Top Accounts in parallel; avoid shared foundation files and report any
integration-sensitive changes.

Add only the net_new_logos adapter:
- Permit heatmap and bar. Keep heatmap default and diverging because values can
  be negative.
- Bar is the sum by region over the identical existing filtered last-six-month
  net-new-logo data; it is not a new query or date range. Label negatives and
  zero clearly.
- Preserve click-region-to-filter and click-again-to-clear in both views with
  accessible active state.
- Contract input cannot change metric, period, aggregation, colors through
  arbitrary values, fields, query, raw spec, URL, transform, or config.
- Use the Phase 1 state/tool/persistence/undo/log path only.
- Add focused validation, negative/diverging, six-month aggregation,
  interaction, and shared-state/undo tests. Run tests, typecheck, build, and
  git diff --check.

Do not touch arr_mix, top_accounts, fixed charts, Connect Data, schema,
dependencies, or commit. Report isolated and integration-sensitive files.
```

## Phase 5 — Integration and verification evidence

**Sequential after Phases 3 and 4 merge.**

### Prompt

```text
Implement Phase 5 of EDITABLE_CHARTS_IMPLEMENTATION_PLAN.md in
/Users/nitish/projects/vivid after Phases 1–4 merge.

Read AGENTS.md, this plan, the Phase 0 decision note, and all merged changes.
This is integration and verification only: do not add panels, generic chart
authoring, schema changes, or Connect Data features.

1. Review registry, validators, DashboardState, shared-state transport, undo,
   log, and WebMCP registration. Remove accidental duplicate state/write paths.
2. Verify discovery/read for all six chart IDs. Verify writes are limited to
   arr_mix donut/bar, top_accounts ranked_list/bar, and net_new_logos
   heatmap/bar. Verify ARR bridge/retention reject incompatible changes.
3. Verify legacy tool compatibility as specified by Phase 0.
4. Run an end-to-end shared-link flow: change each editable panel, apply
   report filters, reload, observe a second session if available, undo each
   mutation, and check activity records.
5. Run full relevant tests, typecheck, production build, and git diff --check.
   Fix only integration defects found. Add a concise evidence report under
   evidence/ with commands, outcomes, invariants, and prerequisites.

Do not alter Connect Data's contracts/query/canvas/persistence to make Revenue
more generic. Do not commit. Report final tool inventory, files, verification,
and required deployment action.
```

## Completion criteria

- Connect Data remains the canonical governed surface for creating new charts.
- Revenue has one adapter registry and one shared DashboardState source of
  truth for approved panel presentations.
- ARR Mix, Top Accounts, and Net New Logos preserve their data/filter behavior
  in every approved representation.
- All mutations are validated, atomic, persisted, synchronized, undoable, and
  audited; no raw SQL/spec/data escape hatch is introduced.
- People and Product Usage stay out of scope.
