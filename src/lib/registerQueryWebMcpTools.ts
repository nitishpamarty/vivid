import {
  QUERY_AGGREGATES,
  QUERY_DATASET_CATALOG,
  QUERY_DATASET_IDS,
  QUERY_FILTER_OPERATORS,
  QUERY_LIMITS,
  QUERY_TIME_GRAINS,
  RELATIONSHIP_CATALOG,
  getReachableDatasets,
  validateQueryContract,
  type NormalizedQueryContract,
} from './queryContract.ts';
import { callUnregisterFns } from './webmcpCleanup.ts';

type ToolResult<T> = { ok: true; data: T } | { ok: false; reason: string; error: string };

export interface AggregateQueryData {
  rows: readonly Readonly<Record<string, unknown>>[];
  metadata: {
    sourceTables: readonly string[];
    relationshipPath: readonly string[];
    truncated: boolean;
    resultCount: number;
    appliedLimits: {
      limit: number;
      offset: number;
      maxSourceRows: number;
      maxResponseBytes: number;
      statementTimeoutMs: number;
    };
  };
}

export type AggregateQueryExecutor = (query: NormalizedQueryContract) => Promise<unknown>;

const MAX_RESPONSE_BYTES = 1_000_000;
const STATEMENT_TIMEOUT_MS = 5_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asSafeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) ? value : fallback;
}

function boundedLimit(value: unknown, fallback: number): number {
  return Math.min(QUERY_LIMITS.maxLimit, Math.max(1, asSafeInteger(value, fallback)));
}

function boundedOffset(value: unknown, fallback: number): number {
  return Math.min(QUERY_LIMITS.maxOffset, Math.max(0, asSafeInteger(value, fallback)));
}

function expectedRowKeys(query: NormalizedQueryContract): Set<string> {
  return new Set([
    ...query.dimensions.map(({ field }) => `${field.dataset}.${field.field}`),
    ...query.measures.map(({ field, aggregate }) => `${field.dataset}.${field.field}:${aggregate}`),
  ]);
}

const SERVER_REASONS = new Set([
  'invalid_query', 'unknown_field', 'unknown_dataset', 'unknown_relationship',
  'invalid_relationship_path', 'field_not_in_path', 'invalid_dimension',
  'invalid_measure', 'invalid_filter', 'invalid_operator', 'invalid_value',
  'invalid_sort', 'unsupported_time_grain', 'invalid_pagination',
  'limit_exceeded', 'payload_too_large', 'rate_limited', 'timeout', 'unavailable',
]);

function safeServerFailure(rawReason: unknown): { reason: string; error: string } {
  const reason = typeof rawReason === 'string' && SERVER_REASONS.has(rawReason) ? rawReason : 'unavailable';
  return {
    reason,
    error: reason === 'limit_exceeded' || reason === 'payload_too_large'
      ? 'The aggregate query exceeds the server limits.'
      : reason === 'rate_limited'
        ? 'Aggregate query quota exceeded. Try again shortly.'
        : reason === 'timeout'
          ? 'Aggregate query timed out. Try a smaller query.'
      : reason === 'unavailable'
        ? 'Aggregate query service is unavailable. Try again.'
        : 'The aggregate query was rejected by the server.',
  };
}

function normalizeAggregateResponse(raw: unknown, query: NormalizedQueryContract): ToolResult<AggregateQueryData> {
  if (!isObject(raw)) return { ok: false, reason: 'unavailable', error: 'Aggregate query service returned an invalid response.' };
  if (raw.ok !== true) {
    return { ok: false, ...safeServerFailure(raw.reason) };
  }
  if (!isObject(raw.data) || !Array.isArray(raw.data.rows) || !isObject(raw.data.metadata)) {
    return { ok: false, reason: 'unavailable', error: 'Aggregate query service returned an invalid response.' };
  }

  // The server emits only these names. Filtering at this boundary keeps a
  // malformed or compromised transport from turning the tool into a row dump.
  const allowedKeys = expectedRowKeys(query);
  const rows = raw.data.rows.slice(0, query.limit).map((row) => {
    if (!isObject(row)) return {};
    return Object.fromEntries(Object.entries(row).filter(([key]) => allowedKeys.has(key)));
  });
  const metadata = raw.data.metadata;
  const expectedSourceTables = getReachableDatasets(query.source, query.relationshipPath);
  const applied = isObject(metadata.appliedLimits) ? metadata.appliedLimits : {};
  const resultCount = Math.min(
    Math.max(0, asSafeInteger(metadata.resultCount, rows.length)),
    query.limit,
  );

  return {
    ok: true,
    data: {
      rows,
      metadata: {
        // These values are derived from the validated contract rather than
        // accepting arbitrary table names supplied by the transport.
        sourceTables: expectedSourceTables,
        relationshipPath: query.relationshipPath,
        truncated: metadata.truncated === true || raw.data.rows.length > rows.length,
        resultCount,
        appliedLimits: {
          limit: boundedLimit(applied.limit, query.limit),
          offset: boundedOffset(applied.offset, query.offset),
          maxSourceRows: QUERY_LIMITS.maxSourceRows,
          maxResponseBytes: MAX_RESPONSE_BYTES,
          statementTimeoutMs: STATEMENT_TIMEOUT_MS,
        },
      },
    },
  };
}

