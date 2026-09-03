# Phase 5.1 security and adversarial verification — 2026-09-02

## Scope

This pass exercises the Exploration Canvas validators and WebMCP bridges with
hostile input, then checks the independent server boundaries in the aggregate,
semantic-layer, and exploration-state Edge Functions/RPC migrations. The
Supabase project is not connected in this workspace, so SQL/Edge checks are
source-level assertions; no production guarantee is claimed from those
assertions alone.

## Commands

```text
node --experimental-strip-types --test src/lib/securityAdversarial.test.ts
npm test
npm run lint
npm run build
git diff --check
```

All commands passed. The adversarial suite contains five tests covering:

- malformed and oversized query contracts, unknown fields, SQL-like field
  names, invalid operators/values, and executor short-circuiting;
- raw SQL/Vega/data URL card attempts with state-preserving rejection;
- capability spoofing, viewer mutation denial, host-only capability use,
  cross-exploration UUID handling, CAS error redaction, and safe audit logs;
- ungrounded semantic definitions and inert chart suggestions; and
- independent server checks for allow-listed identifiers, parameter quoting,
  explicit relationships, RLS/function grants, capability hashing, CAS,
  source/response/time limits, POST-only transport, and upstream secret/error
  redaction.

## Controls verified

- Dataset aggregation accepts only the typed catalog and the two declared
  relationship paths. SQL is generated server-side from fixed identifiers and
  quoted values; the browser cannot supply SQL, table names, join conditions,
  or Vega data/config/transform keys.
- Aggregate execution is service-role-only, transaction-timeout bounded,
  source-scan bounded, and response-byte bounded.
- Exploration core tables have RLS enabled, no browser policies, and narrow
  service-role RPC grants. Capabilities are SHA-256 digests and are checked for
  scope, revocation, and expiry before open/list/mutate. Mutations lock the row
  and compare `expectedVersion` before writing state and audit metadata.
- Persisted card envelopes now reject kind-inappropriate unknown fields and
  obvious executable escape-hatch keys at the RPC boundary, independently of
  browser validation.
- Semantic requests are POST-only, shape/definition-name/row bounded, and
  reject unknown keys. Cube credentials remain Edge Function secrets and
  upstream failures return a generic error without forwarding provider text.

## Limitations / follow-up

The current fictional demo intentionally has no authenticated tenant scope;
capability possession is the grant. Cross-tenant isolation, revocation UI,
rate/concurrency quotas, and live Supabase integration tests remain production
follow-ups described in the threat model. SQL/Edge source assertions should be
re-run against a disposable Supabase project before any real customer data is
connected.
