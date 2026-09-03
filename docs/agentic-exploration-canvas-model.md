# Agentic Exploration Canvas domain model

This note freezes the Phase 0.1 model without changing the current Connect
Data UI or database. The types live in
[`src/lib/explorationModel.ts`](../src/lib/explorationModel.ts).

## Scope and compatibility

`Exploration` is the future persisted aggregate: an owner, optional editor/viewer
subjects, an ordered list of stable-id `CanvasCard`s, and a monotonically
increasing `version`. The card union is intentionally small: chart,
table-preview, note, question, and metric-answer. The current Connect Data
chart can become a `ChartCard` unchanged in spirit: `ChartContract` mirrors the
existing `{ mark, encoding, title }` contract, and the canonical
`DatasetQueryContract` from `queryContract.ts` is the single-dataset case. Its
source is a catalog dataset id and its optional relationship path contains only
server-owned relationship ids; matching field names never create a join. The
canvas model re-exports that validated dataset-query type rather than defining
a second field/aggregation shape.

Direct dataset queries and Cube semantic queries are separate `QueryContract`
variants. Semantic measures/dimensions are definition names, not SQL or Cube
wire payloads. A `QuestionCard` records the question and its linked answer;
`AnswerCard` records consulted definitions, the exact bounded semantic query,
bounded result rows, timestamp, and caveats. `suggestedChart` is inert until a
separate explicit card mutation creates a chart.

## Ownership, versioning, and audit

`VersionedMutation` carries an opaque mutation id, exploration id, actor,
`expectedVersion`, and a typed mutation. The server must compare-and-swap the
version and atomically persist the new snapshot plus an `AuditEvent`; a conflict
returns the current version and never partially applies the mutation. Actor
kind (`person`, `agent`, or `system`) describes the request path, not
tamper-proof model provenance.

Audit events retain action and stable references only. They must not contain
bearer capabilities, Supabase/Cube credentials, prompts, raw SQL, raw Vega-
Lite specs, or unrestricted source rows. Preview rows are session-only; a
persisted `TablePreviewCard` stores scope metadata. Bounded aggregate/semantic
result rows may be retained in an answer card only under the same server
limits and data policy as the query response.

## Validation boundaries

The type module intentionally has no executable validator. Before accepting a
WebMCP or UI mutation, the server boundary must validate:

- catalog dataset ids, field names, data types, relationship ids/paths, filter
  operators, time grains, aggregation compatibility, and finite row/result
  limits;
- Cube definition names and semantic filter/time-dimension shapes, after
  retrieving authoritative definitions;
- chart mark/channel/field combinations using the existing chart validator;
- card kind, stable-id uniqueness, card size/text limits, ownership/role, and
  `expectedVersion`.

Only the application may compile a validated query to server-side execution or
derive a Vega-Lite spec with its own `data`, transforms, config, and rendering.
No client model in this contract accepts raw SQL, arbitrary expressions, table
names outside the catalog, raw Vega-Lite, URLs, credentials, or service tokens.

## Persistence implications (later phase)

No migration is part of Phase 0. A later minimal Supabase design can persist an
`explorations` row (identity, owner, snapshot/version), card payloads either as
a versioned JSON snapshot or normalized `exploration_cards` rows, and append-only
`exploration_audit_events`. The choice between snapshot and normalized cards is
left open until card queries/realtime needs are known; either must use an
atomic compare-and-swap RPC and deny direct browser writes through RLS.

At migration time, `schemaVersion` enables an explicit decoder/migration for
future contract changes. Roles and tenant scope must be enforced server-side;
the current fictional public-data policy and bearer-link demo must not be
treated as production authorization. Capabilities, tokens, and raw query/spec
payloads are never persisted or logged.

Open decisions for the subsequent phases are the relationship catalog's exact
paths (Phase 0.2), authenticated collaboration versus restricted share links,
snapshot versus normalized card storage, and retention policy for bounded
answer result rows.
