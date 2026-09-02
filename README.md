# Vivid

Vivid is an agent-and-presenter co-editing demo. A presenter screen-shares a
real analytics dashboard on a call; an AI agent reshapes the live chart in
front of the viewer via browser-native WebMCP tools
(`document.modelContext.registerTool`) — no MCP server, no vision model,
just validated tool calls against shared, persisted state (Supabase; see
below). The current
build is "Northbeam," a fictional B2B SaaS company's revenue dashboard — one
report, not a general chart builder. A separate "Connect Data" screen (see
below) adds a small generic chart surface over real Postgres tables, without
turning the three hand-coded reports into that abstraction themselves.

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

**Connect Data built** (on explicit direction — see AGENTS.md): a 4th,
separate "Connect Data" tab where you pick a real Postgres table (Supabase),
override a column's display type client-side, and a WebMCP tool bridge
(`list_datasets`, `connect_dataset`, `get_dataset_schema`,
`set_column_display_type`, `get_chart_contract`, `set_chart_contract`) lets
an agent co-author the resulting Vega-Lite chart — the agent supplies a
small validated *contract* (mark/encoding/title), never a raw spec; the app
owns the actual chart data. See
[src/lib/datasets.ts](src/lib/datasets.ts) and
[src/lib/registerExploreWebMcpTools.ts](src/lib/registerExploreWebMcpTools.ts).
This is a separate surface from the three reports above, not a
generalization of them — see AGENTS.md's "Connect Data" section.

## Tech stack

- Vite + React + TypeScript
- Vega-Lite + vega-embed (ARR bridge + retention panels only — the two
  agent-editable ones)
- Plain SVG/CSS for the rest
- Supabase (Postgres + Realtime) for shared dashboard state and the activity
  log, and (separately) for the 7 real tables the Connect Data screen reads
  — no custom backend, the browser talks to it directly
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

For the Connect Data tab, also run
[supabase/migrations/0001_connect_data.sql](supabase/migrations/0001_connect_data.sql)
in the Supabase SQL editor (creates the 7 dataset tables + read-only RLS
policies), then seed them once from the generated data files:

```
SUPABASE_SERVICE_ROLE_KEY=<service-role key> node --env-file=.env.local scripts/seed-supabase.mjs
```

The service-role key is passed inline only — never add it to `.env.local`
(Vite exposes that file's `VITE_`-prefixed values to client code, so it
stays anon-key-only).

## Project structure

```
.
├── .claude/settings.json    # ponytail enabled, project-scoped
├── README.md                # this file
├── AGENTS.md                 # architecture decisions + scope
├── HANDOFF.md                 # historical, see AGENTS.md
├── scripts/                  # data generators + seed-supabase.mjs (loads them into Postgres)
├── data/                     # generated CSVs/JSON for all three reports
├── supabase/migrations/      # SQL for the Connect Data tables + RLS
└── src/
    ├── lib/                  # data loading, metrics, Vega-Lite spec builders
    └── components/            # dashboard panels
```

## More context

Architecture decisions and scope live in [AGENTS.md](AGENTS.md).
[HANDOFF.md](HANDOFF.md) has the original project pivot rationale
(historical, from InkPlot).
