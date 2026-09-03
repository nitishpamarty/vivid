# Exploration Canvas observability and quotas

The four canvas transports (`aggregate-query`, `semantic-layer`,
`shared-state`, and `exploration-state`) use the same small Edge transport
guard in `supabase/functions/_shared/observability.ts`.

## Safe telemetry

Each response carries an `X-Request-Id`. The Edge runtime emits one structured
`vivid_request` event containing only the route, allow-listed operation (when
available), HTTP status, latency in milliseconds, and request id. Request
bodies, rows, prompts, bearer capabilities, capability digests, authorization
tokens, Cube errors, and SQL are never logged. The request id is safe to give
to a user when reporting an incident.

## Limits and configuration

The following Supabase Edge Function environment variables are optional. Values
are clamped server-side, so a bad deployment setting cannot disable the guard.

| Variable | Default | Range | Applies to |
| --- | ---: | ---: | --- |
| `VIVID_MAX_REQUEST_BYTES` | 1,250,000 | 16,384–2,000,000 | JSON request body ceiling for aggregate/shared/exploration transports |
| `VIVID_QUERY_RATE_PER_MINUTE` | 60 | 1–600 | aggregate and semantic requests |
| `VIVID_MUTATION_RATE_PER_MINUTE` | 30 | 1–600 | shared-state and exploration-state writes |
| `VIVID_READ_RATE_PER_MINUTE` | 120 | 1–600 | reserved for read-only persistence operations |
| `VIVID_REQUEST_TIMEOUT_MS` | 5,000 | 500–10,000 | Edge-to-provider/RPC response budget |

Semantic and aggregate query requests retain their stricter 64 KiB query
payload ceiling. The
aggregate RPC also enforces its SQL statement timeout and source/response
limits. A rejected request returns a stable reason (`rate_limited`,
`payload_too_large`, `timeout`, or `limit_exceeded`) with a generic message;
clients display that message in the same error state for UI and WebMCP paths.

Rate limiting is a first-line per-capability/principal guard (the identity is
hashed for the in-memory key) and falls back to the proxy client address when
there is no identity. It is intentionally per warm Edge isolate for this
fictional no-login demo. A production multi-tenant deployment must move the
counter to a shared gateway/Redis/Supabase quota keyed by authenticated
principal plus `tenant_id`, and enforce tenant scope in the RPC/RLS policy; the
request body must never be trusted as tenant authority.

## Verification

Focused unit tests cover bounded defaults, per-key windows/retry hints, hashed
identity keys, and oversized-body rejection:

```sh
npm test -- --test-name-pattern='request limits|rate limiter|request identity'
npm run build
```
