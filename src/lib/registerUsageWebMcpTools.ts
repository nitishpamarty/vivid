// Product Usage's own WebMCP tool set — a separate module from
// registerWebMcpTools.ts (Revenue's) so the two report surfaces never
// register overlapping generic names (`get_report_context` etc.) at once.
// Registered only while the Usage tab is active; see App.tsx's lifecycle
// effect for the mount/unmount that enforces that.

import { USAGE_FILTER_OPTIONS, validateUsageFilterPatch, type UsageFilters } from './usageFilters.ts';
import { callUnregisterFns } from './webmcpCleanup.ts';

export interface UsageToolBridge {
  getContext: () => Record<string, unknown>;
  getOptions: () => Record<string, unknown>;
  getFilters: () => UsageFilters;
  applyFilterPatch: (patch: Record<string, unknown>) => Promise<UsageFilters>;
  getValidReportIds: () => readonly string[];
  getValidMonths: () => readonly string[];
  findValues: (phrase: string) => { field: string; value: string } | null;
}

function tool(name: string, description: string, inputSchema: Record<string, unknown>, run: (input: Record<string, unknown>) => unknown) {
  return {
    name,
    description,
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      try {
        return await run(input ?? {});
      } catch (error) {
        if (error instanceof Error && error.message === 'not_ready') {
          return { ok: false, reason: 'not_ready', error: 'Shared session is still connecting.' };
        }
        return { ok: false, reason: 'unavailable', error: 'Shared session is unavailable. Try again.' };
      }
    },
  };
}

export function registerUsageTools(bridge: UsageToolBridge): () => void {
  // Read through globalThis so this pure registration module remains
  // testable in Node (which has no DOM lib) while still using the browser's
  // document.modelContext polyfill/implementation — same pattern as
  // registerQueryWebMcpTools.ts/registerCanvasWebMcpTools.ts.
  type ModelContextLike = { registerTool: (tool: unknown) => unknown };
  const modelContext = (globalThis as unknown as { document?: { modelContext?: ModelContextLike } }).document?.modelContext;
  if (!modelContext) return () => {};

  const tools = [
    tool(
      'get_usage_context',
      'Get the active Product Usage report id, the current filters (ownerTeam, reportId, asOfMonth), current KPIs, visible top reports, team shares, available filter options, and the explicit global scope of the activity heatmap (a typical-week aggregate not cross-filtered by these filters). Product Usage charts have no presentation/chart-type tool — only filters can be changed here; do not guess or recall a chart-type capability from another report before checking that report\'s own tools.',
      { type: 'object', properties: {} },
      () => ({ ok: true, data: bridge.getContext() }),
    ),
    tool(
      'list_usage_options',
      'List the allow-list for ownerTeam, reportId, and asOfMonth — the only values set_usage_filters will accept — plus the supported click actions (toggle a team row or report row).',
      { type: 'object', properties: {} },
      () => ({ ok: true, data: bridge.getOptions() }),
    ),
    tool(
      'set_usage_filters',
      'Set one or more Product Usage filters (ownerTeam, reportId from list_usage_options or find_usage_values; asOfMonth from list_usage_options). Use "all" to clear ownerTeam or reportId. Validated patch, atomic replace.',
      { type: 'object', properties: { patch: { type: 'object' } }, required: ['patch'] },
      async (input) => {
        const patch = input.patch as Record<string, unknown>;
        const validation = validateUsageFilterPatch(patch, bridge.getValidReportIds(), bridge.getValidMonths());
        if (!validation.ok) return { ok: false, reason: validation.reason, error: validation.error };
        const data = await bridge.applyFilterPatch(patch);
        return { ok: true, data };
      },
    ),
    tool(
      'find_usage_values',
      'Resolve a free-text phrase (a team name or a report name) to the canonical field/value pair set_usage_filters expects, without receiving the whole catalog in every context response.',
      { type: 'object', properties: { phrase: { type: 'string' } }, required: ['phrase'] },
      (input) => {
        const phrase = String(input.phrase ?? '').trim();
        if (!phrase) return { ok: false, reason: 'invalid_query', error: 'phrase must be a non-empty string.' };
        const guess = bridge.findValues(phrase);
        if (!guess) return { ok: false, reason: 'no_match', error: `No known team or report matches "${phrase}".` };
        return { ok: true, data: guess };
      },
    ),
  ];

  const unregisterFns = tools.map((t) => modelContext.registerTool(t));
  return () => callUnregisterFns(unregisterFns);
}

export { USAGE_FILTER_OPTIONS };
