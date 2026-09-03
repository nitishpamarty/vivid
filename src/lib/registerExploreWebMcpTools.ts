// WebMCP tool bridge for the Connect Data / Explore screen — same
// {ok,data}/{ok:false,reason,error} contract and registration shape as
// registerWebMcpTools.ts, pointed at a generic connected dataset instead of
// the two fixed Revenue knob sets. Validation (column existence, contract
// shape) lives in datasets.ts and is applied by the bridge implementation
// in ExploreDashboard.tsx, not here — this file only wraps calls and logs
// them, same division of labor as the Northbeam bridge.

import {
  COLUMN_TYPES,
  DATASET_CATALOG,
  fetchDatasetAggregate,
  type ColumnType,
  type ContractResult,
} from './datasets';
import { AggregateQueryError } from './datasets';
import { createQueryTools } from './registerQueryWebMcpTools.ts';
import type { NormalizedQueryContract } from './queryContract.ts';
import { callUnregisterFns } from './webmcpCleanup';

export interface DatasetSchema {
  datasetId: string;
  columns: Record<string, ColumnType>;
  overrides: Record<string, ColumnType>;
  warnings: Record<string, number>;
  totalCount: number;
  sampled: boolean;
}

export type ToolResult<T> = { ok: true; data: T } | { ok: false; reason: string; error: string };

export interface ExploreBridge {
  connectDataset: (datasetId: string) => Promise<ToolResult<DatasetSchema>>;
  getSchema: () => DatasetSchema | null;
  setColumnDisplayType: (column: string, type: ColumnType) => ToolResult<DatasetSchema>;
  getContract: () => unknown;
  setContract: (contract: unknown) => ContractResult;
  logAgent: (message: string) => void;
}

function describeCall(name: string, input: Record<string, unknown>): string {
  if (name === 'connect_dataset') return `connected dataset: ${input.datasetId}`;
  if (name === 'set_column_display_type') return `set ${input.column} display type to ${input.type}`;
  if (name === 'set_chart_contract') return `updated chart contract`;
  return `called ${name}`;
}

function tool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  run: (input: Record<string, unknown>) => unknown | Promise<unknown>,
  bridge: ExploreBridge,
) {
  return {
    name,
    description,
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const result = await run(input ?? {});
      const r = result as { ok: boolean; reason?: string };
      bridge.logAgent(r.ok ? describeCall(name, input ?? {}) : `called ${name} (rejected: ${r.reason})`);
      return result;
    },
  };
}

export function registerExploreTools(bridge: ExploreBridge): () => void {
  if (typeof document === 'undefined' || !document.modelContext) return () => {};

  const tools = [
    tool(
      'list_datasets',
      'List the datasets available to connect to on the Explore screen.',
      { type: 'object', properties: {} },
      () => ({ ok: true, data: DATASET_CATALOG.map(({ id, label }) => ({ id, label })) }),
      bridge,
    ),
    tool(
      'connect_dataset',
      'Connect to one dataset by id (from list_datasets). Loads its schema and a row sample.',
      { type: 'object', properties: { datasetId: { type: 'string' } }, required: ['datasetId'] },
      async (input) => {
        const datasetId = String(input.datasetId ?? '');
        if (!DATASET_CATALOG.some((d) => d.id === datasetId)) {
          return { ok: false, reason: 'unknown_dataset', error: `"${datasetId}" is not a known dataset. Valid ids: ${DATASET_CATALOG.map((d) => d.id).join(', ')}.` };
        }
        return bridge.connectDataset(datasetId);
      },
      bridge,
    ),
    tool(
      'get_dataset_schema',
      'Get the active dataset\'s columns, inferred types, current display-type overrides and cast-warning counts, and whether rows are sampled.',
      { type: 'object', properties: {} },
      () => {
        const schema = bridge.getSchema();
        if (!schema) return { ok: false, reason: 'not_connected', error: 'No dataset is connected yet — call connect_dataset first.' };
        return { ok: true, data: schema };
      },
      bridge,
    ),
    tool(
      'set_column_display_type',
      `Override one column's display type (presentation-time only, not a database change) to one of: ${COLUMN_TYPES.join(', ')}.`,
      {
        type: 'object',
        properties: { column: { type: 'string' }, type: { type: 'string', enum: COLUMN_TYPES } },
        required: ['column', 'type'],
      },
      (input) => {
        const type = input.type as ColumnType;
        if (!COLUMN_TYPES.includes(type)) {
          return { ok: false, reason: 'invalid_value', error: `"type" must be one of ${COLUMN_TYPES.join(', ')}.` };
        }
        return bridge.setColumnDisplayType(String(input.column ?? ''), type);
      },
      bridge,
    ),
    tool(
      'get_chart_contract',
      'Get the active versioned chart contract (version, mark, encoding, title, tooltip) for the connected dataset. The contract contains intent only; the app owns data, transforms, config, URLs, and Vega construction.',
      { type: 'object', properties: {} },
      () => {
        const contract = bridge.getContract();
        if (!contract) return { ok: false, reason: 'not_connected', error: 'No dataset is connected yet — call connect_dataset first.' };
        return { ok: true, data: contract };
      },
      bridge,
    ),
    tool(
      'set_chart_contract',
      'Apply a validated v1 chart contract: { version?: 1, mark, encoding: { x?, y?, color?, theta? }, title?, tooltip? }. Each encoding channel is { field, type, aggregate?, bin? }, field must be one of the active dataset\'s columns. Arc charts require quantitative theta and cannot use x/y; other marks require x/y and cannot use theta. tooltip is a boolean display knob derived from encoded fields. The app owns actual data, transforms, config, URLs, and Vega construction — raw-spec keys are rejected.',
      { type: 'object', properties: { contract: { type: 'object' } }, required: ['contract'] },
      (input) => {
        const result = bridge.setContract(input.contract);
        if (!result.ok) return { ok: false, reason: result.reason, error: result.error };
        return { ok: true, data: result.contract };
      },
      bridge,
    ),
  ];

  const defaultAggregateExecutor = async (query: NormalizedQueryContract): Promise<unknown> => {
    try {
      return { ok: true, data: await fetchDatasetAggregate(query) };
    } catch (error) {
      // Keep transport/edge-function internals out of the WebMCP response.
      const reason = error instanceof AggregateQueryError && error.reason === 'limit_exceeded'
        ? 'limit_exceeded'
        : 'unavailable';
      return {
        ok: false,
        reason,
        error: reason === 'limit_exceeded'
          ? 'The aggregate query exceeds the server limits.'
          : 'Aggregate query service is unavailable. Try again.',
      };
    }
  };
  tools.push(...createQueryTools(bridge.logAgent, defaultAggregateExecutor));

  const unregisterFns = tools.map((t) => document.modelContext!.registerTool(t));
  return () => callUnregisterFns(unregisterFns);
}
