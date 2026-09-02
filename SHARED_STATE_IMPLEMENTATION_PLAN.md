# Shared-state implementation plan

## Decisions already made

- **No login for now.** Do not add account management, OAuth, or a general permissions system.
- **Per-session sharing.** A presenter starts a session and shares its link with a viewer. The public landing page must not be one mutable global dashboard.
- **Keep the WebMCP boundary browser-native.** Do not add an MCP server. A small Supabase mutation boundary is acceptable for shared-state integrity, but must not be presented as an MCP server.
- **Stay narrow.** Revenue remains the only WebMCP-editable report. Do not generalize into a report platform or build multi-editor merge/OT.

## Target design

Each session has a random `roomId` plus a high-entropy write capability. The complete share URL keeps both in its fragment:

```text
https://vividdata.pages.dev/#room=<uuid>&key=<random-secret>
```

Fragments are not sent in normal HTTP requests, so the capability is less likely to be leaked through server logs or referrers. The browser reads it and supplies it only to the Supabase mutation endpoint. Everyone with the link is an editor for this no-login demo; that is a deliberate, documented limitation.

The browser should have no direct write access to `dashboard_state` or `activity_log`. A small Supabase Edge Function verifies the room capability, then invokes a server-only Postgres RPC that atomically:

1. checks the expected state version;
2. validates and applies the requested mutation;
3. increments the version;
4. writes the associated activity record; and
5. returns the new state, version, and activity event.

Realtime remains a notification/synchronization mechanism. The mutation response and database transaction are the source of truth.

This prevents arbitrary public REST writes to every session. It does **not** establish cryptographic proof that an action came from a browser model: page JavaScript can always be invoked by someone who holds the room capability. In the product copy, call the log a shared application audit trail, not tamper-proof agent provenance.

## Task order

Complete these prompts in order. Each is intentionally self-contained. Do not deploy, apply remote migrations, or expose secrets without explicit approval; make the local code and migration artifacts, run local checks, and report the required remote actions.

### Task 0 — Reconcile production before changing more code

```text
Review the current Vivid working tree and https://vividdata.pages.dev. The repository contains Supabase/shared-session work that may not yet be deployed. Do not edit files.

Report only:
1. the observable differences between production and the working tree (WebMCP tool contract, filters, tabs, persistence behavior);
2. the exact build-time environment variables and database/migration prerequisites production needs, without printing secret values;
3. whether npm test, npm run lint, and npm run build pass locally; and
4. a concise deployment checklist.

Treat the live URL as the submission artifact. Do not claim a feature is complete until it is present there.
```

### Task 1 — Make pure validation tests independent of Vite/Supabase configuration

```text
In /Users/nitish/projects/vivid, fix the current npm test failure without adding dependencies and without requiring .env.local.

The failure occurs because validation.test.ts imports chartState.ts, which imports the browser-only Supabase module and reads import.meta.env under Node. Preserve the existing public validation APIs and TypeScript/Vite behavior.

Prefer the smallest correct separation: pure chart/filter options and validators must be importable in Node without loading Supabase, while browser persistence may keep its Vite environment dependency. Do not mock or print production credentials, and do not weaken validation.

Add/keep focused tests for valid values, invalid chart/filter fields, off-step barWidth, and invalid account names. Run npm test, npm run lint, and npm run build. Report changed files and results.
```

### Task 2 — Introduce a no-login per-session room model

```text
In /Users/nitish/projects/vivid, design and implement the client-side room/session model for shared dashboards. Do not deploy or run remote Supabase migrations; create migration SQL or a clearly named migration artifact and document the remote steps instead.

Product decisions:
- no login;
- a presenter starts a fresh live session and shares its URL;
- anyone holding that URL may edit for this demo;
- do not keep one globally mutable public room;
- Revenue is the only WebMCP-editable report.

Use a UUID room id and a cryptographically strong random write capability. Put room id and capability in the URL fragment, not query parameters. On a URL without a room fragment, show a safe landing/default experience with an explicit “Start live session” action; do not silently connect everyone to one shared state.

Define the smallest data model required for rooms, dashboard state, and activity. Include expiry/cleanup guidance but do not build a scheduled cleanup system. Do not add login, a general multi-tenant abstraction, or a full permissions UI.

Ensure secrets are never logged, rendered as normal page text, or persisted in activity rows. Add focused unit tests for URL parsing/generation. Run the existing checks and summarize the required Supabase migration and deployment actions.
```

### Task 3 — Centralize mutations, version state, and atomically write activity

