# Revenue chart editing — Phase 5 verification

Date: 2026-09-02

## Integration

- Started from Phase 3 commit `52fa38037a4501d032fd80106b2be5ac3cc379a5`.
- Cherry-picked Phase 4 commit `1503302d7a19a3e497e3ed1ef3891d64545a9d7b` as
  `f13bc8c`.
- Conflicts were limited to `src/App.tsx`, `src/App.css`, and
  `src/lib/reportChartContract.test.ts`. Resolution preserved Top Accounts'
  toggle path and rendering, added Net New Logos' toggle/bar path, retained
  both accessibility CSS rules, and kept both contract assertions.
- The Phase 0 Revenue decision note named by the plan is not present in this
  checkout or the project main branch. The operative contract is encoded by
  `src/lib/reportChartContract.ts` and its tests; no competing contract shape
  was introduced.

## Defect fixed

The client already sent `chart_contract` mutations, but the existing shared
`mutate_room` RPC did not handle that mutation kind. Migration
`0007_revenue_chart_contract_mutations.sql` adds the six-chart allow-list to
the same capability-checked, row-locked, compare-and-swap transaction. It
rejects unknown fields, versions, chart ids, and presentations, records one
activity event, and upgrades a legacy Revenue state to schema 5 when a
contract is first changed. No table, column, Connect Data, People, or Product
Usage behavior was changed.

The Phase 1 TypeScript compile defects found during integration were also
closed: validated state casts are explicit, the contract-map reducer is
type-safe, and Revenue WebMCP registration uses the same guarded browser
global pattern as the other registration modules.

## Tool inventory

Revenue registers exactly these nine tools while the Revenue tab is active:

`get_report_context`, `list_report_chart_options`,
`get_report_chart_contract`, `set_report_chart_contract`,
`list_report_options`, `update_chart_spec`, `set_report_filters`,
`find_account_values`, and `find_field_values`.

The contract path supports `arr_mix: donut|bar`, `top_accounts:
ranked_list|bar`, `net_new_logos: heatmap|bar`, and fixed `waterfall`, `line`,
and `line` presentations for ARR bridge, NRR, and churn respectively.

## Automated verification

| Command | Result |
| --- | --- |
| `npm install --ignore-scripts --no-audit --no-fund` | Pass; lockfile unchanged |
| `npm test` | Pass; 116 tests, 0 failures |
| `npm run build` | Pass; TypeScript and Vite production build |
| `npm run lint` | Pass |
| `git diff --check` | Pass |

Focused coverage includes all six contract reads/writes, rejection of
incompatible fixed presentations, raw-field/data/query escape hatches,
filtered six-month Net New Logos aggregation, negative/zero/positive bar
labels, accessible selection toggles, stable Top Accounts picker semantics,
schema-4 hydration, shared undo frames, and WebMCP cleanup.

## Browser / deployment prerequisite

The existing Chrome Vivid tab was inspected without changing browser state.
It showed the deployed Northbeam page, but the room reported “Shared session
unavailable,” so the requested production shared-link mutation/reload/second
session/undo loop is blocked and is not claimed as passed.

Before demonstrating or judging the change, apply migration 0007 to the
Supabase project, deploy the `shared-state` function if the SQL RPC is not
already current, publish the built Vivid assets, then rerun the shared-link
loop and verify one activity row per accepted contract/filter mutation.
