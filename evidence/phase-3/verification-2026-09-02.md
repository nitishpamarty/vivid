# Phase 3 verification — 2026-09-02

Covers the new `set_report_filters` tool and the click-to-filter
interactions added to the ARR-mix donut and net-new-logos heatmap. Uses
the same devtools polyfill method as
[evidence/phase-2/verification-2026-09-01.md](../phase-2/verification-2026-09-01.md)
(no WebMCP-capable browser was available) — see that file for the
injection snippet, not repeated here.

## Person path: dropdowns and click-to-filter

- Loaded the dashboard fresh (cleared `localStorage`), all three filter
  dropdowns showed "All ...".
- Clicked "Enterprise" in the ARR-mix donut legend. Confirmed: the
  segment dropdown updated to "Enterprise" (and got the `.active`
  highlight), the donut redrew to a solid 100% Enterprise ring, ARR
  dropped from $4.18M to $1.80M, the ARR bridge redrew for
  Enterprise-only deltas, CAC stayed at $9,240 (unfiltered, as designed —
  it has no segment breakdown), and the activity log recorded
  `Person — set segment filter to Enterprise (clicked ARR mix)`.
- Clicked "Enterprise" again — toggled back to "all", log recorded
  `Person — cleared segment filter (clicked ARR mix)`. Confirms the
  toggle-off UX (click the active selection again to clear) works.
- Clicked "EMEA" in the heatmap row label — region dropdown updated to
  "EMEA", log recorded the click-driven change. Same code path as the
  donut (`applyFilterPatch`), confirming click-to-filter and the dropdown
  are two entry points into one piece of state, not two systems.

## Agent path: `set_report_filters`

- `list_report_options.execute({})` → included a `filters` key with the
  segment/region/planTier enum allow-lists (`all` plus each real value).
- `set_report_filters.execute({ patch: { planTier: 'Business' } })` →
  `{ ok: true, data: { segment: 'all', region: 'all', planTier: 'Business' } }`.
  `get_report_context` immediately after agreed.
- `set_report_filters.execute({ patch: { segment: 'Nonexistent' } })` →
  `{ ok: false, reason: 'invalid_value', error: '"segment" must be one of all, SMB, Mid-Market, Enterprise, got "Nonexistent".' }`.
  Filters unchanged after.
- Combined undo: `update_chart_spec` (arr_bridge → windowMonths 24) then
  `set_report_filters` (region → LATAM), then one undo. Result: region
  reverted to `all`, `windowMonths` stayed at 24 — confirms undo is one
  shared stack across chart knobs and filters, reverting only the most
  recent edit regardless of which kind it was.

## `find_field_values` — segment/region phrases

Extended in this phase to resolve segment/region synonyms, not just
color/window. Tested:

| phrase | resolved |
|---|---|
| "just show APAC" | `{ field: "region", value: "APAC" }` |
| "mid market customers" | `{ field: "segment", value: "Mid-Market" }` |
| "smb only" | `{ field: "segment", value: "SMB" }` |
| "north america please" | `{ field: "region", value: "NA" }` |
| "europe" | `{ field: "region", value: "EMEA" }` |
| "latin america deals" | `{ field: "region", value: "LATAM" }` |
| "enterprise accounts" | `{ field: "segment", value: "Enterprise" }` |

## Bug found and fixed during this pass

**`find_field_values` false-matched on short synonyms.** The resolver
used plain `.includes()` for substring matching. The region synonym
`"us"` (→ NA) matched *inside* unrelated words — `"just show APAC"`
resolved to `{ field: "region", value: "NA" }` (from "**us**t"), and
`"mid market customers"` did the same (from "c**us**tomers"). Root cause:
naive substring containment has no concept of word boundaries. Fixed by
adding a shared `hasWord()` helper (word-boundary regex) and switching
every synonym table — region, segment, and the pre-existing color and
number-word tables — to use it, rather than patching only the specific
case that got caught. Also fixed a related latent bug the same pass
exposed: `"twenty"` was checked before `"twenty-four"` in the number-word
table, and a hyphen counts as a word boundary, so `"twenty-four months"`
would have matched `"twenty"` first (harmless here only by coincidence,
since both round to the same nearest window value of 24) — fixed by
trying longer keys first. Re-ran the full phrase table above plus the
original Phase 2 phrases (color/window) after the fix; all resolved
correctly.

## Edge case: a filter combination matching zero customers

`set_report_filters.execute({ patch: { segment: 'SMB', region: 'LATAM', planTier: 'Enterprise' } })`
— a combination no customer in the dataset satisfies.

- No crash, no console error, on a fresh tab.
- ARR: `$0.00M`, `+0% YoY` (guarded — see below).
- NRR: `NaN%` — pre-existing Phase 1 behavior (`nrrTrailing12` already
  returns `NaN` for a zero-base cohort); left as is rather than masking a
  behavior that already existed before this phase.
- Top accounts / heatmap / donut: empty/zero, no crash.

Two fixes landed for this path, both root-caused rather than patched at
the call site:

1. **`Sparkline` crashed on an empty `values` array** (`last[0]` on
   `undefined`) — this was reachable before Phase 3 too (any KPI spark
   array could theoretically be empty), but filters made it realistically
   reachable for the first time. Fixed with a one-line early return in
   `Sparkline.tsx` itself, so every caller is protected, not just the
   filtered-KPI path.
2. **`arrGrowthYoY` was `NaN` (0/0) when the filtered ARR a year ago and
   now are both zero** — guarded in `computeKpis` (`metrics.ts`) to
   return `0` instead. NRR's own NaN case was deliberately left alone
   (see above) since it's not something this phase introduced.

## Not covered

Three-way-and-beyond filter combinations weren't tested exhaustively —
only the zero-match case above. `find_field_values` phrase resolution for
`planTier` was intentionally not built (see AGENTS.md scope note: SMB and
Enterprise segment/plan-tier names collide, and no panel visualizes plan
tier for a click-to-filter interaction), so phrases like "business plan
only" fall through to the windowMonths default rather than resolving —
that's expected, not a bug, but worth knowing if extending this later.