```text
In /Users/nitish/projects/vivid, replace direct browser writes to Supabase dashboard_state and activity_log with a narrow, no-login shared-session mutation boundary. Do not deploy or apply remote migrations; produce the code and SQL artifacts plus exact manual remote steps.

Assume Task 2's room id and write capability are available to the client. Build the smallest design that provides:
- server-side verification of a hashed room write capability;
- a monotonically increasing dashboard version;
- compare-and-swap mutation using expectedVersion;
- atomic state update plus activity-log insert;
- a structured conflict response when expectedVersion is stale;
- direct browser table writes denied by RLS; and
- Realtime read/subscription support scoped to the room.

Use a Supabase Edge Function plus a server-only Postgres RPC/transaction if that is the smallest reliable way to make state and activity atomic. This is not an MCP server. Keep WebMCP tool registration in the browser and preserve the existing validated tool contract.

Do not claim this cryptographically proves a browser-model identity. Record source/actor as application metadata and document the no-login capability-holder threat model.

Add tests for client request/result handling where feasible without credentials. Run npm test, npm run lint, and npm run build, then report all manual Supabase setup steps separately.
```

### Task 4 — Eliminate cold-start and Realtime hydration races

```text
In /Users/nitish/projects/vivid, make shared dashboard startup race-safe after the room/version mutation work exists.

Current risk: WebMCP registration and person edits can occur while the dashboard is still showing defaults, then a delayed Supabase load can overwrite the edit. A Realtime event can also race with the initial fetch.

Implement an explicit lifecycle: connecting, ready, unavailable. Subscribe before fetching the authoritative state, and use the monotonic version to ensure an older fetch cannot overwrite a newer Realtime event. Register WebMCP tools early only if mutation handlers return a machine-readable not_ready error until ready; otherwise register them after ready. Do not silently fall back to a fake shared state on connection failure.

Add a small, unobtrusive visible shared-session status. Keep the dashboard usable for a local non-shared landing state only when that is clearly labelled.

Test delayed initial fetch plus an intervening remote update, a failed connection, and an immediate WebMCP mutation attempt. Run npm test, npm run lint, and npm run build.
```

### Task 5 — Make Undo safe in a shared session

```text
In /Users/nitish/projects/vivid, redesign Undo for versioned shared dashboard state. Do not add collaborative merge algorithms or redo branches.

Undo must be a shared mutation, not a client-local snapshot silently written over newer remote state. Store enough information in each local undo frame to identify the resulting server version and mutation. On Undo, send compare-and-swap expectedVersion. If another viewer has changed the dashboard since that local edit, reject the undo without overwriting anything, clear/disable stale history, and explain briefly in the UI that the dashboard changed elsewhere.

Remote updates from another viewer should invalidate stale undo frames. A successful undo must generate one shared activity entry that identifies it as an undo.

Preserve the existing simple single-driver feel: no OT, CRDT, or speculative rebase. Add focused tests around successful undo and conflict rejection, then run npm test, npm run lint, and npm run build.
```

### Task 6 — Align account discovery with account validation

```text
In /Users/nitish/projects/vivid, align the accountName WebMCP contract with its validation.

Today the validator permits any exact known customer name, while get_report_context exposes only the current top five and some tool text implies those are the only valid names. Preserve free-text account drill-down and avoid turning every customer into a huge context payload.

Add the smallest useful read-only discovery route: either a dedicated account-value lookup tool accepting a phrase/query and returning a short list of exact canonical account names, or extend the existing resolver only if its output remains unambiguous and usable by an agent. Update descriptions, error messages, tests, README, and AGENTS.md so they all agree. Do not add a general search framework.

Run npm test, npm run lint, and npm run build.
```

### Task 7 — Prove the deployed shared-session flow

```text
Perform a final release verification for Vivid after the room, mutation, hydration, and undo changes are deployed. Do not make unapproved production changes.

Using two independent browser tabs or profiles with the same room URL, verify:
1. initial state loads identically;
2. an agent WebMCP chart/filter mutation updates both tabs and creates exactly one understandable activity entry;
3. a person mutation updates both tabs;
4. a stale Undo is rejected after a remote edit and does not overwrite shared state;
5. an invalid patch and an invalid account name leave state unchanged;
6. refresh restores the room state and activity log;
7. a no-room landing page does not join a globally mutable session;
8. mobile has no page-level horizontal overflow; and
9. production console has no errors.

Also run npm test, npm run lint, and npm run build. Write a dated verification artifact under evidence/ that reports exact observed behavior, known no-login capability-holder limitations, and the production URL/version tested. Do not include keys, room capabilities, or private data in the evidence file.
```

## Definition of done

The shared-state work is complete when:

- the deployed demo uses a per-session URL, not a mutable global room;
- browser clients cannot directly write state/log rows;
- every shared mutation is version-checked and creates state plus activity atomically;
- startup cannot overwrite an early mutation with stale hydration;
- Undo cannot overwrite another viewer’s later change;
- the activity log is accurately described as an application audit trail, not unforgeable agent provenance;
- all local checks pass without requiring secret files for pure unit tests; and
- a fresh production verification artifact proves the actual deployed flow.
