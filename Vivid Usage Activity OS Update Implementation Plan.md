# Vivid Usage Activity OS Update Implementation Plan

## Decision

Keep the Revenue report, keep Product Usage, and remove the People report from
the report switcher. Product Usage will be redesigned around the Activity OS
concept so it no longer mirrors Revenue's KPI-card + donut + ranked-list
composition.

Revenue remains unchanged in this pass. Its visual redesign will be a separate
decision after the Product Usage update is reviewed.

## Product Usage: Activity OS implementation

### Layout

1. Keep the shared Northbeam topbar, but give Product Usage its own dark,
   activity-oriented visual theme.
2. Replace the four `KpiCard` components with a compact pulse strip showing
   Views, Unique Viewers, and Average Engagement. Active Reports can remain in
   the period/context line rather than becoming another card.
3. Make the activity heatmap the primary visual on the left.
4. Add a full-width usage-momentum line chart using the existing monthly view
   totals from October 2023 through the latest month.
5. Keep Most Viewed Reports on the right, but use simple horizontal bars rather
   than a card-heavy ranking treatment.
6. Replace the owning-team donut with horizontal share bars.
7. Put Engagement Spread—the existing five engagement bins (0–20 through
   80–100)—in the right column directly beside Usage Momentum. The right column
   should stack Most Viewed Reports, owning-team share, and Engagement Spread so
   it reaches approximately the same bottom edge as the left column and does
   not leave a separate unused row.
8. Do not add the previously explored Attention versus Depth scatterplot.

### Code shape

- Update `src/components/UsageDashboard.tsx` to use the Activity OS composition
  and remove the `Donut` dependency.
- Keep the existing metric helpers for KPIs, activity, engagement bins, top
  reports, and team totals.
- Add only the small report-specific calculation needed for the monthly trend.
  Avoid creating a generalized dashboard framework.
- Add focused chart markup/components only where the SVG logic becomes too
  large for `UsageDashboard.tsx`.
- Add a Product Usage theme/layout block in `src/App.css`, leaving Revenue's
  styling and WebMCP behavior untouched.
- Update the Product Usage subtitle and panel labels to match the Activity OS
  language.

## Remove the People report

- Remove `people` from `ReportId` and the `REPORTS` array in
  `src/components/Topbar.tsx`.
- Remove the People branch/import and People data loading from `src/App.tsx`.
- Remove the now-unused client-side People implementation:
  `src/components/PeopleDashboard.tsx`, `src/lib/peopleMetrics.ts`,
  `loadPeopleData`, and dead `PeopleData`/`Employee` client types.
- Remove the People-only theme block from `src/App.css`.
- Update `README.md` and `AGENTS.md` so the product surface describes Revenue,
  Product Usage, and the separate Connect Data surface.

The employee CSV, generator, and Supabase `employees` dataset stay in place:
Connect Data still exposes that table, so removing the People report must not
break the generic data-connection surface.

## Verification

1. Run `npm run build`, `npm test`, and `npm run lint`.
2. Smoke-test a fresh session: the tabs show Revenue, Product Usage, and
   Connect Data only.
3. Verify Product Usage values still match the generated data: 1,565 views,
   674 unique viewers, 63 average engagement, 20 active reports, the existing
   activity grid, top-five reports, and team shares.
4. Verify the Activity OS layout at desktop and narrow widths with no clipped
   chart labels or horizontal overflow.
5. Confirm Revenue WebMCP tools, filters, persistence, undo, activity logging,
   and Connect Data behavior are unchanged.

## Suggested implementation order

1. Remove the People client route and dead imports/types.
2. Implement the Activity OS Product Usage layout and charts.
3. Apply the Product Usage-specific theme and copy.
4. Update architecture/project documentation.
5. Run the verification suite and review the live result before making any
   Revenue visual changes.
