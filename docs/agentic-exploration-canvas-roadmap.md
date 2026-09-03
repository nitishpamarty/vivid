# Agentic Exploration Canvas — Delivery Roadmap

## Purpose

Evolve the existing **Connect Data** tab from a single-table, session-only chart
experiment into a secure, collaborative exploration canvas. A person or browser
agent can connect governed datasets, combine approved relationships, ask
business questions, create and edit charts, and save/share an exploration.

This is not a raw-SQL IDE or an arbitrary Vega-Lite editor. The application
owns credentials, query execution, data delivery, and rendering. The agent
authors only validated intent through WebMCP tools.

## Current baseline

Already implemented:

- A catalog of seven Supabase datasets and sampled row previews.
- A validated single-dataset chart contract: `mark`, `encoding`, and `title`.
- WebMCP tools for dataset discovery/connection, schema inspection, display
  casts, and chart-contract reads/writes.
- Cube Cloud semantic definitions and read-only metric queries, proxied through
  a Supabase Edge Function so Cube credentials never reach the browser.

Not yet implemented:

- Saved canvases, multi-dataset relationships, server-side aggregation,
  semantic chart authoring, questions/answers, collaboration, or authorization
  beyond the current fictional-demo read policy.

## Non-negotiable safety model

1. **No raw SQL through WebMCP.** All requests compile from a small typed query
   model and are checked against an allow-list.
2. **No raw Vega-Lite specs.** The agent supplies a constrained chart contract;
   the app owns `data`, transforms, configuration, and rendering.
3. **The semantic layer is authoritative for business metrics.** Agent prompts
   must retrieve definitions before querying a named metric.
4. **Dataset joins are explicit and modeled.** The client must never invent a
   join from matching column names.
5. **Every mutation is versioned and audited.** A save or update is conditional
   on the expected canvas version.
6. **Tenant/data policy is enforced server-side.** Client-side validation is a
   usability aid, not an authorization boundary.

## Target interaction model

```text
Person or browser agent
          |
          v
WebMCP tools: discover -> model -> query -> chart -> save -> ask
          |
          v
Validated canvas/query/chart models
          |                         \
          v                          v
Supabase RPC / Edge Functions       Cube semantic proxy
          |                          |
          +-------- governed data ---+
                         |
                         v
              App-owned renderer and canvas UI
```

The canvas supports cards: dataset/table previews, metric answers, text notes,
and charts. Chart cards can be generated from either a safe dataset query or a
semantic metric query. A question creates an answer card plus optional chart
suggestion; it never silently changes an existing chart.

## Delivery rules

- Each task below is designed for one focused Codex chat window.
- Begin each task from the current main branch and inspect existing work before
  editing. Do not overwrite unrelated changes.
- Tests and verification evidence are part of the task definition.
- A task marked **parallel** may run concurrently only after its stated
  prerequisite has landed. Tasks that edit the same core files should use
  separate worktrees and merge in dependency order.
- Do not start a later phase until its exit criteria are met.

---

## Phase 0 — Decisions and contract design

**Goal:** Freeze the small models that later phases will enforce. No user-facing
feature is built here.

### 0.1 Define the canvas domain model

**Depends on:** none  
**Parallel with:** 0.2, 0.3

**Deliverable:** TypeScript types and a design note for `Exploration`,
`CanvasCard`, `DataSource`, `QueryContract`, `ChartContract`, `QuestionCard`,
versioning, ownership, and audit events. Clearly identify what stays local,
what becomes persistent, and what data never enters a client model.

**Run prompt:**

> In the Vivid repository, design—not yet fully implement—the durable domain
> model for an Agentic Exploration Canvas. Read AGENTS.md and the existing
> Connect Data and semantic-layer code first. Add a concise architecture note
> and TypeScript type module for persisted explorations, canvas cards,
> versioned mutations, audit events, query contracts, and chart contracts.
> Preserve the rule that agents cannot submit raw SQL or raw Vega-Lite. Keep
> the model minimal and compatible with the current single-dataset contract.
> Include validation boundaries and migration implications. Add focused unit
> tests only if the module contains executable validation. Do not change the
> current UI or database schema. Report files changed and verification run.

### 0.2 Define allowed relationships and query grammar

**Depends on:** none  
**Parallel with:** 0.1, 0.3

