# Shared-state verification — 2026-09-02

## Status

Blocked at the production deployment boundary. The local production build is usable for the no-room and mobile smoke checks, but the deployed site does not mount the application because its Supabase build variables are absent.

This artifact was rechecked against the current working tree on 2026-09-02. The fresh local no-room check again rendered the explicit session CTA with no local console errors; no room was created during verification. Shared readiness now requires both the authoritative fetch and the Realtime subscription, so a Realtime failure cannot be overwritten by a later fetch success.

## Browser evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Production URL | Blocked | `https://vividdata.pages.dev/` returned title `Northbeam`, an empty DOM, and console error `Error: Missing VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY env vars` from the observed production bundle `assets/index-Clj-yHSV.js`. |
| Local built bundle, no room | Pass | `http://127.0.0.1:4173/` showed the Vivid landing page with `Start a live dashboard session`, an explicit `Start live session` button, and the bearer-link limitation text. |
| Local mobile layout | Pass | At 390×844, `clientWidth` and `scrollWidth` were both 390; no horizontal overflow; zero console errors. |
| Start-session flow | Not run | Requires configured Supabase room creation. |
| Two-client shared updates | Blocked | Requires deployed schema, Edge Function, and a working production build. |
| CAS conflict / structured error | Not run | Requires the deployed `shared-state` Edge Function. |
| Undo / remote update behavior | Not run | Requires two configured clients and Realtime. |
| Connect Data regression | Local only | Production verification is blocked before the app mounts. |
| Production WebMCP contract | Blocked | No production `document.modelContext` registration is observable while the app fails during startup. |

## Automated checks

- `npm test`: 21 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed; Vite emitted the existing large-chunk warning.
- `git diff --check`: passed.
- Secret-name scan: no capability or service-role value is rendered or written to activity messages.

## Required manual deployment actions

1. Review any legacy global `dashboard_state`/`activity_log` tables, then apply migrations `0001_connect_data.sql`, `0002_shared_sessions.sql`, and `0003_shared_state_rpc.sql` in Supabase. The room migration is intentionally not a legacy-table shape conversion.
2. Deploy `supabase/functions/shared-state/index.ts` with the Supabase service-role secret configured only as an Edge Function secret.
3. Enable Realtime for the room-scoped `dashboard_state` and `activity_log` tables.
4. Configure Cloudflare Pages with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then redeploy.
5. Re-run the two-tab verification using a fresh fragment URL and confirm room creation, shared chart/filter changes, activity entries, stale-write conflicts, undo, reload persistence, and Connect Data.

The session key is a bearer capability in the URL fragment. It is not a login or tamper-proof model-provenance mechanism; expiry and cleanup remain operator responsibilities.
