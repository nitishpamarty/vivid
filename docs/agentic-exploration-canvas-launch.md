# Exploration Canvas launch guide

Status: demo-ready for the generated fictional datasets. This document is the
operator runbook and acceptance script for the Agentic Exploration Canvas. It
does not certify production readiness: this checkout has no connected local
Supabase project, and the no-login capability policy has no tenant identity.

The checked-in source/contract gate is repeatable and offline:

```sh
node scripts/verify-exploration-launch.mjs
node scripts/verify-exploration-persistence.mjs
npm test
npm run lint
npm run build
git diff --check
```

The first two commands inspect the checked-in contracts and migrations. They do
not prove a deployed Edge Function, Postgres RLS policy, Cube deployment,
Realtime/broadcast delivery, two-editor race, or browser WebMCP discovery.
Those require the live acceptance pass below.

## What is in the launch

The canvas keeps the existing Connect Data surface and adds a bounded,
multi-card exploration model:

- Connect Data reads one of seven catalogued Postgres tables and shows a
  deterministic, capped preview. Aggregate chart data runs through the
  server query contract and is labelled exact or unavailable in the UI.
- A chart can use one table or one of the two declared paths:
  `mrr_monthly → customers` and `report_views_monthly → reports`. Matching
  column names never create a join.
- Semantic questions use Cube definition names. A definition lookup grounds
  the question before the bounded metric query. An answer can carry a chart
  suggestion, but that suggestion is inert until a separate explicit chart-card
  mutation.
- Cards are persisted as one bounded, versioned snapshot. Saves use
  compare-and-swap (CAS) and append a bounded audit event.

Revenue and Product Usage remain separate report surfaces. Connect Data and the
canvas do not turn the hand-built Revenue/Product Usage reports into a generic
report registry.

## WebMCP inventory

Tools are registered only for the active surface. Every tool returns the
`{ ok: true, data }` or `{ ok: false, reason, error }` envelope. Tool names and
inputs are not authority: the server repeats validation and authorization.

| Active surface | Read-only tools | Mutating tools | Notes |
| --- | --- | --- | --- |
| Revenue visualization | `get_report_context`, `list_report_options`, `find_account_values`, `find_field_values` | `update_chart_spec`, `set_report_filters` | The first two chart knobs are the only Revenue visualization edits. This registration is intentionally separate from the semantic layer below. |
| Semantic layer (separate registration on Revenue) | `get_business_definitions`, `query_business_metric` | — | Definition and metric grounding only. These tools answer questions outside the report charts; they never register visualization mutation tools or change chart state. |
| Product Usage | `get_usage_context`, `list_usage_options`, `find_usage_values` | `set_usage_filters` | Registered only while the Usage tab is active. No raw chart-spec tool. |
| Connect Data | `list_datasets`, `get_dataset_schema`, `get_chart_contract`, `get_query_options`, `query_dataset_aggregate`, `get_exploration_context`, `list_explorations`, `open_exploration` | `connect_dataset`, `set_column_display_type`, `set_chart_contract`, `create_canvas_card`, `update_canvas_card`, `remove_canvas_card`, `reorder_canvas_cards`, `create_exploration`, `update_exploration` | Query and chart contracts are data-only. Canvas persistence tools use the host-held capability and never accept it from model-authored input. |

The Connect Data `set_column_display_type` operation is a presentation-time
cast in local React state. It is not a database schema change and resets on
reload. `get_dataset_schema` reports cast-warning counts.

## Security boundaries and roles

The browser, a browser model, and direct HTTP callers are all treated as
untrusted. The application accepts intent only through closed contracts:

- Dataset queries use catalog dataset/field ids, typed filters, an explicit
  relationship path, bounded dimensions/measures, and a server-owned SQL
  compiler. Raw SQL, arbitrary expressions, table names, inferred joins, and
  client transforms are not inputs.
- Chart contracts allow only `mark`, `encoding`, `title`, and `tooltip` (with
  mark/channel/type rules). The app supplies data, transforms, configuration,
  and Vega construction. Raw Vega keys such as `data`, `url`, `transform`, or
  `config` are rejected.
- Semantic requests allow only `meta` or bounded `query` operations. Cube
  credentials and the Supabase service-role key are Edge Function secrets;
  they are not Vite variables and are never sent to the browser. Upstream
  errors are replaced with generic client errors.
