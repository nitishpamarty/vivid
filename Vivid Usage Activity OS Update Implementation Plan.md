# Vivid Product Usage Interactivity and WebMCP Update Implementation Plan

## Status and scope

This is the implementation plan for the next Product Usage / Activity OS
update. It is intentionally a plan only: no production code is changed by
this document update.

The Activity OS redesign has already been executed. This next pass will make
it feel like part of the Vivid analytics workspace by reusing the Revenue
report's visual grammar, shared-session behavior, and interaction conventions
while keeping Product Usage visually and analytically distinct.

People is already removed and is not part of this plan. Connect Data remains a
separate surface, and its `employees` dataset must remain available.

## Recommended product decision

Keep the existing Activity OS chart set:

- usage pulse: Views, Unique Viewers, Average Engagement;
- activity heatmap;
- Usage Momentum line chart;
- Reports Drawing Attention ranked bars;
- Where Usage Comes From team-share bars;
- Engagement Spread histogram.

Add report-wide Product Usage filters, click actions, shared persistence,
person/agent activity logging, and a dedicated WebMCP tool set. Do not add raw
Vega-Lite chart editing to Product Usage: these charts should remain derived
from validated data and filters, preserving the project's “chart-as-data, not
chart-as-code” boundary.

The visual direction is “same workspace, different mode”:

- Reuse the Revenue shell, topbar, toolbar placement, typography hierarchy,
  spacing rhythm, border treatment, native select behavior, live-session
  status, and Undo placement.
- Keep Activity OS's dark, activity-oriented canvas and dense two-column layout
  so it does not become a duplicate of Revenue's light KPI-card / waterfall /
  donut composition.
- Use the shared Vivid brand blue as the primary accent, with scoped dark-mode
  surface tokens and a small supporting cyan/green range for activity states.
  Avoid unrelated hardcoded colors spread through JSX.
- Use selection styling consistently: active filter pills, a highlighted team
  row or report row, subdued non-selected marks, and an obvious “All” reset
  state.

## Product Usage state and filter contract

Create a Product Usage-specific state contract rather than reusing Revenue's
customer filter type. This keeps the two reports explicit and prevents
Revenue-only fields from leaking into the Usage tool contract.

```ts
type UsageFilters = {
  ownerTeam: Department | 'all';
  reportId: string | 'all';
  asOfMonth: string;
};

type UsageDashboardState = {
  filters: UsageFilters;
};
```

Defaults:

- `ownerTeam: 'all'`;
- `reportId: 'all'`;
- `asOfMonth`: the latest generated month.

Filter semantics:

- `ownerTeam` filters reports by their owning team.
- `reportId` filters to one exact saved report. The UI may display the report
  name, but state and validation should use the canonical id.
- `asOfMonth` limits view-based metrics to data on or before the selected
  month. The Usage Momentum chart ends at that month; current-period KPIs,
  rankings, team shares, and engagement spread use that same month.
- The activity heatmap remains unchanged by these filters. The source data is
  a synthetic typical-week aggregate deliberately not tied to a report,
  owner team, or date range. Label it accordingly, for example “Typical week ·
  all usage,” rather than implying that it cross-filters.

Use `all` values for categorical reset behavior, matching Revenue. Validate
every field and value, reject unknown keys atomically, and return the same
machine-readable `{ ok, reason, error }` shape used elsewhere in the project.

## UI and interaction plan

### Shared structure, Product Usage identity

1. Keep the existing topbar and Activity OS header.
2. Add a Product Usage toolbar row directly below the topbar/session status,
   using the same native pill-select treatment as Revenue.
3. Add three controls: Owner Team, Report, and As of Month. Keep them compact;
   do not create a second heavy KPI-card row.
4. Keep the pulse strip, but align its typography, numeric formatting, borders,
   and responsive behavior with Revenue's KPI treatment.
5. Preserve the current Activity OS chart composition and order:
   heatmap and momentum on the left; ranked reports, team shares, and
   engagement spread stacked on the right so both columns finish at roughly
   the same vertical edge.
6. Rework the usage CSS into scoped theme tokens under `.usage-os`, reusing
   shared layout variables where possible. Product Usage should feel related to
   Revenue without copying Revenue's light card surface, donut, or chart
   arrangement.

### Click actions

- Clicking an owning-team share row toggles `ownerTeam` between that team and
  `all`.