**Deliverable:** A relationship catalog for the seven current tables and a
typed query grammar: source, approved relationship path, dimensions, measures,
filters, sort, limit, and time grain. Document row/response limits and rejected
patterns.

**Run prompt:**

> In the Vivid repository, inspect the Supabase migration, Cube models, and
> Connect Data catalog. Write a minimal, explicit relationship catalog for the
> seven fictional datasets and a typed, allow-listed aggregate query contract.
> Include only relationships supported by declared keys; do not infer joins by
> similarly named columns. Specify dimension, measure, filter, sort, time-grain,
> pagination, and response-limit rules, plus machine-readable error reasons.
> Add unit-testable validation types/functions where appropriate, but do not
> add UI, raw SQL execution, or arbitrary joins. Preserve the existing chart
> contract boundary. Report changed files and tests.

### 0.3 Threat model and authorization plan

**Depends on:** none  
**Parallel with:** 0.1, 0.2

**Deliverable:** A short threat model covering bearer links, prompt injection,
row-level access, query abuse, sensitive metadata, audit/provenance, and
cross-tenant leakage. It defines the auth/RLS direction before persistence is
introduced.

**Run prompt:**

> In the Vivid repository, produce a concise threat model and authorization
> plan for turning Connect Data into a persistent multi-dataset exploration
> canvas. Account for browser WebMCP callers, malicious tool inputs, prompt
> injection in data/text, Supabase RLS, Cube credentials, query-cost abuse,
> sharing links, audit provenance, and future tenants. Distinguish current demo
> constraints from required production controls. Propose minimal enforceable
> server-side controls and acceptance tests. Do not implement authentication or
> weaken existing safety checks.

**Phase exit criteria:** an agreed versioned canvas model, explicit relationship
catalog/query grammar, and a server-enforced authorization plan.

---

## Phase 1 — Server-side governed querying

**Goal:** Replace client sampling as the only analytical path with exact,
bounded aggregates that can safely power a chart.

### 1.1 Add query-contract validation and compilation

**Depends on:** 0.1, 0.2  
**Parallel with:** 1.2 after the contract interface is agreed

**Deliverable:** Pure validation that rejects unknown sources/fields,
relationships, operators, aggregation combinations, unbounded results, and
unsupported time grains. Compilation must use parameterized server-side logic
or a controlled RPC—not client-built SQL strings.

**Run prompt:**

> Implement the validated aggregate QueryContract defined in the approved
> Phase 0 design. Add pure TypeScript validation with structured `{ ok, data }`
> or `{ ok, reason, error }` results. Reject unknown datasets, fields,
> relationships, operators, invalid aggregation/type combinations, unsupported
> time grains, and excessive limits. Do not accept raw SQL, raw expressions, or
> a client-provided table name outside the catalog. Keep compilation/execution
> separate from validation. Add comprehensive unit tests for accepted and
> rejected cases, including malicious inputs. Do not change the existing
> single-dataset UI yet.

### 1.2 Build the protected aggregate-query backend

**Depends on:** 0.2; interface alignment with 1.1  
**Parallel with:** 1.1 only if working from the frozen interface

**Deliverable:** A Supabase RPC or Edge Function that executes only a validated
query contract, applies RLS/tenant scope, enforces limits/timeouts, returns
typed aggregates and query metadata, and never returns service credentials.

**Run prompt:**

> Implement a server-side aggregate-query path for Vivid's Exploration Canvas,
> using the approved QueryContract and relationship catalog. Choose the smallest
> safe Supabase RPC or Edge Function design that can execute exact aggregates
> without raw SQL supplied by the browser or WebMCP. Enforce source/field/
> relationship allow-lists, row and response limits, a bounded timeout, and the
> established authorization policy. Return data plus metadata describing source
> tables, truncation (if any), and applied limits. Add migration/function tests
> or integration verification appropriate to this repository. Do not expose
> service-role or Cube credentials, and do not add arbitrary joins.

### 1.3 Integrate exact aggregate results into Connect Data

**Depends on:** 1.1, 1.2  
**Parallel with:** 1.4

**Deliverable:** The UI distinguishes sampled rows from exact aggregated chart
data. Large-table charts use the server path; errors are legible and no chart
silently claims precision it lacks.

**Run prompt:**