- Persisted card envelopes are checked in the RPC as well as in the browser.
  Snapshots contain bounded intent/provenance, not unrestricted source rows,
  SQL, specs, capabilities, or tokens. Notes, questions, names, and returned
  data are inert text; they cannot issue a tool call or change authorization.
- A mutation locks the exploration row, compares `expectedVersion`, updates
  the snapshot, increments the version once, and inserts its audit metadata in
  one RPC transaction. A stale writer gets `version_conflict` and does not
  overwrite the accepted edit.

The capability policy is deliberately a no-login demo policy:

| Role | Open/list | Replace snapshot | Rename | Share/delete/revoke |
| --- | --- | --- | --- | --- |
| owner | yes | yes | yes | Not exposed by the current endpoint |
| editor | yes | yes | no | Not exposed |
| viewer | yes | no (`unauthorized`) | no | Not exposed |

The Edge Function hashes a URL-safe bearer capability with SHA-256 before
calling the RPC. Postgres stores only the digest, and the capability is absent
from responses, audit rows, and activity messages. `create_exploration` can
seed up to seven additional capabilities as `editor` or `viewer` shares; it
cannot seed another owner. There is currently no share-management UI or
revoke endpoint.

The app's **Share URL** behavior is therefore important to state precisely:
copying the full URL shares the fragment-held bearer capability. It is an
owner-like link for the exploration (and editor-like for the legacy room
state), not a viewer link. Do not present it as authenticated collaboration.

There is also no tenant boundary in this fictional demo. Core exploration
tables are default-deny to browser roles, but the seven Connect Data tables are
intentionally anon-readable generated data. Before real customer data, add an
authenticated principal and `tenant_id` (or equivalent isolation) to every
exploration, grant, audit, dataset/RPC, and realtime policy. See the
[threat model](./agentic-exploration-canvas-threat-model.md).

## Limits and operating defaults

| Boundary | Limit |
| --- | --- |
| Dataset query | 100 default rows, 500 maximum rows, offset 100,000 maximum, 5 dimensions, 5 measures, 10 filters, 3 sort keys, 50 membership values, 200-character strings, 100,000 source-row budget |
| Aggregate transport | 64 KiB query payload, 1,000,000-byte response budget, 5,000 ms statement/transport timeout |
| Semantic query | 5 measures, 5 dimensions, 10 filters, 3 time dimensions, 50 values per filter, 500 rows, 64 KiB payload, bounded Edge timeout |
| Persisted canvas | 100 cards and 1 MiB snapshot; card titles 80 chars, notes/questions/summaries 2,000 chars, result rows 500, columns 100, definitions 100 |
| Edge request guard | `VIVID_MAX_REQUEST_BYTES` defaults to 1,250,000 (clamped 16 KiB–2 MiB); query rate 60/min; mutation rate 30/min; read rate 120/min; timeout 5,000 ms (clamped 500–10,000 ms) |

Rate limiting is per warm Edge isolate in this demo. A production deployment
needs a shared gateway/Redis/Supabase quota keyed by authenticated principal
and tenant, plus concurrency budgets and alerting. Room state expires after
seven days; exploration capability rows have no default expiry, so old
explorations need operator cleanup/revocation.

## Setup and deployment order

1. Generate the deterministic fictional data and install dependencies:

   ```sh
   npm install
   node scripts/generate-data.mjs
   node scripts/generate-people-data.mjs
   node scripts/generate-usage-data.mjs
   ```

2. Create `.env.local` (gitignored) with only browser-safe values:

   ```text
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<publishable-key>
   ```

3. Apply migrations in filename order: `0001_connect_data.sql`,
   `0002_shared_sessions.sql`, `0003_shared_state_rpc.sql`,
   `0004_query_aggregate_rpc.sql`, `0005_exploration_persistence.sql`, then
   `0006_product_usage_shared_state.sql`. Deploy the `shared-state`,
   `aggregate-query`, `exploration-state`, and `semantic-layer` Edge
   Functions. Add the legacy `dashboard_state` and `activity_log` tables to
   the Realtime publication if Revenue/Product Usage shared-state updates are
   being demonstrated. Exploration snapshots use capability-gated open calls
   plus a version broadcast/poll fallback; they are not public Realtime table
   reads.

