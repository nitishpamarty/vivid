# Exploration Canvas launch acceptance — 2026-09-02

This is the launch rehearsal record for the acceptance flow in
[`docs/agentic-exploration-canvas-launch.md`](../../docs/agentic-exploration-canvas-launch.md).
It deliberately separates source checks from live deployment evidence. No
capability, token, customer data, or provider error belongs in this record.

## Environment

| Item | Value |
| --- | --- |
| Checkout | `/Users/nitish/projects/vivid` |
| Data | Generated fictional Vivid datasets |
| Supabase | No connected local project in this workspace |
| Browser WebMCP | Not exercised in this source-only rehearsal |
| Date | 2026-09-02 |

## Offline checks

| Check | Result | Notes |
| --- | --- | --- |
| `node scripts/verify-exploration-persistence.mjs` | Pass | Confirms migration/Edge capability hashing, RLS, role, CAS, and audit source invariants. |
| `node scripts/verify-exploration-launch.mjs` | Pass | 20 source/contract checks, including the intentional separation and App wiring of visualization and semantic WebMCP registrations. |
| `npm test` | Pass | 98 tests passed in the current checkout. |
| `npm run lint` | Pass | Exit 0 with the current source. |
| `npm run build` | Blocked by parent worktree | The current in-progress diff reports direct `document` references in `registerSemanticWebMcpTools.ts` under the node-oriented test tsconfig; this is implementation work, not an acceptance claim. |
| `git diff --check` | Pass | No whitespace errors. |

The semantic registration split is intentional: `registerWebMcpTools.ts`
authors validated Revenue visualization intent, while
`registerSemanticWebMcpTools.ts` exposes only grounded definitions and metric
queries. The launch verifier checks that distinction rather than requiring the
semantic tools to be folded into the visualization module.

## Live acceptance status

The following checks remain blocked until a disposable Supabase project and a
WebMCP-capable browser (or the documented devtools polyfill) are available:

- [ ] Discover active tools in the Connect Data surface.
- [ ] Connect `mrr_monthly`, inspect sampled schema, and run the exact
      `mrr_monthly_to_customers` aggregate.
- [ ] Render a governed multi-dataset chart with source/path provenance.
- [ ] Retrieve Cube definitions before querying a grounded business metric.
- [ ] Persist an answer and confirm its chart suggestion is visibly inert.
- [ ] Create a new chart card with an explicit mutation from that suggestion.
- [ ] Save/reopen the exploration and confirm a stale CAS save is rejected.
- [ ] Exercise owner/editor/viewer capabilities, including viewer mutation
      denial and editor rename denial.
- [ ] Submit malformed SQL/Vega/relationship input and confirm stable rejection
      with no card, state, or audit mutation.

No production guarantee is inferred from this source-only record. In
particular, SQL/RLS assertions, role behavior, Cube secret isolation, browser
tool discovery, Realtime/broadcast delivery, and two-editor CAS behavior must
be rerun against a disposable deployed Supabase environment before any real
customer data is connected.