> Integrate the completed governed aggregate-query backend into the existing
> Connect Data UI. Preserve the 500-row table preview as a preview, but route
> aggregate chart data through the exact server-side QueryContract path. Make
> the source, aggregation, and result scope visible in the UI; never silently
> present sampled values as exact. Keep current single-dataset chart behavior
> working. Add focused component/integration tests and a verification note.

### 1.4 Add read-only aggregate WebMCP tools

**Depends on:** 1.1, 1.2  
**Parallel with:** 1.3

**Deliverable:** `get_query_options` and `query_dataset_aggregate`, with compact
schemas, validation, provenance metadata, and activity-log entries.

**Run prompt:**

> Add read-only WebMCP tools for Vivid's validated dataset aggregation:
> `get_query_options` and `query_dataset_aggregate`. Reuse the existing
> `{ok,data}` / `{ok:false,reason,error}` convention and the exact same
> QueryContract validator/backend used by the UI. Tool output must include
> query/result metadata and must stay bounded; it must not expose SQL, secrets,
> unrestricted table access, or raw data beyond documented limits. Register the
> tools alongside existing Explore tools, log calls consistently, and add tests
> using the document.modelContext polyfill pattern already used in this repo.

**Phase exit criteria:** a chart can use an exact, bounded server aggregate and
an agent can invoke the same path via read-only WebMCP.

---

## Phase 2 — Multi-dataset canvas and chart contracts

**Goal:** Let a user compose approved sources and create multiple chart cards
without diluting the safety boundary.

### 2.1 Implement local multi-card canvas state

**Depends on:** 0.1, 1.3  
**Parallel with:** 2.2

**Deliverable:** A local canvas with chart, table-preview, metric-answer, and
note cards. Cards use stable ids and immutable updates; no persistence yet.

**Run prompt:**

> Extend the Connect Data experience into a local-only Exploration Canvas with
> multiple cards. Implement the minimal state and UI needed to add, select,
> rename, duplicate, remove, and reorder chart, table-preview, note, and
> metric-answer cards. A chart card references a validated QueryContract plus
> the existing constrained ChartContract; it does not contain raw Vega specs
> or raw data. Keep the current single-chart experience as an easy first card.
> Add component tests for card lifecycle and preserve existing behavior.

### 2.2 Extend chart contract only where necessary

**Depends on:** 0.1, 1.1  
**Parallel with:** 2.1

**Deliverable:** Versioned chart contract additions needed for aggregate/multi-
dataset results (for example tooltip or a small approved set of display knobs),
with strict validation and safe Vega-spec derivation.

**Run prompt:**

> Review Vivid's current Explore chart contract against exact aggregate results
> and the approved canvas model. Implement only the smallest versioned contract
> extension required for useful multi-card charts. Maintain the invariant that
> the app, not the agent, owns data values, transforms, config, URLs, and Vega
> spec construction. Reject unknown keys and invalid mark/channel combinations.
> Update validators, spec derivation, tests, and tool descriptions together.
> Do not add faceting, layers, arbitrary expressions, or raw Vega-Lite escape
> hatches unless explicitly justified by an accepted requirement.

### 2.3 Add multi-dataset source composition

**Depends on:** 1.2, 2.1, 2.2  
**Parallel with:** none (integration-heavy)

**Deliverable:** A card can select a relationship path from the catalog,
construct a validated multi-dataset query, and render its result. The UI shows
the exact source path.

**Run prompt:**

> Implement approved multi-dataset source composition in the Exploration
> Canvas. A chart card may select only a relationship path from the explicit
> catalog, then choose compatible dimensions/measures/filters through the
> existing QueryContract. Show the selected tables and relationship path in the
> card UI and query metadata. Do not infer joins, permit arbitrary join
> conditions, or send raw SQL. Verify one supported multi-table chart end to
> end and add rejection tests for unsupported paths.

### 2.4 Add chart/card mutation WebMCP tools

**Depends on:** 2.1, 2.2, 2.3  
**Parallel with:** none

**Deliverable:** An agent can list canvas state and safely create/update/remove
cards in local state: `get_exploration_context`, `create_canvas_card`,
`update_canvas_card`, `remove_canvas_card`, and `reorder_canvas_cards`.

**Run prompt:**