4. Seed Connect Data using the service-role key only as an inline process
   variable. Never put this key in `.env.local` or a Vite `VITE_` variable:

   ```sh
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> node --env-file=.env.local scripts/seed-supabase.mjs
   ```

5. Configure Cube Cloud and the semantic proxy as Edge secrets, not browser
   variables:

   ```sh
   supabase secrets set CUBE_API_URL=https://<deployment>.cubecloudapp.dev CUBE_API_TOKEN=<cube-token>
   npm run dev
   ```

   Open the local URL, choose **Start live session**, then choose **Connect
   Data**. The app intentionally shows an unavailable state instead of a
   local fake if shared room state cannot be reached.

## Repeatable browser acceptance demo

Run the offline verifier first. Then perform this sequence in a browser that
implements `document.modelContext.registerTool` (or use the repository's
devtools polyfill procedure from [evidence/README.md](../evidence/README.md)).
Record the date, deployed project/function revision, and each returned `ok`
and `reason`; do not record capabilities or tokens.

### 1. Connect and inspect a governed source

On **Connect Data**, call:

```json
list_datasets {}
connect_dataset {"datasetId":"mrr_monthly"}
get_dataset_schema {}
```

Expected: the catalog lists `mrr_monthly`; the schema is returned; the page
shows a bounded sample (normally 500 rows when the table is larger) and labels
it **Sampled preview**. No database column is changed.

### 2. Build a multi-dataset chart through the declared path

First inspect the contract and query allow-list:

```json
get_query_options {}
get_chart_contract {}
```

Run this exact, bounded query (the generated data may produce different
numbers after an intentional generator change):

```json
query_dataset_aggregate {
  "query": {
    "source": "mrr_monthly",
    "relationshipPath": ["mrr_monthly_to_customers"],
    "dimensions": [{"field":{"dataset":"customers","field":"region"}}],
    "measures": [{"field":{"dataset":"mrr_monthly","field":"mrr"},"aggregate":"sum"}],
    "filters": [{"field":{"dataset":"customers","field":"segment"},"operator":"eq","value":"Enterprise"}],
    "sort": [{"field":{"dataset":"customers","field":"region"},"direction":"asc"}],
    "limit": 20
  }
}
```

Expected: `ok: true`, aggregate rows, `sourceTables` containing
`mrr_monthly` and `customers`, the same relationship id, and applied-limit
metadata. On the page, use **Compose from related data**, select the same
relationship, `customers.region`, `mrr_monthly.mrr`, `sum`, and **Add governed
chart**. The resulting card must say **Exact aggregate** and show the path.
The UI and WebMCP path must produce the same governed query shape.

### 3. Ask a grounded semantic question

Call definitions before the metric query:

```json
get_business_definitions {}
query_business_metric {
  "query": {
    "measures": ["mrr_monthly.total_mrr"],
    "dimensions": ["customers.region"],
    "filters": [{"member":"customers.segment","operator":"eq","values":["Enterprise"]}],
    "limit": 20
  }
}
```

Expected: definitions identify the measure/dimension meaning and Cube join;
the query returns real bounded values or a safe `unavailable`/`timeout`
reason. To place the answer on the canvas, create a `metric-answer` card that
contains the consulted definition refs, the bounded semantic query/result,
summary, and caveat. If the answer includes `suggestedChart`, the page must
show **Suggested chart · not applied**.

### 4. Apply a suggestion only with an explicit card mutation

Do not treat `suggestedChart` as an instruction. Use its validated mark and
encodings to issue a separate `create_canvas_card` call with a governed
dataset query and chart contract, for example the query from step 2 and:

```json
{"card":{"kind":"chart","title":"Enterprise MRR by region","query":{"source":"mrr_monthly","relationshipPath":["mrr_monthly_to_customers"],"dimensions":[{"field":{"dataset":"customers","field":"region"}}],"measures":[{"field":{"dataset":"mrr_monthly","field":"mrr"},"aggregate":"sum"}],"limit":20},"chart":{"version":1,"mark":"bar","encoding":{"x":{"dataset":"customers","field":"region","type":"nominal"},"y":{"dataset":"mrr_monthly","field":"mrr","type":"quantitative","aggregate":"sum"}}}}}
```

