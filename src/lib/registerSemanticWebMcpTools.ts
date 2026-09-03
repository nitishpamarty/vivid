import type { SemanticLayerResult } from './semanticLayerClient.ts';
import { callUnregisterFns } from './webmcpCleanup.ts';

export interface SemanticToolBridge {
  getBusinessDefinitions: () => Promise<SemanticLayerResult>;
  queryBusinessMetric: (query: Record<string, unknown>) => Promise<SemanticLayerResult>;
}

type ToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

type ModelContextLike = { registerTool: (tool: ToolDescriptor) => unknown };

function tool(name: string, description: string, inputSchema: Record<string, unknown>, run: (input: Record<string, unknown>) => unknown): ToolDescriptor {
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

export function registerSemanticWebMcpTools(bridge: SemanticToolBridge): () => void {
  const modelContext = (globalThis as unknown as { document?: { modelContext?: ModelContextLike } }).document?.modelContext;
  if (!modelContext) return () => {};

  const tools = [
    tool(
      'get_business_definitions',
      'Get the semantic layer\'s schema: every metric and dimension available across the underlying dataset (MRR, customers, CAC, employees, reports, report views, activity), what each one means, and how the tables relate. Every measure/dimension name is a Cube member key in "<cube>.<field>" format (e.g. "mrr_monthly.total_mrr", "customers.region") — the same format get_report_context/list_report_options return as each chart\'s metricKey, so a chart\'s metricKey can be looked up here directly, no reformatting needed. Ground an open-ended business question here before answering it or before calling query_business_metric — this is the source of truth for what things mean, separate from the two agent-editable charts.',
      { type: 'object', properties: {} },
      () => bridge.getBusinessDefinitions(),
    ),
    tool(
      'query_business_metric',
      'Run a query against the semantic layer for real numbers behind an open-ended business question — anything outside the two agent-editable charts (e.g. "MRR by region", "report views by owner team"), or to fetch the live value behind a chart\'s metricKey. Pass a Cube query object using "<cube>.<field>" member names from get_business_definitions: { measures: string[], dimensions?: string[], filters?: object[], timeDimensions?: object[] }. Example: to check the ARR bridge chart\'s number, take its metricKey from get_report_context (e.g. "mrr_monthly.total_mrr") and pass it straight through as { measures: ["mrr_monthly.total_mrr"] }.',
      { type: 'object', properties: { query: { type: 'object' } }, required: ['query'] },
      (input) => bridge.queryBusinessMetric(input.query as Record<string, unknown>),
    ),
  ];

  const unregisterFns = tools.map((t) => modelContext.registerTool(t));
  return () => callUnregisterFns(unregisterFns);
}