> Add local-state WebMCP tools for the Exploration Canvas: context read,
> create/update/remove/reorder cards. Every mutation must validate card kind,
> QueryContract, ChartContract, and allowed fields before atomically replacing
> state. Use stable ids, structured errors, and existing agent activity logging.
> Chart mutations must remain intent-only: no raw SQL, raw Vega specs, data
> values, URLs, or transforms. Test registration, valid mutations, invalid
> mutations, and no-partial-update behavior with the project's WebMCP polyfill.

**Phase exit criteria:** a person or WebMCP agent can create a multi-card canvas
and a governed multi-dataset chart in the current browser session.

---

## Phase 3 — Semantic authoring and questions

**Goal:** Make natural-language questions grounded in governed definitions,
without allowing the model to invent metrics or rewrite charts unexpectedly.

### 3.1 Normalize semantic metadata for the UI/tools

**Depends on:** 0.1  
**Parallel with:** 3.2

**Deliverable:** A compact, cacheable model of Cube measures, dimensions,
relationships, descriptions, and permitted filters, suitable for both the UI
and WebMCP responses.

**Run prompt:**

> Improve Vivid's semantic-layer client boundary so the UI and WebMCP tools can
> consume a compact, typed representation of Cube definitions: measures,
> dimensions, relationships, descriptions, types, and permitted filters. Keep
> Cube as the source of truth and preserve the server-side proxy. Add sensible
> caching/error behavior and tests for normalization. Do not embed Cube tokens
> in the browser or build a natural-language model call yet.

### 3.2 Define question/answer provenance schema

**Depends on:** 0.1  
**Parallel with:** 3.1

**Deliverable:** A QuestionCard/AnswerCard design that stores question text,
chosen definitions, query contract, answer result, timestamp, and caveats.

**Run prompt:**

> Add the minimal domain types and validation for grounded question and answer
> cards in Vivid's Exploration Canvas. An answer must retain the user's
> question, semantic definitions consulted, the exact governed query submitted,
> returned data/summary, timestamp, and caveats. It may suggest a chart contract
> but cannot mutate an existing chart automatically. Add tests for provenance
> completeness and rejected ungrounded answer payloads. Do not call an LLM or
> build UI beyond what is needed to prove the model.

### 3.3 Implement semantic query cards

**Depends on:** 3.1, 2.1  
**Parallel with:** 3.4

**Deliverable:** A user can select named measures/dimensions/filters, run the
existing semantic query tool, and pin results to the canvas with provenance.

**Run prompt:**

> Add semantic query cards to Vivid's Exploration Canvas. Let a person choose
> Cube-defined measures, dimensions, filters, and time dimensions, execute the
> existing server-proxied semantic query path, and pin the response as a canvas
> card with full provenance. Clearly distinguish semantic results from direct
> dataset queries. Handle unavailable/empty results without corrupting canvas
> state. Do not add arbitrary SQL or an LLM interpretation layer.

### 3.4 Add semantic WebMCP authoring tools

**Depends on:** 3.1, 2.4  
**Parallel with:** 3.3

**Deliverable:** `list_available_metrics`, `create_semantic_query_card`, and
`update_semantic_query_card`, requiring valid Cube definition names.

**Run prompt:**

> Add WebMCP tools that let an agent discover Cube-defined business metrics and
> create or update a semantic query card in the Exploration Canvas. Reuse the
> existing business-definition and query proxy; require valid names from the
> returned metadata and preserve a provenance record on each card. Return
> compact bounded results and structured validation errors. A tool call may
> create a new card or update the named card only; it must never alter an
> unrelated chart or execute raw SQL. Add polyfill-based tests.

### 3.5 Add a grounded question workflow

**Depends on:** 3.2, 3.3, 3.4  
**Parallel with:** none

**Deliverable:** A question interface/orchestrator that follows: retrieve
definitions → choose approved query → run it → record an answer card → offer,
but do not apply, a chart suggestion. Model/provider integration is explicitly
pluggable and server-side.

**Run prompt:**

> Implement a grounded question workflow for Vivid's Exploration Canvas. The
> workflow must first obtain semantic definitions, select only valid measures/
> dimensions/filters, execute a governed semantic query, then create an answer
> card containing full provenance and caveats. It may return a separately
> validated proposed chart contract, but must require an explicit person or
> WebMCP mutation to create/update a chart. Keep any model/provider call behind
> a server-side interface; never expose credentials or trust model-produced SQL,
> Vega specs, joins, or claims without query evidence. Add tests for the state
> sequence and failure modes.

