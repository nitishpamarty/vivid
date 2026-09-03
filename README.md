# Vivid

Vivid is an agent-and-presenter co-editing demo. A presenter screen-shares a
real analytics dashboard on a call; an AI agent reshapes the live chart in
front of the viewer via browser-native WebMCP tools
(`document.modelContext.registerTool`) — no MCP server, no vision model,
just validated tool calls against shared, persisted state (Supabase; see
below). The current
build is "Northbeam," a fictional B2B SaaS company's Revenue dashboard plus a
dark, activity-oriented Product Usage surface — not a general chart builder. A
separate "Connect Data" screen (see below) adds a small generic chart surface
over real Postgres tables, without turning the hand-coded reports into that
abstraction themselves.

## Status

**Phase 1 built**: the six-panel Northbeam dashboard renders from real
generated CSVs (`data/customers.csv`, `data/mrr_monthly.csv`).

**Phase 2 built**: WebMCP tools (`get_report_context`, `list_report_options`,
`update_chart_spec`, `find_account_values`, `find_field_values`) scoped to the ARR bridge and
retention panels, persistence + undo, and the Person/Agent activity log.

**Shared sessions in progress**: room state is keyed by a URL-fragment
capability. Browser mutations go through the `shared-state` Edge Function and
server-only RPC (never direct table writes); reads remain room-scoped Supabase
queries/realtime subscriptions. Revenue account filtering accepts any exact
known customer name; `find_account_values` returns a short matching list when
the name is not in the visible top-five context. This is a bearer-link demo:
it is not proof of browser-model identity.

**Phase 3 built**: functional segment/region/plan filters — dropdowns plus
click-to-filter on the ARR-mix donut and net-new-logos heatmap — that
cross-filter all six panels, settable by a person or by the agent via the
`set_report_filters` WebMCP tool. See [AGENTS.md](AGENTS.md)'s "Explicit
scope" section for the authoritative phase breakdown, and
[evidence/](evidence/) for the manual verification log.

**Product Usage built** (on explicit direction — see AGENTS.md): a dark
Activity OS surface beside Revenue, now interactive and WebMCP-connected
like Revenue while staying visually distinct. Owner-team, report, and
as-of-month filters (dropdowns plus click-to-filter on the "Reports drawing
attention" and "Where usage comes from" rows) cross-filter the pulse strip,
momentum chart, rankings, team shares, and engagement spread — the activity
heatmap stays an explicit, unfiltered typical-week aggregate. Shared
persistence, realtime sync, activity logging, and Person-lane Undo reuse
Revenue's `shared-state` infrastructure under a separate `product_usage`
report namespace ([src/lib/usageFilters.ts](src/lib/usageFilters.ts),
[src/lib/usageSharedState.ts](src/lib/usageSharedState.ts)). A dedicated
WebMCP tool set (`get_usage_context`, `list_usage_options`,
`set_usage_filters`, `find_usage_values`) is registered only while the
Product Usage tab is active — see
[src/lib/registerUsageWebMcpTools.ts](src/lib/registerUsageWebMcpTools.ts).
It still has no raw Vega-Lite chart editing — charts stay derived from
validated data and filters, the same "chart-as-data, not chart-as-code"
boundary Revenue's two agent-editable charts use.

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
This is a separate surface from the two report surfaces above, not a
generalization of them — see AGENTS.md's "Connect Data" section.

**Semantic layer built** (Cube Cloud, modeling the same 7 Connect Data
tables — [cube/model/cubes/](cube/model/cubes/)): a
`get_business_definitions`/`query_business_metric` WebMCP tool pair lets the
agent ground an open-ended business question outside the two agent-editable
charts (e.g. "MRR by region") in real metric definitions instead of
guessing table/column names. Proxied through the `semantic-layer` Supabase
Edge Function so the Cube Cloud API token never reaches the browser — see
[supabase/functions/semantic-layer/index.ts](supabase/functions/semantic-layer/index.ts)
and [src/lib/semanticLayerClient.ts](src/lib/semanticLayerClient.ts).

## Tech stack

- Vite + React + TypeScript
- Vega-Lite + vega-embed (ARR bridge + retention panels only — the two
  agent-editable ones)
- Plain SVG/CSS for the rest
- Supabase (Postgres + Realtime) for shared dashboard state and the activity
  log, and (separately) for the 7 real tables the Connect Data screen reads
  — browser reads are direct; shared mutations use the narrow Edge Function
  boundary
- Cube Cloud as the semantic layer over those same 7 tables, reached only
  through the `semantic-layer` Edge Function — the API token is a
  server-side secret, never a `VITE_` var
- ponytail plugin active in this repo (project-scoped — see
  [.claude/settings.json](.claude/settings.json))

## Getting started

```
npm install
node scripts/generate-data.mjs          # writes data/customers.csv + mrr_monthly.csv + cac_monthly.json
node scripts/generate-people-data.mjs   # writes data/employees.csv for Connect Data
node scripts/generate-usage-data.mjs    # writes data/reports.csv + report_views_monthly.csv + activity_heatmap.json
npm run dev
```

Also needs a `.env.local` (gitignored) with a Supabase project's URL and
publishable key:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key>
```

The project needs the per-session tables and RPCs from
[supabase/migrations/0002_shared_sessions.sql](supabase/migrations/0002_shared_sessions.sql),
[supabase/migrations/0003_shared_state_rpc.sql](supabase/migrations/0003_shared_state_rpc.sql), and
[supabase/migrations/0006_product_usage_shared_state.sql](supabase/migrations/0006_product_usage_shared_state.sql)
(extends the `report_id` allow-list and both RPCs to also accept
`product_usage`, alongside Revenue's `northbeam`), plus deployment of
[supabase/functions/shared-state/index.ts](supabase/functions/shared-state/index.ts).
Add `dashboard_state` and `activity_log` to the `supabase_realtime`
publication. The browser receives a room id and write capability only in the
URL fragment (`#room=...&key=...`); the capability is never stored in the
database or activity log. Start from the landing page to create a fresh room.
For this no-login demo, links should be treated as bearer editor access; plan
to expire old rooms and delete their rows periodically using an operator
cleanup job or SQL, but no scheduler is included here.

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

For the semantic layer, deploy `supabase/functions/semantic-layer` and set
its secrets (also never in `.env.local`, same reasoning as above):

```
supabase secrets set CUBE_API_URL=https://<your-deployment>.cubecloudapp.dev CUBE_API_TOKEN=<cube cloud api token>
```

The model itself ([cube/model/cubes/](cube/model/cubes/)) is what Cube
Cloud reads over the Connect Data Postgres tables; `cube/docker-compose.yml`
+ `cube/.env` run that same model self-hosted for local schema iteration —
not part of the deployed path, see AGENTS.md.

## Project structure

```
.
├── .claude/settings.json    # ponytail enabled, project-scoped
├── README.md                # this file
├── AGENTS.md                 # architecture decisions + scope
├── HANDOFF.md                 # historical, see AGENTS.md
├── scripts/                  # data generators + seed-supabase.mjs (loads them into Postgres)
├── data/                     # generated CSVs/JSON for Revenue, Usage, and Connect Data
├── supabase/migrations/      # SQL for the Connect Data tables + RLS
├── cube/model/cubes/         # Cube semantic layer schema (YAML), read by Cube Cloud
└── src/
    ├── lib/                  # data loading, metrics, Vega-Lite spec builders
    └── components/            # dashboard panels
```

## More context

Architecture decisions and scope live in [AGENTS.md](AGENTS.md).
[HANDOFF.md](HANDOFF.md) has the original project pivot rationale
(historical, from InkPlot).
