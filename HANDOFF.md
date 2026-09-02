# Handoff: WebMCP live co-authoring viz platform (successor to InkPlot)

Source project: `~/projects/inkplot` (WebMCP Challenge submission — sketch → Bar/Line/Pie → Superstore Sales by Category, agent-refined via filters). Repo stays as-is; this is a fresh project seeded from what it proved.

## Why we're pivoting

InkPlot's sketch-to-chart-type step (`src/chartClassifier.ts`) is a hand-tuned
geometric heuristic — stroke width/height ratios, cluster gaps, endpoint
distance — to guess Bar vs Line vs Pie from mouse strokes. It works for the
three demo shapes and nothing else. That's the ceiling: sketch vision doesn't
generalize, and it's not actually the interesting part of the idea.

The part that *did* work and is worth carrying forward: exposing live,
structured chart/report state as **browser-native WebMCP tools**
(`document.modelContext.registerTool(...)`), so an agent can read and mutate
what's on screen deterministically — no LLM in the page, no MCP server, no
vision model, just validated tool calls against real in-memory state.

## The new idea

A person is on a call with a customer, screen-sharing a data report. The
customer says "that doesn't read right as a bar chart" or "can you add a
trend line" or "break this out by region instead." Instead of the presenter
manually rebuilding the chart, they (or the agent, prompted by them) call a
WebMCP tool that edits the *live report* in front of the customer. This is
InkPlot's Person/Agent loop, generalized from "confirm a sketch + apply one
filter" to "co-author a small set of real reports live."

Scope for a one-day build: **one dataset (Superstore), three single-page
reports**, each a real chart the agent can reshape through WebMCP tools —
not a general chart builder.

## Reusable assets — copy these over, don't rebuild

- **Data**: `data/superstore-orders.csv` (10,194 rows, 21 columns — see field
  list below), plus `superstore-people.csv` and `superstore-returns.csv` if a
  report wants regional manager or returns context. Already cleaned CSVs,
  already scoped for redistribution inside the repo (see `data/README.md`
  caveat: confirm rights before publishing outside it).
- **Filter/validation engine**: `src/filtering.ts` (628 lines) — full 21-column
  field catalog with types (text/date/number), permitted operators per type,
  and atomic validation (a rejected request leaves state untouched). This is
  directly reusable for "let the agent filter/segment any report field."
- **Tool outcome shape**: `src/webMcpTools.ts`'s
  `{ ok: true, data } | { ok: false, reason, error }` pattern — a machine
  reason code plus a human-readable error. Kept every tool call atomic and
  easy for the agent to explain back to the person on the call.
- **Person/Agent activity log**: dual-lane log in `src/App.tsx` that only
  logs an Agent line when a real `registerTool` execute function actually
  ran (never a simulated call). This is the trust mechanism for the live-call
  scenario — the customer sees exactly what the agent changed and why.
- **Ponytail scope discipline** (`AGENTS.md`, `MVP_AGREEMENTS.md`,
  `TASKS.md`): explicit "explicitly out of scope" list kept the one-day
  challenge shippable. Do the same here — write the three-report scope and
  the "not doing this yet" list before writing code.

## The one thing to do differently: chart-as-data, not chart-as-code

InkPlot's chart was a fixed mapping (`Category` × sum(`Sales`)) with only the
mark type and filters agent-editable — because the chart itself was
hand-coded in React/SVG, so there was nothing else safe to expose.

For live co-authoring to actually feel like "AI edits the chart in front of
you," the chart needs to be **data the agent can rewrite wholesale**, not
imperative render code. That points at a declarative chart-spec library:

- **Vega-Lite** (recommended): a chart *is* a JSON spec (`mark`, `encoding`,
  `data`, `transform`). A WebMCP tool like `update_chart_spec(patch)` can
  hand the agent close to the whole vocabulary (mark type, x/y/color
  encoding, aggregate, filter transform) as one validated JSON object,
  instead of hand-rolling a bespoke tool per editable property. Renders with
  `vega-embed` from a CDN or npm — no backend.