**Phase exit criteria:** every answer is traceable to definitions and a bounded
query; every chart edit remains a separate, explicit validated mutation.

---

## Phase 4 — Persistence, sharing, and collaboration

**Goal:** Turn session work into a durable, versioned exploration while applying
the security plan from Phase 0.

### 4.1 Add exploration persistence and migrations

**Depends on:** 0.1, 0.3, 2.4  
**Parallel with:** 4.2 only after shared schema is agreed

**Deliverable:** Tables/RPCs for explorations, cards, and audit events, with
versioned atomic mutations. No direct browser writes to core state.

**Run prompt:**

> Implement persistence for Vivid Exploration Canvases using the approved
> domain model and threat model. Add minimal Supabase migrations for
> explorations, cards (or a justified snapshot model), audit events, ownership,
> and monotonically increasing versions. Implement server-side atomic
> create/update mutation paths with compare-and-swap expected versions. Deny
> direct client writes through RLS and ensure sensitive capabilities/tokens are
> neither persisted nor logged. Add migration and concurrency verification.

### 4.2 Implement RLS, roles, and sharing policy

**Depends on:** 0.3  
**Parallel with:** 4.1 only after shared schema is agreed

**Deliverable:** Policy tests for owner/editor/viewer and a deliberate choice
between authenticated collaboration and restricted capability links.

**Run prompt:**

> Implement the approved authorization model for persisted Vivid Exploration
> Canvases. Add Supabase RLS and server checks for owner, editor, and viewer
> access (or a deliberately constrained share-link model if that is the
> accepted design). Ensure dataset and semantic-query access is tenant scoped
> server-side, not merely hidden in the UI. Add positive and negative policy
> tests, including cross-user/cross-tenant attempts. Do not broaden the current
> demo's public data policy without explicit migration documentation.

### 4.3 Wire persistence and realtime into the canvas

**Depends on:** 4.1, 4.2  
**Parallel with:** 4.4

**Deliverable:** Save/load, conflict handling, realtime updates, and visible
version state. Conflicting edits are detected—not silently last-write-wins.

**Run prompt:**

> Connect the local Exploration Canvas UI to the completed versioned persistence
> API. Implement create/open/save flows, optimistic updates guarded by expected
> versions, conflict recovery that preserves the user's unsaved work, and
> realtime updates scoped to the exploration. Make loading, offline/error, and
> version/conflict state understandable. Preserve local safety validation before
> server mutations. Add end-to-end or integration verification for two editors.

### 4.4 Add persisted-canvas WebMCP tools

**Depends on:** 4.1, 4.2, 2.4  
**Parallel with:** 4.3

**Deliverable:** `list_explorations`, `open_exploration`, `create_exploration`,
and version-checked save/update tools, all authorization-aware.

**Run prompt:**

> Add authorization-aware WebMCP tools for persisted Exploration Canvases:
> list, create, open, and version-checked update/save. Tool responses must be
> compact and respect owner/editor/viewer permissions. Mutations require an
> expected version and return a structured conflict response rather than
> overwriting another editor. Reuse existing card/query/chart validation and
> server mutation paths; do not let a browser tool bypass RLS or audit logging.
> Add tests for permissions, version conflicts, and successful mutations.

**Phase exit criteria:** authorized users can share a saved canvas; concurrent
edits are version-safe and agent mutations are audited like person mutations.

---

## Phase 5 — Product hardening and launch

**Goal:** Validate reliability, observability, usability, and operational
controls before describing the canvas as production-ready.

### 5.1 Security and adversarial test suite

**Depends on:** Phases 1–4  
**Parallel with:** 5.2, 5.3

**Run prompt:**

> Build an adversarial test suite for Vivid's completed Exploration Canvas.
> Cover malformed WebMCP inputs, raw SQL/Vega injection attempts, unknown-field
> access, unauthorized canvas access, cross-tenant access, invalid relationship
> paths, oversized queries, version conflicts, model-proposed ungrounded
> answers, and leaked-secret regressions. Tests should prove server-side
> enforcement rather than only UI validation. Produce a concise evidence report
> with commands run and results. Do not weaken controls to make tests pass.

### 5.2 Observability, quotas, and cost controls

