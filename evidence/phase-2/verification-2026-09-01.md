# Phase 2 verification — 2026-09-01

## Method

No WebMCP-capable browser (an extension/build that injects
`document.modelContext` at `document_start`) was available in this
environment. To still drive the real registration path rather than testing
the tool logic in isolation, I injected a minimal polyfill for
`document.modelContext.registerTool` via devtools, then called
`window.__vividRegisterTools()` — a small re-entry point added in
[App.tsx](../../src/App.tsx) for exactly this purpose, since a real WebMCP
browser would inject `modelContext` before the app's mount effect runs, but
a same-tab devtools injection happens after. Everything past that point —
discovery, execution, return values, the chart, localStorage, and the
activity log — is the live app, unmodified.

```js
window.__registeredTools = {};
document.modelContext = {
  registerTool(t) {
    window.__registeredTools[t.name] = t;
    return () => { delete window.__registeredTools[t.name]; };
  },
};
window.__vividRegisterTools();
```

## 1. Inspect the tools the page exposes

`Object.keys(window.__registeredTools)` →
`["get_report_context", "list_report_options", "update_chart_spec", "find_field_values"]`.
All four match the draft contract in [AGENTS.md](../../AGENTS.md).

## 2. Call the read-only context tool

`get_report_context.execute({})` → `{ ok: true, data: { reportId: "northbeam", charts: {...}, fields: {...}, filters: {...} } }`.
`charts` returned the current knob state for all three agent-editable chart
ids (`arr_bridge`, `retention_nrr`, `retention_churn`); `fields` listed each
chart's underlying data fields; `filters` reported the static (non-functional)
pill values with `functional: false`, honestly reflecting that Filters isn't
wired (explicit Phase 1 scope).

`list_report_options.execute({ chartId: 'arr_bridge' })` returned the fixed
`mark: "bar"` plus the enum/range allow-list for `windowMonths`,
`positiveColor`, `negativeColor`, `barWidth` — the same allow-list
`update_chart_spec` validates against.

## 3. Call the mutating tool with a valid request

`update_chart_spec.execute({ chartId: 'arr_bridge', patch: { windowMonths: 24, positiveColor: 'cat3' } })`
→ `{ ok: true, data: { windowMonths: 24, positiveColor: "cat3", negativeColor: "critical", barWidth: 0.62 } }`.

Confirmed all three agree:
- **Chart**: screenshot showed the ARR bridge switched from a 12-month to a
  24-month floating waterfall (`$0.98M → $4.18M`), bars now teal instead of green.
- **localStorage** (`vivid:report:northbeam`): `charts.arr_bridge` matched the
  tool's return value exactly, with `schemaVersion: 1`.
- **Activity log**: one new `Agent — called update_chart_spec` line, and only
  one — see the double-invocation bug below.

## 4. Call it again with an invalid request

Three invalid calls, each rejected without mutating state:

| input | `reason` |
|---|---|
| `{ chartId: 'arr_bridge', patch: { barWidth: 5 } }` | `invalid_value` (range 0.4–0.8) |
| `{ chartId: 'retention_nrr', patch: { mark: 'bar' } }` | `unknown_field` (mark is fixed, not patchable — enforces the "never dual-axis" invariant) |
| `{ chartId: 'kpi_row', patch: { windowMonths: 6 } }` | `unknown_chart` (confirms the four hand-rolled panels are genuinely outside the tool surface) |

`localStorage.charts.arr_bridge` was byte-identical before and after all
three — no partial/silent mutation on rejection.

## 5. Confirm chart, log, and return value agree

Reconfirmed after undo (see bugs below): `get_report_context` output,
`localStorage`, and the rendered chart matched at every step.

`find_field_values` was also exercised — always a guess, never an error:

| phrase | resolved |
|---|---|
| "make it red" | `{ field: "color", value: "critical" }` |
| "sky blue please" | `{ field: "color", value: "brand" }` |
| "last two years" | `{ field: "windowMonths", value: 24 }` |
| "six months" | `{ field: "windowMonths", value: 6 }` |
| "gibberish xyz" | `{ field: "windowMonths", value: 12 }` (fallback default) |

## Bugs found and fixed during this pass

1. **Activity log card inflated the retention mini-charts to ~515px.**
   Placing the new `<ActivityLog>` inside the right-hand `.stack` grew that
   column, and `.grid { align-items: stretch }` stretched the left column
   (ARR bridge + Retention) to match, so the retention line charts' `flex:1`
   filled way more vertical space than intended. Fixed by moving the log to
   its own full-width row below `.grid` instead of capping chart height
   (capping left dead space in the card instead — the stretch-to-fill sizing
   is Phase 1's existing layout, not something to redesign here).

2. **`handleUndo` double-fired under React StrictMode.** The undo handler
   originally read the undo stack and ran its side effects (`setChartState`,
   `saveChartState`, `addLog`) *inside* the `setUndoStack` updater function.
   StrictMode intentionally double-invokes updater functions in dev to catch
   impurity like this — one click produced two identical activity-log lines.
   Fixed by reading/writing through a plain `undoStackRef` and keeping the
   updater pure (`setUndoStack(stack.slice(0, -1))`), matching the pattern
   already used for `chartStateRef`.

3. **`applyPatch` could silently drop a patch when two tool calls landed
   back-to-back with no render committed between them**, because it read
   `chartStateRef.current` for merging but that ref was only refreshed by
   the component's render body — which hadn't necessarily run yet. Fixed by
   writing `chartStateRef.current` (and `undoStackRef.current`) synchronously
   at the point of mutation, so they're the authoritative source of truth
   `applyPatch` reads from, not "whatever the last render saw." Verified with
   two immediate patches to `retention_nrr` (`lineColor` then `windowMonths`)
   — both landed in the final state.

## Persistence and undo

- Fresh `localStorage` (no key) → `get_report_context` returns
  `DEFAULT_CHART_STATE`.
- A snapshot with `schemaVersion: 99` (simulating an incompatible future
  version) → correctly ignored, defaults used instead of the stale
  `windowMonths: 24` it contained.
- Two sequential patches to `retention_nrr` → undo stack showed `(2)`; one
  click reverted `{windowMonths: 6, lineColor: "cat2"}` back to
  `{windowMonths: 12, lineColor: "brand"}` (state from *before* the first
  patch — single stack, no redo, confirmed by the button going to `(0)` and
  disabling).

## Not covered

This pass didn't test concurrent agent + person edits interleaving in the
same tick, or `find_field_values` phrases beyond the table above. Both are
low-risk given the architecture (single `chartStateRef` source of truth,
small synonym table) but are worth a follow-up pass if the tool surface
grows.
