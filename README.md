# Vivid

Vivid is a live co-authoring dashboard demo. A presenter screen-shares a real
analytics dashboard on a call; an AI agent reshapes the live chart in front
of the viewer via browser-native WebMCP tools
(`document.modelContext.registerTool`) — no MCP server, no vision model, just
validated tool calls against real in-memory/persisted state. The current
build is "Northbeam," a fictional B2B SaaS company's revenue dashboard — one
report, not a general chart builder.

## Status

**Phase 1 built**: the six-panel Northbeam dashboard renders from real
generated CSVs (`data/customers.csv`, `data/mrr_monthly.csv`).

**Phase 2 built**: WebMCP tools (`get_report_context`, `list_report_options`,
`update_chart_spec`, `find_field_values`) scoped to the ARR bridge and
retention panels, localStorage persistence + undo, and the Person/Agent
activity log.

**Phase 3 built**: functional segment/region/plan filters — dropdowns plus
click-to-filter on the ARR-mix donut and net-new-logos heatmap — that
cross-filter all six panels, settable by a person or by the agent via the
`set_report_filters` WebMCP tool. See [AGENTS.md](AGENTS.md)'s "Explicit
scope" section for the authoritative phase breakdown, and
[evidence/](evidence/) for the manual verification log.

## Tech stack

- Vite + React + TypeScript
- Vega-Lite + vega-embed (ARR bridge + retention panels only — the two
  agent-editable ones)
- Plain SVG/CSS for the rest
- No backend
- ponytail plugin active in this repo (project-scoped — see
  [.claude/settings.json](.claude/settings.json))

## Getting started

```
npm install
node scripts/generate-data.mjs   # writes data/customers.csv + mrr_monthly.csv
npm run dev
```

## Project structure

```
.
├── .claude/settings.json    # ponytail enabled, project-scoped
├── README.md                # this file
├── AGENTS.md                 # architecture decisions + scope
├── HANDOFF.md                 # historical, see AGENTS.md
├── scripts/generate-data.mjs   # deterministic data generator + self-check
├── data/                     # generated CSVs (customers, mrr_monthly, cac_monthly.json)
└── src/
    ├── lib/                  # data loading, metrics, Vega-Lite spec builders
    └── components/            # dashboard panels
```

## More context

Architecture decisions and scope live in [AGENTS.md](AGENTS.md).
[HANDOFF.md](HANDOFF.md) has the original project pivot rationale
(historical, from InkPlot).
