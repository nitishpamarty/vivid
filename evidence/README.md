# evidence/

A manual, dated verification log for the WebMCP tool-calling work
(Phase 2 and on — see [AGENTS.md](../AGENTS.md), built).

## Why manual

WebMCP tool-calling (`document.modelContext.registerTool`) can only be
meaningfully verified in a real agent-capable browser driving the live
page — an agent actually discovering and invoking the registered tools.
Unit tests can check the tool handler functions in isolation, but they
can't prove the registration, discovery, and execution path an agent
actually uses, so that path gets a manual log instead of (or alongside)
automated tests.

## Convention

One dated file per verification pass, under the phase it verifies:

```
evidence/phase-2/verification-YYYY-MM-DD.md
evidence/phase-3/verification-YYYY-MM-DD.md
```

Each entry follows this loop:

1. Inspect the tools the page exposes.
2. Call the read-only context tool (`get_report_context`).
3. Call the mutating tool (`update_chart_spec`) with a valid request.
4. Call it again with an invalid request.
5. Confirm the chart, any activity-log entry, and the tool's own return
   value all agree with each other.

## Stale files

A stale verification file documenting a retired tool contract is worse
than no file — it looks authoritative but proves nothing about the
current code. When the tool contract changes, write a fresh dated file
rather than patching an old one.
