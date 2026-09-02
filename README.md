# Vivid

Vivid is an agent-and-presenter co-editing demo. A presenter screen-shares a
real analytics dashboard on a call; an AI agent reshapes the live chart in
front of the viewer via browser-native WebMCP tools
(`document.modelContext.registerTool`) — no MCP server, no vision model,
just validated tool calls against shared, persisted state (Supabase; see
below). The current
build is "Northbeam," a fictional B2B SaaS company's revenue dashboard — one
report, not a general chart builder.

## Status

**Phase 1 built**: the six-panel Northbeam dashboard renders from real
generated CSVs (`data/customers.csv`, `data/mrr_monthly.csv`).

**Phase 2 built**: WebMCP tools (`get_report_context`, `list_report_options`,
`update_chart_spec`, `find_field_values`) scoped to the ARR bridge and
retention panels, persistence + undo, and the Person/Agent activity log.

**Shared persistence built**: dashboard state and the activity log live in
Supabase (Postgres) instead of localStorage, synced to every open viewer in
realtime — see [AGENTS.md](AGENTS.md)'s Persistence entry and
[src/lib/chartState.ts](src/lib/chartState.ts) /
[src/lib/activityLog.ts](src/lib/activityLog.ts). Undo stays local per
browser (not centralized — see AGENTS.md).

**Phase 3 built**: functional segment/region/plan filters — dropdowns plus
click-to-filter on the ARR-mix donut and net-new-logos heatmap — that
cross-filter all six panels, settable by a person or by the agent via the
`set_report_filters` WebMCP tool. See [AGENTS.md](AGENTS.md)'s "Explicit
scope" section for the authoritative phase breakdown, and
[evidence/](evidence/) for the manual verification log.

**Second and third reports built** (on explicit direction — see AGENTS.md):
a People report and a Product Usage report, switchable via tabs in the
topbar next to the original Revenue report. Both are static/non-interactive
(no WebMCP tools, no filters, no persistence) — reusing the same design
system and four generalized display primitives (`Donut`, `RankedBarList`,
`Heatmap`, `Histogram`) the Revenue report's panels were generalized into.

## Tech stack

- Vite + React + TypeScript
- Vega-Lite + vega-embed (ARR bridge + retention panels only — the two
  agent-editable ones)
- Plain SVG/CSS for the rest
- Supabase (Postgres + Realtime) for shared dashboard state and the activity
  log — no custom backend, the browser talks to it directly
- ponytail plugin active in this repo (project-scoped — see
  [.claude/settings.json](.claude/settings.json))

## Getting started

```
npm install
node scripts/generate-data.mjs          # writes data/customers.csv + mrr_monthly.csv + cac_monthly.json
node scripts/generate-people-data.mjs   # writes data/employees.csv
node scripts/generate-usage-data.mjs    # writes data/reports.csv + report_views_monthly.csv + activity_heatmap.json
npm run dev
```

Also needs a `.env.local` (gitignored) with a Supabase project's URL and
publishable key:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key>
```

The project needs the `dashboard_state` and `activity_log` tables from
AGENTS.md's Persistence entry, with `report_id = 'northbeam'` seeded and
both tables added to the `supabase_realtime` publication.

## Project structure

```
.
├── .claude/settings.json    # ponytail enabled, project-scoped
├── README.md                # this file
├── AGENTS.md                 # architecture decisions + scope
├── HANDOFF.md                 # historical, see AGENTS.md
├── scripts/                  # three deterministic data generators, each with a self-check
├── data/                     # generated CSVs/JSON for all three reports
└── src/
    ├── lib/                  # data loading, metrics, Vega-Lite spec builders
    └── components/            # dashboard panels
```

## More context

Architecture decisions and scope live in [AGENTS.md](AGENTS.md).
[HANDOFF.md](HANDOFF.md) has the original project pivot rationale
(historical, from InkPlot).