Expected: a new chart card is created, the existing chart is unchanged, and
the card contains no `data`, `url`, `transform`, `config`, SQL, or raw rows.

### 5. Save, reopen, and exercise sharing

The person UI creates a saved exploration for a new live session and autosaves
canvas edits. Confirm the status reads **Saved exploration · vN · owner**, then
call:

```json
get_exploration_context {}
update_exploration {"expectedVersion":<current-version>,"action":"chart_suggested"}
open_exploration {"explorationId":"<returned-id>"}
```

Expected: the version increments once, the open response contains the same
validated cards, and a stale `expectedVersion` is rejected without changing
the snapshot. Copy the full URL (including the fragment) into a second
browser and confirm the same exploration opens. This is a bearer-link owner
share in the current app.

For role-specific API acceptance, create an exploration through the Edge API
with `shares: [{capability:<editor-key>,role:"editor"},{capability:<viewer-key>,role:"viewer"}]`
using generated high-entropy keys kept out of logs. Verify that each key can
open; editor can mutate but cannot rename; viewer can open but receives
`unauthorized` for mutation. This is an API fixture path today, not a UI share
dialog. Revoke/expiry behavior must be tested by an operator SQL fixture until
the management endpoint exists.

### 6. Prove rejected input and unchanged state

Capture these negative calls and their stable reason codes:

```json
query_dataset_aggregate {"query":{"source":"mrr_monthly","sql":"select *"}}
query_dataset_aggregate {"query":{"source":"mrr_monthly","relationshipPath":["customers_to_mrr_monthly"],"dimensions":[],"measures":[]}}
create_canvas_card {"card":{"kind":"chart","data":{"values":["secret"]}}}
```

Expected: the first is `unknown_field`; the second is an invalid/unknown
relationship or bounded-query rejection; the third is `invalid_card` (or
`unknown_field`). None creates a card or changes the chart. Also issue one
mutation with a viewer capability and one with a stale version; expect
`unauthorized` and `version_conflict`, respectively, with no partial write.

## Rollback and incident handling

Use a reversible deployment order. Roll back the frontend to the last known
good build first; keep the additive migrations and snapshots in place while
investigating. If an Edge regression is isolated, redeploy the prior function
revision for that function only. Do not drop exploration tables or truncate
snapshots as a rollback shortcut.

For a suspected capability leak, stop sharing the URL, identify the affected
exploration, and revoke the digest out of band (the current app has no revoke
endpoint). Compute the SHA-256 digest in an operator-controlled environment;
never paste a live capability into shell history, tickets, logs, or chat. Mark
the capability row revoked, rotate any compromised service/Cube secret through
the provider, and issue a fresh least-privilege link. For a production system,
add authenticated identity, scoped expiry, rotation, and a revocation UI before
launch.

When reporting an Edge failure, include the response's `X-Request-Id`, route,
timestamp, and stable reason only. The structured `vivid_request` telemetry
intentionally excludes request bodies, rows, prompts, capabilities, tokens,
Cube errors, and SQL. Check rate-limit, timeout, and upstream health before
retrying. A generic `unavailable` response is expected when Supabase/Cube is
not configured.

## Sign-off record

Use a dated copy of this checklist under `evidence/phase-5/`:

- [ ] Offline launch verifier passed.
- [ ] Unit, lint, build, and diff checks passed.
- [ ] Live browser discovered the active WebMCP tools.
- [ ] Connect Data sample was visibly labelled sampled; aggregate chart was
      visibly labelled exact with source/path metadata.
- [ ] Semantic definitions preceded the metric query; answer provenance and
      inert chart suggestion were visible.
- [ ] Explicit chart-card mutation created a new chart without silently
      changing an existing chart.
- [ ] Save/reopen and stale-version behavior passed.
- [ ] Owner/editor/viewer role checks passed against a disposable Supabase
      project, or are explicitly recorded as blocked.
- [ ] Malformed, unauthorized, and prompt-injection-shaped inputs were
      rejected without a state/audit mutation.

The repository's current Phase 5 evidence records the static/adversarial pass
and explicitly records the local browser/Supabase persistence limitation:
[verification-2026-09-02.md](../evidence/phase-5/verification-2026-09-02.md)
and [security-adversarial-2026-09-02.md](../evidence/phase-5/security-adversarial-2026-09-02.md).
