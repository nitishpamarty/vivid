# Semantic/WebMCP split — Phase 3 verification — 2026-09-02

Covers [docs/semantic-layer-webmcp-split.md](../../docs/semantic-layer-webmcp-split.md)'s
Phase 3 (bidirectional chaining). Phases 1 and 2 were confirmed already built before
this pass: `registerSemanticWebMcpTools.ts` has zero `chartState`/`ChartId` import,
`registerWebMcpTools.ts` has zero semantic import, and `metricKey` (Cube member format)
is threaded through `get_report_context`/`list_report_options`.

## Method

No WebMCP-capable browser (an extension/build that injects `document.modelContext` at
`document_start`) was available in this environment — same constraint as
[evidence/phase-2/verification-2026-09-01.md](../phase-2/verification-2026-09-01.md).
Used the same devtools polyfill + `window.__vividRegisterTools()` re-entry point, which
drives the real registration/discovery/execution path, not the tool logic in isolation.

Acted as the agent myself: read only the eight registered tools' `name`/`description`
pairs (never the split doc's phased plan, which names the exact tool sequence), then
chose which tool to call next after each result — reproducing what an LLM WebMCP client
does when given an open-ended prompt and a flat tool list, without being told which tool
to use.

## Blocker hit and fixed before this pass could run at all

The dashboard never got past "Start live session" — the `shared-state` Edge Function's
`create_room` RPC 503'd (`{"ok":false,"reason":"unavailable"}`) on every attempt. Root
cause: the remote Supabase project only had migrations `0001`–`0003` applied, but
`0006_product_usage_shared_state.sql` redefines `create_room`/`mutate_room` to take a
`p_report_id` parameter that `supabase/functions/shared-state/index.ts` already assumes
exists — a genuine migration-drift bug that would have blocked production, not just this
verification pass. `supabase db push` also uncovered a second, independent bug blocking
0004 from ever applying: `field in ('customer_id',)` / `field in ('mrr',)` in
[0004_query_aggregate_rpc.sql](../../supabase/migrations/0004_query_aggregate_rpc.sql) —
a trailing comma making it an invalid single-element SQL list literal. Fixed to plain
`field = '...'` comparisons, then pushed 0004–0006 successfully
(`supabase migration list` now shows `local`/`remote` in sync through 0006). See the
chat transcript for the full diagnosis; not repeated here since it's a database/infra fix,
not part of the semantic-split feature itself.

## Tools discovered

```
get_report_context, list_report_options, update_chart_spec, set_report_filters,
find_account_values, find_field_values, get_business_definitions, query_business_metric
```

All eight registered from one call to `registerAll()` (both `registerNorthbeamTools` and
`registerSemanticWebMcpTools` fire from the same App-level effect), confirming Goal 2
(zero end-user config, one flat tool list) still holds after the split.

## Direction 1 — chart → semantic

Prompt simulated: *"what is the ARR metric on this chart and is that number right for
EMEA?"*

Chain chosen from tool descriptions alone, no re-prompting:

1. `get_report_context.execute({})` → `arr_bridge.metricKey = "mrr_monthly.total_mrr"`.
2. `get_business_definitions.execute({})` → confirmed `mrr_monthly.total_mrr` exists in
   the schema (`type: "number"`, `aggregation: "sum"`), grounding the metric before
   querying it — exactly the tool's stated purpose ("ground an open-ended business
   question here before... calling query_business_metric").
3. `query_business_metric.execute({ query: { measures: ["mrr_monthly.total_mrr"], filters: [{ member: "customers.region", operator: "equals", values: ["EMEA"] }] } })`
   → `{ ok: true, data: { data: [{ "mrr_monthly.total_mrr": "1332844.81" }] } }`.

**Result: PASS.** `get_report_context` → `get_business_definitions` → `query_business_metric`,
using the shared `metricKey` verbatim, no chart-tool knowledge needed by the semantic
tools and vice versa. Notable: `mrr_monthly`'s own definition lists `relationships: []`
and no `region` dimension, yet the `customers.region` filter still resolved correctly —
Cube's actual data model has the join even though the definitions payload doesn't surface
it as a `relationships` entry. Not a bug in the split (out of scope for this doc), but
worth flagging if `get_business_definitions`'s `relationships` field is ever relied on to
decide whether a cross-cube filter is legal.

## Direction 2 — semantic → chart

Prompt simulated: *"filter the report to the region with the highest MRR"*

Chain chosen from tool descriptions alone, no re-prompting:

1. `query_business_metric.execute({ query: { measures: ["mrr_monthly.total_mrr"], dimensions: ["customers.region"] } })`
   → NA `1856748.65` > EMEA `1332844.81` > APAC `699909.57` > LATAM `616024.02`. Decision:
   NA.
2. `list_report_options.execute({})` → confirmed `"NA"` is in the `region` filter's enum
   allow-list (used this over `find_field_values` since the semantic layer already
   returned the canonical value `"NA"`, not a free-text phrase needing resolution —
   `find_field_values` is for the latter).
3. `set_report_filters.execute({ patch: { region: "NA" } })` →
   `{ ok: true, data: { region: "NA", ... } }`.

**Result: PASS.** `query_business_metric` → `list_report_options` → `set_report_filters`.
Confirmed the write landed in the live shared session, not just the tool's return value:
- Region dropdown showed "NA" selected, highlighted.
- Session version incremented `v0 → v1`, Undo button went from disabled to `(1)`.
- ARR bridge redrew for NA-only ($3.99M → $1.64M, "$0.80M → $1.64M" floating range).
- ARR mix donut and top-accounts list both changed to NA-filtered composition.

## Guard test

Added to
[registerSemanticWebMcpTools.test.ts](../../src/lib/registerSemanticWebMcpTools.test.ts):
a source-scan asserting the file's own text has no `from '...chartState...'` import —
cheap, catches re-coupling even if a future edit adds the import without using it in a
way existing tests would exercise. All 7 tests in the file pass
(`node --experimental-strip-types --test`).

## Not covered

`find_account_values`/`find_field_values` weren't exercised as part of either chain in
this pass (neither prompt required free-text resolution — the semantic layer's own
region values were already canonical). Both are already covered by Phase 3 (filters)
evidence at [evidence/phase-3/](../phase-3/).
