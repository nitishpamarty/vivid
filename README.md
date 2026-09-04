# Vivid

**Live demo: [vividdata.pages.dev](https://vividdata.pages.dev)**

Vivid is a live analytics workspace where AI agents safely answer business
questions about your data and adapt live analytics through browser-native
WebMCP tools (`document.modelContext.registerTool`)—with no headless MCP
server or vision model. A governed semantic layer grounds metric definitions
and queries in real business data, while a separate visualization contract lets
agents update analytics through validated, allow-listed controls rather than
raw chart code. Changes are persisted and shared in real time.

## At a glance

- **No MCP server.** The agent's tools live in the browser page itself via
  `document.modelContext.registerTool` — the tab *is* the tool surface.
- **Chart-as-data, not chart-as-code.** The agent never sends a raw Vega-Lite
  spec. Every mutation is a small validated contract (a chart "knob" or an
  approved presentation); the app owns rendering and enforces invariants
  (e.g. the ARR bridge can never become a dual-axis chart).
- **Shared, not solo.** Edits sync live to everyone on the room's link,
  are undoable, and land in a Person/Agent activity log — this is a
  co-editing surface, not a private agent sandbox.
- **Grounded, not guessing.** A semantic layer (Cube Cloud) gives the agent
  real metric definitions to answer open-ended questions instead of
  guessing table/column names.

## Why WebMCP

A headless MCP server can hand an agent your data and get a chart back, but
it never sees the chart it made — there is no shared surface to iterate on.
WebMCP flips that: the dashboard itself exposes the tools
(`document.modelContext.registerTool`), so the agent is editing the exact
chart a person is looking at, live, in the same tab. That turns “agent
generates a report” into “person and agent tune the same report together”:
set a filter, ask for a different presentation, watch it change, undo it,
hand it back — all through one shared surface with one activity log, not a
one-shot handoff.

## What's built

| Surface | What it is | Agent can do via WebMCP |
|---|---|---|
| **Revenue** (Northbeam) | 6-panel B2B SaaS revenue dashboard, real generated data | Read live report context · edit the ARR bridge & retention (NRR/churn) charts · switch ARR Mix / Top Accounts / Net New Logos between approved presentations (e.g. donut ↔ bar) · set segment/region/plan/channel/contract-type/account filters, cross-filtering all 6 panels |
| **Product Usage** | A second, visually distinct dark "Activity OS" report | Its own read/filter tool set, same shared-state/undo/activity-log plumbing as Revenue, own namespace |
| **Semantic layer** | Cube Cloud over 7 real Postgres tables | Look up real metric definitions, then query them (e.g. "MRR by region") — independent of either report's charts, never renders anything itself |
| **Connect Data** *(hidden from nav for this demo, code intact)* | Generic surface: pick a real Postgres table, agent co-authors a chart | Same "contract, not raw spec" discipline as the reports above |

Full tool contract: [src/lib/registerWebMcpTools.ts](src/lib/registerWebMcpTools.ts) ·
[src/lib/registerUsageWebMcpTools.ts](src/lib/registerUsageWebMcpTools.ts).
Architecture decisions and every invariant a tool enforces:
[AGENTS.md](AGENTS.md).

**Persistence.** Room state lives behind a URL-fragment capability, never a
global mutable dashboard. Browser mutations go through the `shared-state`
Edge Function and a server-only Postgres RPC — no direct table writes; reads
are room-scoped Supabase queries/realtime subscriptions. It's a bearer-link
demo (anyone with the link can edit), not proof of browser-model identity.

## Tech stack

- Vite + React + TypeScript
- Vega-Lite + vega-embed for the two agent-editable charts (ARR bridge,
  retention); plain SVG/CSS everywhere else
- Supabase (Postgres + Realtime) for shared dashboard state, the activity
  log, and the 7 Connect Data tables
- Cube Cloud as the semantic layer, reached only through a Supabase Edge
  Function — the API token never reaches the browser

## Getting started

```bash
npm install
node scripts/generate-data.mjs          # data/customers.csv + mrr_monthly.csv + cac_monthly.json
node scripts/generate-people-data.mjs   # data/employees.csv (for Connect Data)
node scripts/generate-usage-data.mjs    # data/reports.csv + report_views_monthly.csv + activity_heatmap.json
npm run dev
```

Add a `.env.local` (gitignored):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key>
```

<details>
<summary>Optional: Connect Data tables</summary>

Run [migration 0001](supabase/migrations/0001_connect_data.sql) in the
Supabase SQL editor (7 dataset tables + read-only RLS), then seed once:

```bash
SUPABASE_SERVICE_ROLE_KEY=<service-role key> node --env-file=.env.local scripts/seed-supabase.mjs
```

The service-role key is passed inline only — never put it in `.env.local`
(Vite exposes `VITE_`-prefixed values to client code).

</details>

<details>
<summary>Optional: semantic layer (Cube Cloud)</summary>

Deploy `supabase/functions/semantic-layer` and set its secrets (also never
in `.env.local`):

```bash
supabase secrets set CUBE_API_URL=https://<your-deployment>.cubecloudapp.dev CUBE_API_TOKEN=<cube cloud api token>
```

The model itself ([cube/model/cubes/](cube/model/cubes/)) is what Cube Cloud
reads over the Connect Data Postgres tables. `cube/docker-compose.yml` +
`cube/.env` run the same model self-hosted for local schema iteration —
not part of the deployed path.

</details>

## Project structure

```
.
├── AGENTS.md                # architecture decisions + scope
├── scripts/                 # data generators + seed-supabase.mjs
├── data/                    # generated CSVs/JSON for Revenue, Usage, and Connect Data
├── supabase/migrations/     # SQL for the Connect Data tables + RLS
├── cube/model/cubes/        # Cube semantic layer schema (YAML), read by Cube Cloud
└── src/
    ├── lib/                 # data loading, metrics, WebMCP tool contracts, Vega-Lite spec builders
    └── components/          # dashboard panels
```