- **Microsoft Data Formulator**: does more (NL-to-spec, data transforms,
  concept binding) but is a full standalone app with its own server and its
  own UI loop — heavier than a one-day, three-report build needs, and it
  isn't built to be embedded as *your* app's live chart with *your* WebMCP
  tools sitting in front of it. Worth a skim for encoding ideas, not worth
  adopting wholesale under this deadline.
- **Plain HTML/CSS/SVG** (InkPlot's approach): fine for exactly the shapes
  you hand-code, wrong tool once "change bar to line" or "add a series"
  needs to be agent-editable in one call rather than a new code path per
  request.

Recommendation: Vega-Lite specs as the shared state, one or two WebMCP tools
that patch the spec (validate against a small allow-list of encodings/marks
per report so the agent can't produce a nonsense chart), same
validate-atomically-before-replacing pattern as `filtering.ts`.

## Draft WebMCP tool contract for the new project

Adapt, don't copy verbatim — shape from InkPlot's five tools, collapsed
toward "one chart spec, patchable":

- `get_report_context` (read-only): active report id, current Vega-Lite
  spec, available fields + types for this dataset, active filters.
- `list_report_options` (read-only): which marks/encodings/fields are valid
  for the current report — the allow-list the agent must stay inside.
- `update_chart_spec` (mutating): agent proposes a patch (mark type,
  encoding change, add/remove a filter or series); validated against the
  allow-list and the data before it replaces the live spec atomically.
- `find_field_values` (read-only, reuse InkPlot's version almost as-is):
  resolve a phrase ("the West region") to canonical values, flag ambiguity
  instead of guessing.

Three reports likely means three allow-lists (or one shared allow-list keyed
by report id), not three separate tool sets.

## WebMCP testing gotchas learned the hard way

- Direct `document.modelContext.registerTool()` in the browser — no MCP
  server, proxy, or model-provider dependency needed. Keep it that way.
- Verified working in ChatGPT desktop app's in-app browser; the underlying
  model matters — **"Terra" (5.6) exposed and called tools correctly,
  "Luna" did not** (WebMCP disabled for that model as of testing on
  2026-09-01). If a live demo tool call silently doesn't show up, check
  which model is active before debugging the app.
- Static hosting (Cloudflare Pages, no Worker/function) was sufficient for
  the whole InkPlot build. Same should hold here — no backend needed.
- Manual verification loop that caught real bugs: inspect available tools →
  call the read-only context tool → call the mutating tool with a valid
  request → call it again with an invalid one → confirm the chart, any
  chips/log, and the tool's own return value all agree. Do this in an actual
  WebMCP-capable browser, not just unit tests — `evidence/phase-4/verification.md`
  is the template to follow (and to date-stamp fresh each time the tool
  contract changes; a stale evidence file documenting a retired contract
  caused confusion in InkPlot).

## Superstore Orders field catalog (for the new report specs)

21 columns, 10,194 rows: `Row ID`, `Order ID`, `Order Date`, `Ship Date`,
`Ship Mode`, `Customer ID`, `Customer Name`, `Segment`, `Country/Region`,
`City`, `State/Province`, `Postal Code`, `Region`, `Product ID`, `Category`,
`Sub-Category`, `Product Name`, `Sales`, `Quantity`, `Discount`, `Profit`.

Three categories (`Furniture`, `Office Supplies`, `Technology`) drove
InkPlot's demo chart. `Sub-Category`, `Region`, `Segment`, and the
`Profit`/`Discount` numeric fields are the obvious next dimensions for three
distinct report pages (e.g. sales-by-category, profit-by-region-and-segment,
discount-vs-profit trend).

## Open decisions to make at the start of the new project, not mid-build

1. Vega-Lite vs. something lighter for the three specific report shapes you
   actually want on day one — pick before writing tool code, since the tool
   contract shape depends on it.
2. One shared "report" abstraction (id, spec, allow-list) vs. three
   hand-coded pages — the shared abstraction is one file's difference in
   effort but is what makes "three reports" not "three copies of the app."
3. Whether `find_field_values`/filtering gets reused as-is from
   `src/filtering.ts` or trimmed to only the fields the three reports touch
   (trimming is more ponytail-correct for a one-day build, but the file
   already exists and works).