- Clicking a ranked report row toggles `reportId` between that report and
  `all`.
- Dropdown changes and chart clicks must use the same
  `applyUsageFilterPatch` path so person actions have one validation,
  persistence, and activity-log behavior.
- Show active filters as removable chips when the selected value is not
  `all`; the chip uses the same clear behavior as selecting “All.”
- Keep the Person-lane Undo action available and scoped to Product Usage
  edits. Do not silently make agent undo available; that would change the
  existing Revenue trust contract and should be a separate decision.
- Do not make the activity heatmap clickable until the underlying data has a
  report/team/date dimension. Do not imply that engagement-bin clicks filter
  the source unless an explicit engagement filter is added to the data
  contract.

### Empty and narrow states

Define the zero-result behavior before implementation: zero views, zero unique
viewers, zero engagement, empty rankings, and an empty momentum series should
render a calm “No usage for this selection” state rather than `NaN`, broken
bars, or a blank page. The unfiltered state must preserve the current
Activity OS values.

At narrow widths, stack the toolbar controls without horizontal overflow, then
stack the two chart columns. Keep report names ellipsized with accessible full
labels and keep heatmap labels readable.

## Data and metric implementation

Add a focused `src/lib/usageFilters.ts` module containing:

- `UsageFilters` and `UsageDashboardState` types;
- default state and allowed values derived from the actual Usage data;
- filter-patch validation;
- a pure function that scopes view rows by owner team, report, and as-of
  month while leaving the global activity grid explicit;
- helpers for available report/team/month options.

Extend `src/lib/usageMetrics.ts` only as needed to consume the scoped view
rows. Keep the existing metric names and chart meanings. Make latest-month,
previous-month, and empty-series handling explicit; do not make a filtered
report appear to have usage before its `createdMonth`.

Recommended implementation boundaries:

- `src/components/UsageFilters.tsx`: Product Usage controls and active chips;
- `src/components/UsageDashboard.tsx`: state wiring, click actions, scoped
  metrics, and existing Activity OS rendering;
- `src/lib/usageFilters.ts`: validation and filtering;
- `src/lib/usageMetrics.ts`: small filter-aware aggregation additions;
- `src/App.css`: shared-workspace-aligned but scoped Product Usage styling.

Avoid a generalized dashboard registry or a generalized filter framework for
this pass. Revenue and Product Usage should share only small, already-proven
infrastructure seams.

## Shared session, persistence, and activity log

The current shared-state backend is deliberately hardcoded to the Revenue
`northbeam` report. To give Product Usage the same trustworthy interaction
model, extend that infrastructure with an allow-listed `product_usage` report
namespace rather than duplicating a second persistence system.

Required backend/client work:

1. Add a Product Usage row to the shared `dashboard_state` and
   `activity_log` report-id allow-list. Keep the two report states separate in
   the same room.
2. Generalize the shared-state client, Edge Function request, and server RPC
   calls to carry an explicit report id, accepting only `northbeam` or
   `product_usage`.
3. Preserve Revenue's current chart/filter validation exactly. Add a separate
   usage filter mutation branch with its own schema and human-readable
   activity messages such as “updated Product Usage filters.”
4. Add a Product Usage schema version and default state. Do not attempt to
   decode a Usage state as `DashboardState` or allow Revenue chart patches to
   reach it.
5. Reuse the existing optimistic version check, bearer-capability flow,
   realtime subscription, activity-log query, and remote-change invalidation.
6. Give Product Usage its own short Undo stack/state lifecycle, or extract only
   the smallest typed helper needed to share the existing Undo behavior. Undo
   must restore a validated `UsageDashboardState` and remain person-triggered.
7. Reuse `ActivityLog` visually, with report-specific loading/subscription so
   Usage activity does not appear in Revenue's log.

This plan assumes shared-session parity is desired because the request calls
for the same kind of interaction as the first report. If the product decision
is intentionally local-only for Usage, the backend/RPC steps can be omitted,
but then the UI should explicitly say Product Usage filters are local to the
current browser and should not advertise the same live-session behavior as
Revenue.

## Dedicated Product Usage WebMCP integration

Create `src/lib/registerUsageWebMcpTools.ts` instead of adding Usage-specific
branches to the Revenue registration module. Register these tools only while
Product Usage is the active tab, and unregister them on tab switch/unmount:

- `get_usage_context` — returns report id, current Usage filters, selected
  month, current KPIs, visible top reports, team shares, available options,
  and the explicit global scope of the activity heatmap.
- `list_usage_options` — returns the allow-list for `ownerTeam`, `reportId`,
  and `asOfMonth`, plus the supported click actions.
- `set_usage_filters` — validates an atomic patch and applies it as an agent
  mutation. Use `all` to clear categorical filters.
- `find_usage_values` — resolves a phrase to exact canonical team/report
  values so an agent can discover a report id without receiving the whole
  catalog in every context response.

Tool behavior requirements:

- Return `{ ok: true, data }` or `{ ok: false, reason, error }` for every
  call.
- Reject unknown fields, unknown team values, unknown report ids, malformed
  months, and empty patches before any shared mutation.
- Keep the current Revenue tool names and behavior unchanged while Revenue is
  active. Do not register duplicate generic names such as
  `get_report_context` from both report surfaces at once; use the explicit
  `get_usage_*` namespace for Product Usage.
- Preserve the existing `window.__vividRegisterTools` devtools re-entry hook
  for verification in browsers without native WebMCP, if that hook remains
  necessary.
- Do not expose `update_chart_spec` or raw chart JSON for Product Usage.
- Leave the semantic-layer tools (`get_business_definitions` and
  `query_business_metric`) unchanged; they already cover open-ended business
  questions over report-view data and should not be duplicated as UI tools.

Likely files:

- `src/lib/registerUsageWebMcpTools.ts`;
- `src/lib/webmcpCleanup.ts` and existing WebMCP ambient types, reused rather
  than replaced;
- `src/App.tsx`, to mount the Usage lifecycle beside the existing Revenue
  lifecycle;
- shared-state client/protocol, Edge Function, and RPC migration files for
  the report-id-aware mutations.

## Verification plan

### Unit and contract tests

Add tests for:

- default Usage state and every valid filter value;
- unknown-field, invalid-value, malformed-month, and empty-patch rejection;
- owner-team, report, and as-of-month scoping;
- filter toggles and reset-to-`all` behavior;
- filtered KPI/ranking/chart inputs and zero-result safety;
- the invariant that the typical-week activity grid is not presented as
  filtered by report/team/month;
- WebMCP registration, tool cleanup, input validation, success/error result
  shapes, and no duplicate Revenue/Usage registrations;
- shared-state report-id routing and Usage-only undo restore validation.

### Local checks

Run:

```text
npm run build
npm test
npm run lint
```

### Browser/session smoke test

1. Start a fresh shared session and confirm Revenue still loads with its
   existing filters, chart tools, persistence, Undo, and activity log.
2. Switch to Product Usage and confirm the toolbar, live-session state, Usage
   activity log, and Undo appear without Revenue state leaking into the tab.
3. Change Owner Team, Report, and As of Month independently; verify every
   view-based KPI and chart agrees with the selected scope.
4. Click a team row and a top-report row; verify the same filters appear as if
   selected from the toolbar, including toggle-off behavior.
5. Use the browser WebMCP polyfill to call `get_usage_context`,
   `list_usage_options`, `find_usage_values`, and `set_usage_filters`; verify
   the UI and activity log update from the real execute functions.
6. Open the same room in a second browser/session and verify Product Usage
   filter changes, versions, activity events, and remote Undo invalidation.
7. Switch between Revenue, Product Usage, and Connect Data repeatedly; verify
   WebMCP cleanup, no duplicate tools, and no regressions in Connect Data.
8. Check desktop, tablet, and mobile widths for readable labels, no clipped
   charts, and no horizontal overflow.

## Implementation order

1. Write the Usage state/filter contract and pure metric-scope tests.
2. Extend report-id-aware shared persistence and activity-log routing while
   preserving the current Revenue paths and validation.
3. Add Usage filter controls, scoped metrics, click actions, empty states, and
   Person-lane Undo.
4. Add the dedicated Product Usage WebMCP registration and lifecycle cleanup.
5. Align the Activity OS styling with the shared Vivid shell while preserving
   its dark, activity-first identity.
6. Update `README.md` and `AGENTS.md` after the implementation is verified so
   the source-of-truth documentation describes Product Usage as interactive
   and WebMCP-connected.
7. Run the full verification plan and review the live result before making any
   additional visual changes.