**Depends on:** Phases 1–4  
**Parallel with:** 5.1, 5.3

**Run prompt:**

> Add minimal production observability and abuse controls to Vivid's Exploration
> Canvas query and mutation paths: structured request/audit metadata without
> sensitive values, latency/error metrics or logs consistent with this repo,
> per-user/tenant request limits, query-size/timeout ceilings, and user-visible
> quota/error messages. Ensure WebMCP and UI paths use the same enforcement.
> Document operational configuration and add focused tests. Never log bearer
> capabilities, Cube tokens, raw sensitive values, or hidden prompts.

### 5.3 Usability/accessibility verification

**Depends on:** Phases 2–4  
**Parallel with:** 5.1, 5.2

**Run prompt:**

> Conduct and implement a focused usability/accessibility pass on Vivid's
> Exploration Canvas. Verify a person can understand data provenance, sampled
> versus exact results, relationship paths, semantic versus direct queries,
> suggested-versus-applied charts, save state, permissions, and conflicts.
> Check keyboard flow, focus, labels, contrast, error messaging, and empty
> states. Make only evidence-backed, minimal UI changes. Add tests or a
> verification note with screenshots/evidence as appropriate.

### 5.4 Launch documentation and acceptance demo

**Depends on:** 5.1, 5.2, 5.3  
**Parallel with:** none

**Run prompt:**

> Prepare launch documentation and a repeatable acceptance demo for Vivid's
> Agentic Exploration Canvas. Document user capabilities, explicit safety
> boundaries, WebMCP tool inventory, semantic-layer behavior, sharing/role
> model, limits, operational setup, and rollback/incident considerations.
> Create a concise end-to-end verification script: connect datasets, build a
> governed multi-dataset chart, ask a grounded metric question, accept a chart
> suggestion through an explicit mutation, save/share, and demonstrate a
> rejected unauthorized or malformed action. Do not claim production guarantees
> not supported by implementation evidence.

**Phase exit criteria:** security, operational, and usability evidence supports
a controlled rollout.

---

## Coordination plan

### Safe parallel groups

| Group | Run in parallel | Merge/order note |
|---|---|---|
| A | 0.1, 0.2, 0.3 | Reconcile designs before Phase 1 starts. |
| B | 1.1 and 1.2 | Only after the Phase 0 contract is frozen; agree shared types first. |
| C | 1.3 and 1.4 | Both consume the completed backend; merge UI before tool wiring if files overlap. |
| D | 2.1 and 2.2 | Keep state/UI changes separate from contract/validator changes. |
| E | 3.1 and 3.2 | Independent data-model work. |
| F | 3.3 and 3.4 | Both depend on semantic metadata and canvas card model. |
| G | 4.1 and 4.2 | Coordinate database schema names before either migration is finalized. |
| H | 4.3 and 4.4 | One owns UI persistence, the other owns WebMCP registration. |
| I | 5.1, 5.2, 5.3 | Hardening tracks; launch work waits for all three. |

### Strictly sequential chains

```text
Phase 0 decision set
  -> Phase 1 query validator + backend
  -> Phase 2 multi-dataset composition
  -> Phase 3 grounded question workflow
  -> Phase 4 persistence and sharing
  -> Phase 5 launch

1.1 + 1.2 -> 1.3 -> 2.1 -> 2.3 -> 2.4
3.1 + 3.2 -> 3.3/3.4 -> 3.5
4.1 + 4.2 -> 4.3/4.4
5.1 + 5.2 + 5.3 -> 5.4
```

### Recommended coordinator checklist

1. Create one task/worktree per row in a parallel group.
2. Give every task its exact **Run prompt** above plus the repository's
   `AGENTS.md` instructions.
3. Require each task to return: changed files, tests run, unresolved decisions,
   and migration/API contracts introduced.
4. Review/merge in dependency order, running the repository test suite and
   checking for schema/contract conflicts after each group.
5. Do not dispatch a dependent task based on a verbal summary alone; start it
   only after the prerequisite changes are available in its working tree.

## First recommended execution batch

Run **0.1, 0.2, and 0.3 in parallel**. Their output establishes the contracts
that prevent later work from becoming an uncontrolled collection of charting,
database, and agent features. After a short design review, run **1.1 and 1.2**
in parallel from that agreed interface.

