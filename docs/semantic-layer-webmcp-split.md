# Splitting the semantic layer from the visualization WebMCP tools

## Why

`src/lib/registerWebMcpTools.ts` currently registers one flat tool list that
mixes two unrelated concerns under one `ToolBridge`:

- **Chart/report tools**: `get_report_context`, `list_report_options`,
  `update_chart_spec`, `set_report_filters`, `find_account_values`,
  `find_field_values` — all operate on the two agent-editable charts
  (`arr_bridge`, `retention_nrr`, `retention_churn`) and report-wide filters.
  These are inherently page-scoped: they read/write live chart state in the
  browser tab.
- **Semantic layer tools**: `get_business_definitions`, `query_business_metric`
  — thin wrappers around `semanticLayerClient.ts` (Cube-backed). Nothing about
  these needs the chart or the page; they're a metric/dimension knowledge
  service that happens to be registered from the same file.

Today a chart's fields (`REPORT_FIELDS`, e.g. `arr_bridge: ['label', 'month',
'delta', ...]`) are synthetic UI field names with **no relationship** to a
Cube measure/dimension name (e.g. `mrr_cube.mrr`). An agent asking "what does
ARR mean, and is this chart showing it correctly" has no way to connect the
two today — it can call `get_report_context` and get chart knobs, or call
`get_business_definitions` and get Cube metadata, but nothing tells it these
describe the same underlying number.

Splitting the file only helps if we also (a) prove the two tool sets are
independently reusable, and (b) give the agent a shared vocabulary so it can
chain calls across them without being told to.

## Goals

1. **Independence**: semantic-layer tools have zero import from chart/canvas
   code, and vice versa. Either could be dropped into an unrelated page.
2. **Zero end-user config**: both tool sets stay WebMCP, registered from the
   page the user already has open. No separate MCP connector setup — that
   breaks the "open a URL, it just works" requirement for regular users.
3. **Bidirectional chaining in one turn**: the agent can go chart → semantic
   layer ("what does this chart's metric mean") and semantic layer → chart
   ("resolve/validate this before writing a chart update") without a second
   prompt from the user.
4. **Optional secondary transport**: the same Cube-backed logic can also be
   exposed as a standalone MCP server later, for power users who *do*
   configure MCP directly (Claude Desktop, etc.) — proving semantic layer
   portability beyond this frontend, and proving MCP + WebMCP are
   complementary, not either/or.

## Shared key format

This is the actual coupling point once the code is split — a naming
contract, not an import.

**Adopt the Cube member name as the canonical key everywhere a metric or
dimension is referenced across tool boundaries**: `"<cube>.<field>"`, e.g.
`"mrr_cube.mrr"`, `"accounts_cube.region"`. This format already exists —
`semanticMetadata.ts`'s `memberName()` produces it, and every
`SemanticMeasureDefinition` / `SemanticDimensionDefinition` /
`SemanticFilterDefinition.member` already carries it. We're not inventing a
new format, just requiring the chart side to speak it too.

Concretely:

- `list_report_options` / `get_report_context` gain a `metricKey` (and
  `dimensionKeys` where relevant) alongside each chart's existing UI field
  names, e.g. `arr_bridge` reports `metricKey: "mrr_cube.mrr"` next to its
  `delta`/`newCum`/`priorCum` knob fields. This is a static mapping (chart id
  → Cube member name) maintained by hand in `chartState.ts` or a new small
  `chartSemanticKeys.ts` — there are only 3 charts, this does not need to be
  derived or configurable.
- `get_business_definitions` / a future `get_metric_definition(key)` accept
  and return the same `"<cube>.<field>"` string.
- Any tool that returns a metric value (chart tools and semantic tools alike)
  tags it with this key rather than only a display label, so the agent never
  has to fuzzy-match "ARR" against "Annual Recurring Revenue" across tool
  boundaries.

No new types needed — `SemanticFilterDefinition.member` already is this
string; we're just threading it through the chart-facing tools too.

## The two directions

**Chart → semantic** (already partly possible, needs the shared key):
Agent inspects a chart (`get_report_context`), gets back `metricKey:
"mrr_cube.mrr"` for `arr_bridge`, then calls `get_business_definitions` (or a
future targeted `get_metric_definition`) with that key to get the
definition/description/aggregation. Two tool calls, one turn, no user
re-prompt — this already works today for parallel tool use; it just needs the
key to be present in the chart tool's response.

**Semantic → chart** (new — validate/resolve before mutating):
Before `update_chart_spec` or `set_report_filters` writes a value the agent
derived from a semantic-layer answer (e.g. "set the filter to the region with
highest MRR"), the agent should be able to confirm the value is one
`list_report_options`/`set_report_filters` will accept. This doesn't need new
machinery beyond what exists: `list_report_options` and
`find_field_values`/`find_account_values` already return the allow-listed
values; the semantic tools' job is only to supply the *decision* (which
region), and the chart tools' existing validators (`validatePatch`,
`validateFilterPatch`) remain the enforcement point. No chart tool should
call the semantic layer directly — the agent is the one composing both;
keeping the tools blind to each other is what makes them independently
reusable per Goal 1.

## Phased plan

### Phase 1 — Split the file, no behavior change
- Move `get_business_definitions` / `query_business_metric` out of
  `registerWebMcpTools.ts` into a new `registerSemanticWebMcpTools.ts`,
  taking only `{ getBusinessDefinitions, queryBusinessMetric }` from
  `semanticLayerClient.ts` — no `ChartId`/`chartState` import.
- `registerWebMcpTools.ts` keeps the chart/report/filter tools and drops the
  `SemanticLayerResult` import and the two semantic entries from `ToolBridge`.
- Both register independently against `document.modelContext` (same pattern
  as today — two `registerTool` loops instead of one). Call both from
  wherever `registerNorthbeamTools` is currently invoked (App-level bridge
  setup); order doesn't matter, the model sees one flat tool list either way.
- Update/split the corresponding test file. No UI or persistence changes.

### Phase 2 — Shared metric key
- Add the static chart-id → Cube-member-name mapping (3 entries) and surface
  `metricKey` in `get_report_context`'s and `list_report_options`'s chart
  output.
- Update `get_business_definitions`'s description (and add
  `get_metric_definition(key)` as a single-metric lookup if
  `get_business_definitions`'s full payload proves too large for routine
  lookups — start without it, add only if needed).
- Extend the semantic tool descriptions to state the key format explicitly
  and give a worked example ("chart tools return `metricKey` in this same
  `cube.field` format — pass it straight through").

### Phase 3 — Verify bidirectional chaining
- Manual test: ask "what is the ARR metric on this chart and is that number
  right for EMEA?" in one prompt against the running app; confirm the agent
  calls `get_report_context` → `get_business_definitions` (or
  `get_metric_definition`) → `query_business_metric` without a re-prompt.
- Manual test: ask something that requires resolving a value semantically
  then writing it back (e.g. "filter the report to the region with the
  highest MRR"); confirm the agent calls `query_business_metric` →
  `find_field_values`/`list_report_options` → `set_report_filters`.
- Add a `registerSemanticWebMcpTools.test.ts` assertion that the tool
  descriptions/schemas are independent of any chart import (a cheap guard
  against re-coupling: the test file itself importing `chartState` would be
  the tell).

### Phase 4 (optional, later) — Standalone MCP server for the same backend
- Only if/when there's a concrete power-user need (e.g. an analyst wants
  Claude Desktop access without opening the web app). Wrap the same Cube
  query logic (`semanticLayerClient`'s `invoke`, currently behind the
  `semantic-layer` Supabase edge function) in a small MCP server exposing the
  same tool names/schemas as `registerSemanticWebMcpTools.ts`.
- This is additive and requires user-side connector configuration — it is
  explicitly *not* part of the zero-config end-user flow, and should be
  described to users as an optional path, not the primary one.

## What this does not require

- No new dependency, no build step change, no new file beyond the one split
  file and (maybe, Phase 2) one small mapping file.
- No change to `queryContract.ts` / `query_dataset_aggregate` — that's a
  separate, already-independent tool for the raw usage dataset and is out of
  scope here.
