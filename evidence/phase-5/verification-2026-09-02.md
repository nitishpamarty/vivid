# Exploration Canvas usability/accessibility verification — 2026-09-02

## Scope

Focused review of the Connect Data → Exploration Canvas path. The pass keeps
the existing governed query, explicit relationship, and capability boundaries;
it only makes those boundaries visible and operable with keyboard/focus.

## Browser evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Empty canvas state | Pass | Local Connect Data page announces `No cards yet` with `role=status`. |
| Sampled vs exact | Pass | Customers preview announces `Sampled preview` and states that the chart uses a separate exact aggregate query; chart errors are announced when the aggregate service is unavailable. |
| Provenance and query mode | Pass | Canvas cards expose `Direct dataset query` or `Semantic query`; table cards identify preview scope; metric answers expose consulted definitions, governed result scope, caveats, and `Suggested chart · not applied`. |
| Relationship path | Pass | Composer has labelled controls and shows selected tables/path; composed chart provenance includes the exact relationship path. |
| Save, role, and conflict state | Pass by code/DOM | Save status is live (`Loading`, `Saving`, `Saved · vN · role`, `Save unavailable`, or conflict). Persistence errors use an alert; viewer controls are disabled; conflict keeps local edits and offers explicit retry. |
| Keyboard/focus | Pass by code | Canvas cards are tab stops and select on Enter/Space; action controls, selects, inputs, and textareas have visible `:focus-visible` outlines and accessible names. |
| Local mobile layout | Pass | Existing phase-7 local smoke check found no horizontal overflow at 390×844. |
| Remote persistence / two-editor conflict | Blocked | Supabase persistence was unavailable in the local browser session; no claim is made for deployed CAS or role responses here. |

## Automated checks

- `npm run build` — pass.
- `npm run lint` — pass.
- `npm test` — 92 tests passed.
- `git diff --check` — pass.

The local browser connected to the Customers dataset (500 of ~704 rows),
showed the explicit sampled-preview banner and labelled schema controls, then
reported the exact aggregate service error as an alert. The persistence
endpoint was unavailable, so the browser did not exercise a real saved role or
CAS conflict.
