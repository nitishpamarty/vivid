# Exploration Canvas persistence

Phase 4.1 uses a deliberately small snapshot model. Each `explorations` row
stores the canvas name, schema version, monotonically increasing version, and a
bounded JSON snapshot whose only field is the ordered `cards` array. Cards are
one aggregate and are always read or replaced together, so a normalized card
table would add partial-update and reorder semantics without a current query
need. The snapshot is capped at 100 cards and 1 MiB. `schema_version` is a
separate column so future decoders can migrate old payloads explicitly.

## Capability-link demo policy

There is no identity provider in this demo. `exploration_capabilities` stores a
SHA-256 digest, role (`owner`, `editor`, or `viewer`), optional expiry, and
revocation timestamp for each exploration. The plaintext capability is only
accepted in the request to the `exploration-state` Edge Function, hashed with
Web Crypto immediately, and never sent to Postgres, returned, or written to an
audit event. The owner capability is required to create an exploration; the
create request may also seed up to seven editor/viewer share capabilities.
Production use requires authenticated principals or scoped, expiring,
revocable least-privilege links; this demo intentionally does not establish
person or browser-model identity.

The enforced role matrix for this demo is deliberately small: owner, editor,
and viewer grants may open a canvas; owner and editor grants may replace the
versioned snapshot; viewer grants are read-only; and only the owner may rename
the exploration. The current endpoint has no share-management or delete
operation, so those owner-management capabilities remain a production
prerequisite rather than an implied permission. `actor` is an audit claim and
does not elevate a capability role.

The three core tables have RLS enabled and no browser-role policies. Direct
REST, realtime, and table writes are therefore denied. The service-role Edge
Function is the transport and is granted only the narrow RPCs below. The RPCs
use `SECURITY DEFINER`, a fixed `search_path`, capability/expiry checks, and
bounded payload checks. Audit events contain only stable metadata (role,
actor-kind claim, source, action, version, mutation/card ids); they do not
store snapshots, prompts, SQL, Vega specs, capabilities, or provider tokens.

## Tenant boundary

This no-login demo has no identity provider and no `tenant_id` column: a
capability is scoped only to its exploration, and the generated datasets are
deliberately fictional/public. The Edge Function rejects client authority
fields such as tenant or role, but it cannot establish cross-tenant identity
without authentication. Before using this schema with customer data, add a
server-derived principal and tenant scope to explorations, capabilities,
audit events, every dataset/RPC query, and realtime authorization; do not copy
the demo's bearer-editor or public dataset policy into that deployment.

## Edge Function API

`POST /functions/v1/exploration-state` accepts JSON and returns the established
`{ ok: true, data }` / `{ ok: false, reason, error }` envelope.

- `create_exploration`: `{ operation, name, schemaVersion: 1, snapshot:
  {cards: [...]}, capability, shares?: [{capability, role: 'editor' |
  'viewer'}], actor?: 'person' | 'agent' | 'system' }`. The response includes
  the generated `explorationId`, snapshot, version `0`, and role, never any
  capability.
- `open_exploration`: `{ operation, explorationId, capability, actor? }`.
  Valid owner/editor/viewer grants return the current snapshot/version.
- `mutate_exploration`: `{ operation, explorationId, capability,
  expectedVersion, snapshot: {cards: [...]}, action, mutationId, cardId?,
  name?, actor? }`. Owner/editor grants can replace the bounded snapshot. The
  RPC locks the exploration row, compares `expectedVersion`, increments the
  version exactly once, and inserts the audit row in the same transaction.
  A stale version returns `reason: "version_conflict"` and `currentVersion`
  without changing state; viewers receive `reason: "unauthorized"`.

The function does not expose the service-role key, raw SQL, or a generic table
operation. Canvas UI save/load wiring is handled separately from the WebMCP
registration below.

The persisted WebMCP surface binds the capability in the browser host rather
than accepting it as model-authored input. It exposes `list_explorations`,
`open_exploration`, `create_exploration`, and `update_exploration`. Listing is
capability-scoped and returns only compact ids/names/roles/versions; opening
returns the validated cards. Create and update snapshot the current validated
canvas, and update requires `expectedVersion`. Viewer grants are rejected
locally and server-side, editor grants may update cards, and only owner grants
may rename. A stale update returns `version_conflict` with `currentVersion`;
no snapshot is applied and no capability is included in the response or agent
activity message.

## Verification

`node scripts/verify-exploration-persistence.mjs` performs a static migration
and Edge Function check in this repository (there is no local Supabase
database configured for an integration race). It verifies RLS/default-deny
grants, digest-only capability storage, absence of payloads in audit columns,
row locking plus expected-version CAS, bounded snapshots, and immediate
capability hashing. The SQL transaction shape gives the concurrency guarantee:
two updates for one version serialize on `FOR UPDATE`; one increments the
version and the other returns a conflict.