function describeFailure(name: string, result: ToolResult<unknown>): string {
  return result.ok ? `called ${name}` : `called ${name} (rejected: ${result.reason})`;
}

function queryOptions() {
  return {
    datasets: QUERY_DATASET_IDS.map((id) => {
      const definition = QUERY_DATASET_CATALOG[id];
      return {
        id,
        fields: Object.entries(definition.fields).map(([name, field]) => ({
          name,
          type: field.type,
          ...(field.dimension ? { dimension: true } : {}),
          ...(field.filterable ? { filterable: true } : {}),
          ...(field.aggregates ? { aggregates: field.aggregates } : {}),
        })),
      };
    }),
    relationships: RELATIONSHIP_CATALOG.map(({ id, from, to, localKey, foreignKey }) => ({ id, from, to, localKey, foreignKey })),
    aggregates: QUERY_AGGREGATES,
    filterOperators: QUERY_FILTER_OPERATORS,
    timeGrains: QUERY_TIME_GRAINS,
    limits: {
      defaultLimit: QUERY_LIMITS.defaultLimit,
      maxLimit: QUERY_LIMITS.maxLimit,
      maxOffset: QUERY_LIMITS.maxOffset,
      maxDimensions: QUERY_LIMITS.maxDimensions,
      maxMeasures: QUERY_LIMITS.maxMeasures,
      maxFilters: QUERY_LIMITS.maxFilters,
      maxSort: QUERY_LIMITS.maxSort,
      maxFilterValues: QUERY_LIMITS.maxFilterValues,
    },
  };
}

function descriptor(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  run: (input: Record<string, unknown>) => Promise<ToolResult<unknown>> | ToolResult<unknown>,
  logAgent: (message: string) => void,
) {
  return {
    name,
    description,
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      let result: ToolResult<unknown>;
      try {
        result = await run(input ?? {});
      } catch {
        result = { ok: false, reason: 'unavailable', error: 'Aggregate query service is unavailable. Try again.' };
      }
      logAgent(describeFailure(name, result));
      return result;
    },
  };
}

/** Build the two query tools so they can be tested with a document polyfill. */
export function createQueryTools(logAgent: (message: string) => void, executeAggregate: AggregateQueryExecutor) {
  return [
    descriptor(
      'get_query_options',
      'List the approved datasets, fields, relationships, aggregates, filters, time grains, and query limits for query_dataset_aggregate. This is an allow-list, not a database schema or SQL interface.',
      { type: 'object', properties: {} },
      () => ({ ok: true, data: queryOptions() }),
      logAgent,
    ),
    descriptor(
      'query_dataset_aggregate',
      'Run an exact, bounded aggregate over approved dataset fields. Pass { query: { source, relationshipPath?, dimensions, measures, filters?, sort?, timeGrain?, limit?, offset? } }. The server owns SQL and returns aggregate rows plus source, relationship, truncation, result-count, and applied-limit metadata; raw SQL and unrestricted rows are not accepted.',
      { type: 'object', properties: { query: { type: 'object' } }, required: ['query'] },
      async (input) => {
        const validation = validateQueryContract(input.query);
        if (!validation.ok) return validation;
        return normalizeAggregateResponse(await executeAggregate(validation.data), validation.data);
      },
      logAgent,
    ),
  ];
}

export function registerQueryTools(
  logAgent: (message: string) => void,
  executeAggregate: AggregateQueryExecutor,
): () => void {
  // Read through globalThis so the pure registration module remains
  // testable in Node (which has no DOM lib) while still using the browser's
  // document.modelContext polyfill/implementation.
  type ModelContextLike = { registerTool: (tool: unknown) => unknown };
  const modelContext = (globalThis as unknown as { document?: { modelContext?: ModelContextLike } }).document?.modelContext;
  if (!modelContext) return () => {};
  const unregisterFns = createQueryTools(logAgent, executeAggregate).map((tool) => modelContext.registerTool(tool));
  return () => callUnregisterFns(unregisterFns);
}
