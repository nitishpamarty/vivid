import {
  QUERY_DATASET_CATALOG,
  QUERY_DATASET_IDS,
  QUERY_FILTER_OPERATORS,
  QUERY_LIMITS,
  getReachableDatasets,
  validateQueryContract,
  type NormalizedQueryContract,
} from './queryContract.ts';
import { createCanvasState, type CanvasState } from './explorationCanvas.ts';
import type {
  AnswerCard,
  BoundedQueryResult,
  CanvasCard,
  ChartCard,
  ChartContract,
  QuestionCard,
  QueryScalar,
  SemanticQueryContract,
  TablePreviewCard,
} from './explorationModel.ts';
import { callUnregisterFns } from './webmcpCleanup.ts';

type ToolResult<T> = { ok: true; data: T } | { ok: false; reason: string; error: string };

export interface CanvasBridge {
  getState: () => CanvasState;
  replaceState: (state: CanvasState) => void;
  logAgent: (message: string) => void;
}

/**
 * Optional persistence transport for the canvas tools. The capability is
 * deliberately supplied by the host (for example, a share-link session), not
 * by model-authored tool input. `invokePersistence` is injectable so the
 * contract can be tested without a Supabase client or credentials.
 */
export interface PersistedCanvasBridge extends CanvasBridge {
  getCapability: () => string | null | undefined;
  getExplorationId: () => string | null | undefined;
  getVersion: () => number | null | undefined;
  getRole?: () => 'owner' | 'editor' | 'viewer' | null | undefined;
  setPersistedExploration?: (record: PersistedExploration) => void;
  invokePersistence?: (body: Record<string, unknown>) => Promise<unknown>;
}

export interface PersistedExploration {
  explorationId: string;
  schemaVersion: 1;
  name: string;
  snapshot: { cards: readonly CanvasCard[] };
  version: number;
  role: 'owner' | 'editor' | 'viewer';
  createdAt?: string;
  updatedAt?: string;
}

export interface PersistedExplorationSummary {
  explorationId: string;
  schemaVersion: 1;
  name: string;
  version: number;
  role: 'owner' | 'editor' | 'viewer';
  createdAt?: string;
  updatedAt?: string;
}

const CARD_KINDS = ['chart', 'table-preview', 'note', 'question', 'metric-answer'] as const;
const MAX_TITLE = 80;
const MAX_TEXT = 2_000;
const MAX_ROWS = 500;
const MAX_COLUMNS = 100;
const MAX_DEFINITIONS = 100;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const scalar = (value: unknown): value is QueryScalar => value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const known = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));
const stringValue = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const definitionName = (value: unknown): value is string => stringValue(value, 200) && /^[A-Za-z0-9_.-]+$/.test(value);
const error = (reason: string, message: string): ToolResult<never> => ({ ok: false, reason, error: message });
const MARKS = ['bar', 'line', 'point', 'arc'] as const;
const CHANNELS = ['x', 'y', 'color', 'theta'] as const;
const TYPES = ['quantitative', 'nominal', 'ordinal', 'temporal'] as const;
const AGGREGATES = ['sum', 'mean', 'count', 'min', 'max'] as const;

/** Keep card validation independent of the Supabase-backed Explore module. */
function validateCanvasChart(input: unknown, columns: string[]): ToolResult<ChartContract> {
  if (!object(input)) return error('invalid_contract', 'Chart contract must be an object.');
  if (!known(input, ['version', 'mark', 'encoding', 'title', 'tooltip'])) return error('unknown_field', 'Chart contract contains a non-editable field.');
  if ((input.version !== undefined && input.version !== 1) || !MARKS.includes(input.mark as typeof MARKS[number]) || !object(input.encoding)) return error('invalid_contract', 'Chart contract must be a version 1 object with an allow-listed mark and encoding.');
  if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > MAX_TITLE)) return error('invalid_value', 'Chart title must be 80 characters or fewer.');
  if (input.tooltip !== undefined && typeof input.tooltip !== 'boolean') return error('invalid_value', 'Chart tooltip must be a boolean.');
  const encoding: ChartContract['encoding'] = {};
  for (const [channel, raw] of Object.entries(input.encoding)) {
    if (!(CHANNELS as readonly string[]).includes(channel) || !object(raw)) return error('unknown_field', `encoding.${channel} is not an editable channel.`);
    if (!known(raw, ['field', 'dataset', 'type', 'aggregate', 'bin'])) return error('unknown_field', `encoding.${channel} contains an unknown field.`);
    if (typeof raw.field !== 'string' || !columns.includes(raw.field) || (raw.dataset !== undefined && (typeof raw.dataset !== 'string' || !QUERY_DATASET_IDS.includes(raw.dataset as typeof QUERY_DATASET_IDS[number]))) || !TYPES.includes(raw.type as typeof TYPES[number])) return error('invalid_value', `encoding.${channel} contains an unsupported field or type.`);
    if (raw.aggregate !== undefined && (!AGGREGATES.includes(raw.aggregate as typeof AGGREGATES[number]) || raw.type !== 'quantitative')) return error('invalid_value', `encoding.${channel}.aggregate requires an approved quantitative channel.`);
    if (raw.bin !== undefined && (typeof raw.bin !== 'boolean' || (raw.bin && raw.type !== 'quantitative'))) return error('invalid_value', `encoding.${channel}.bin requires a quantitative channel.`);
    // The normalized object is deliberately narrowed; keeping the wire object
    // closed prevents raw Vega keys from reaching card state.
    const normalized = { field: raw.field, ...(raw.dataset !== undefined ? { dataset: raw.dataset } : {}), type: raw.type, ...(raw.aggregate !== undefined ? { aggregate: raw.aggregate } : {}), ...(raw.bin !== undefined ? { bin: raw.bin } : {}) } as NonNullable<ChartContract['encoding']['x']>;
    encoding[channel as 'x' | 'y' | 'color' | 'theta'] = normalized;
  }
  const mark = input.mark as typeof MARKS[number];
  if (mark === 'arc' && (!encoding.theta || encoding.x || encoding.y || encoding.theta.type !== 'quantitative')) return error('invalid_combination', 'Arc charts require quantitative theta and cannot use x or y.');
  if (mark !== 'arc' && (!encoding.x || !encoding.y || encoding.theta)) return error(!encoding.x || !encoding.y ? 'missing_channel' : 'invalid_combination', `${mark} charts require x and y and do not support theta.`);
  return { ok: true, data: { version: 1, mark, encoding, ...(input.title !== undefined ? { title: input.title as string } : {}), ...(input.tooltip !== undefined ? { tooltip: input.tooltip as boolean } : {}) } };
}

function validateSemanticQuery(input: unknown): ToolResult<SemanticQueryContract> {
  if (!object(input) || !known(input, ['kind', 'source', 'measures', 'dimensions', 'filters', 'timeDimensions', 'limit'])) return error('invalid_query', 'Semantic query contains unknown or missing fields.');
  if (input.kind !== 'semantic' || !object(input.source) || !known(input.source, ['kind', 'cube']) || input.source.kind !== 'semantic' || !definitionName(input.source.cube)) return error('invalid_query', 'Semantic query must name an approved semantic cube.');
  const list = (value: unknown, name: string, max: number): ToolResult<string[]> => {
    if (!Array.isArray(value) || value.length === 0 || value.length > max || value.some((item) => !definitionName(item))) return error('invalid_query', `${name} must contain 1-${max} approved definition names.`);
    return { ok: true, data: value };
  };
  const measures = list(input.measures, 'measures', 5);
  if (!measures.ok) return measures;
  if (input.dimensions !== undefined) {
    const dimensions = list(input.dimensions, 'dimensions', 5);
    if (!dimensions.ok) return dimensions;
  }
  if (input.filters !== undefined) {
    if (!Array.isArray(input.filters) || input.filters.length > 10) return error('invalid_query', 'Semantic filters must be an array of at most 10 items.');
    for (const filter of input.filters) {
      if (!object(filter) || !known(filter, ['member', 'operator', 'values']) || !definitionName(filter.member) || typeof filter.operator !== 'string' || !(QUERY_FILTER_OPERATORS as readonly string[]).includes(filter.operator) || !Array.isArray(filter.values) || filter.values.length > 50 || filter.values.some((value) => !scalar(value))) return error('invalid_query', 'Each semantic filter must use a bounded member, approved operator, and scalar values.');
    }
  }
  if (input.timeDimensions !== undefined) {
    if (!Array.isArray(input.timeDimensions) || input.timeDimensions.length > 3) return error('invalid_query', 'Semantic timeDimensions must contain at most 3 items.');
    for (const time of input.timeDimensions) {
      if (!object(time) || !known(time, ['dimension', 'granularity', 'dateRange']) || !definitionName(time.dimension)) return error('invalid_query', 'Each semantic time dimension must name a bounded definition.');
      if (time.granularity !== undefined && !['hour', 'day', 'week', 'month', 'quarter', 'year'].includes(String(time.granularity))) return error('invalid_query', 'Semantic time grain is not supported.');
      if (time.dateRange !== undefined && (!Array.isArray(time.dateRange) || time.dateRange.length !== 2 || time.dateRange.some((value) => typeof value !== 'string' || !ISO_DATE.test(value)))) return error('invalid_query', 'Semantic dateRange must contain two ISO dates.');
    }
  }
  const limit = input.limit;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > QUERY_LIMITS.maxLimit) return error('invalid_pagination', `Semantic limit must be an integer from 1 to ${QUERY_LIMITS.maxLimit}.`);
  return { ok: true, data: {
    kind: 'semantic', source: { kind: 'semantic', cube: input.source.cube }, measures: measures.data,
    ...(input.dimensions !== undefined ? { dimensions: input.dimensions as string[] } : {}),
    ...(input.filters !== undefined ? { filters: input.filters as SemanticQueryContract['filters'] } : {}),
    ...(input.timeDimensions !== undefined ? { timeDimensions: input.timeDimensions as SemanticQueryContract['timeDimensions'] } : {}), limit,
  } };
}

function validateQuery(input: unknown): ToolResult<NormalizedQueryContract | SemanticQueryContract> {
  if (object(input) && input.kind === 'semantic') return validateSemanticQuery(input);
  const result = validateQueryContract(input);
  return result.ok ? result : result;
}

function chartFields(query: NormalizedQueryContract): string[] {
  const datasets = getReachableDatasets(query.source, query.relationshipPath);
  return [...datasets].flatMap((dataset) => Object.keys(QUERY_DATASET_CATALOG[dataset].fields));
}

function validateChart(input: unknown, query: NormalizedQueryContract): ToolResult<ChartContract> {
  const result = validateCanvasChart(input, chartFields(query));
  if (!result.ok) return result;
  const reachable = new Set(getReachableDatasets(query.source, query.relationshipPath));
  for (const encoding of Object.values(result.data.encoding)) {
    if (!encoding) continue;
    const dataset = encoding.dataset ?? query.source;
    const field = QUERY_DATASET_CATALOG[dataset]?.fields[encoding.field];
    if (!field || !reachable.has(dataset)) return error('field_not_in_path', `Chart field "${dataset}.${encoding.field}" is not in the query source path.`);
  }
  return { ok: true, data: result.data };
}

function validatePreview(input: unknown): TablePreviewCard['preview'] | ToolResult<never> {
  if (input === undefined) return undefined;
  if (!object(input) || !known(input, ['columns', 'rowCount', 'sampled', 'fetchedAt']) || !Array.isArray(input.columns) || input.columns.length > MAX_COLUMNS || input.columns.some((column) => !stringValue(column, 200)) || typeof input.rowCount !== 'number' || !Number.isInteger(input.rowCount) || input.rowCount < 0 || input.rowCount > MAX_ROWS || typeof input.sampled !== 'boolean' || !stringValue(input.fetchedAt, 100)) return error('invalid_card', 'preview must contain bounded columns, rowCount, sampled, and fetchedAt.');
  return { columns: input.columns, rowCount: input.rowCount, sampled: input.sampled, fetchedAt: input.fetchedAt };
}

export function validateCanvasCard(input: unknown): ToolResult<CanvasCard> {
  if (!object(input) || !known(input, ['id', 'kind', 'title', 'query', 'chart', 'source', 'preview', 'text', 'question', 'answerCardId', 'definitions', 'result', 'summary', 'answeredAt', 'caveats', 'suggestedChart', 'createdAt', 'updatedAt']) || !stringValue(input.id, 120) || !CARD_KINDS.includes(input.kind as typeof CARD_KINDS[number]) || !stringValue(input.createdAt, 100) || !stringValue(input.updatedAt, 100)) return error('invalid_card', 'Card must have a stable id, known kind, and timestamps.');
  if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > MAX_TITLE)) return error('invalid_value', 'Card title must be 80 characters or fewer.');
  const kind = input.kind as CanvasCard['kind'];
  if (kind === 'chart') {
    if (!known(input, ['id', 'kind', 'title', 'query', 'chart', 'createdAt', 'updatedAt'])) return error('unknown_field', 'Chart cards accept only id, kind, title, query, chart, and timestamps.');
    const query = validateQuery(input.query);
    if (!query.ok || 'kind' in query.data) return !query.ok ? query : error('invalid_query', 'Chart cards currently require a governed dataset query.');
    const chart = validateChart(input.chart, query.data);
    if (!chart.ok) return chart;
    return { ok: true, data: { id: input.id, kind: 'chart', ...(input.title !== undefined ? { title: input.title as string } : {}), query: query.data, chart: chart.data, createdAt: input.createdAt, updatedAt: input.updatedAt } as ChartCard };
  }
  if (kind === 'table-preview') {
    if (!known(input, ['id', 'kind', 'title', 'source', 'preview', 'createdAt', 'updatedAt']) || !object(input.source) || !known(input.source, ['kind', 'datasetId']) || input.source.kind !== 'dataset' || !QUERY_DATASET_IDS.includes(input.source.datasetId as typeof QUERY_DATASET_IDS[number])) return error('invalid_card', 'Table preview cards require an approved dataset source.');
    const preview = validatePreview(input.preview);
    if (preview && 'ok' in preview && preview.ok === false) return preview;
    return { ok: true, data: { id: input.id, kind: 'table-preview', ...(input.title !== undefined ? { title: input.title as string } : {}), source: { kind: 'dataset', datasetId: input.source.datasetId }, ...(preview ? { preview } : {}), createdAt: input.createdAt, updatedAt: input.updatedAt } as TablePreviewCard };
  }
  if (kind === 'note') {
    if (!known(input, ['id', 'kind', 'title', 'text', 'createdAt', 'updatedAt']) || typeof input.text !== 'string' || input.text.length > MAX_TEXT) return error('invalid_card', `Note text must be ${MAX_TEXT} characters or fewer.`);
    return { ok: true, data: { id: input.id, kind, ...(input.title !== undefined ? { title: input.title as string } : {}), text: input.text, createdAt: input.createdAt, updatedAt: input.updatedAt } };
  }
  if (kind === 'question') {
    if (!known(input, ['id', 'kind', 'question', 'answerCardId', 'createdAt', 'updatedAt']) || !stringValue(input.question, MAX_TEXT) || (input.answerCardId !== undefined && !stringValue(input.answerCardId, 120))) return error('invalid_card', 'Question cards require bounded question text.');
    return { ok: true, data: { id: input.id, kind, question: input.question, ...(input.answerCardId !== undefined ? { answerCardId: input.answerCardId } : {}), createdAt: input.createdAt, updatedAt: input.updatedAt } as QuestionCard };
  }
  if (!known(input, ['id', 'kind', 'title', 'question', 'definitions', 'query', 'result', 'summary', 'answeredAt', 'caveats', 'suggestedChart', 'createdAt', 'updatedAt']) || !stringValue(input.question, MAX_TEXT) || !Array.isArray(input.definitions) || input.definitions.length === 0 || input.definitions.length > MAX_DEFINITIONS || input.definitions.some((definition) => !object(definition) || !known(definition, ['kind', 'name', 'cube']) || !['measure', 'dimension', 'filter', 'time_dimension'].includes(String(definition.kind)) || !stringValue(definition.name, 200) || !stringValue(definition.cube, 120)) || !stringValue(input.summary, MAX_TEXT)) return error('invalid_card', 'Metric-answer provenance is incomplete or unbounded.');
  const query = validateSemanticQuery(input.query);
  if (!query.ok) return query;
  const queryMembers = new Set([
    ...query.data.measures,
    ...(query.data.dimensions ?? []),
    ...(query.data.filters ?? []).map((filter) => filter.member),
    ...(query.data.timeDimensions ?? []).map((time) => time.dimension),
  ]);
  if ((input.definitions as unknown[]).some((definition) => {
    const ref = definition as Record<string, unknown>;
    return ref.cube !== query.data.source.cube || !queryMembers.has(ref.name as string);
  })) return error('invalid_card', 'Metric-answer definitions must be consulted members of its governed query.');
  if (!object(input.result) || !known(input.result, ['columns', 'rows', 'rowCount', 'truncated']) || !Array.isArray(input.result.columns) || input.result.columns.length > MAX_COLUMNS || input.result.columns.some((column) => !stringValue(column, 200)) || !Array.isArray(input.result.rows) || input.result.rows.length > MAX_ROWS || input.result.rows.some((row) => !object(row) || Object.values(row).some((value) => !scalar(value))) || typeof input.result.rowCount !== 'number' || !Number.isInteger(input.result.rowCount) || input.result.rowCount < 0 || input.result.rowCount > MAX_ROWS || typeof input.result.truncated !== 'boolean' || !stringValue(input.answeredAt, 100) || !Array.isArray(input.caveats) || input.caveats.length > 20 || input.caveats.some((caveat) => typeof caveat !== 'string' || caveat.length > 500)) return error('invalid_card', 'Metric-answer result must be bounded and typed.');
  let suggestedChart: ChartContract | undefined;
  if (input.suggestedChart !== undefined) {
    // Suggestions are inert data. Validate shape against the dataset catalog,
    // but never apply the suggestion to another card.
    const chart = validateCanvasChart(input.suggestedChart, Object.values(QUERY_DATASET_CATALOG).flatMap((dataset) => Object.keys(dataset.fields)));
    if (!chart.ok) return chart;
    suggestedChart = chart.data;
  }
  return { ok: true, data: { id: input.id, kind: 'metric-answer', ...(input.title !== undefined ? { title: input.title as string } : {}), question: input.question, definitions: input.definitions, query: query.data, result: input.result as unknown as BoundedQueryResult, summary: input.summary, answeredAt: input.answeredAt, caveats: input.caveats as string[], ...(suggestedChart ? { suggestedChart } : {}), createdAt: input.createdAt, updatedAt: input.updatedAt } as AnswerCard };
}

function cardPayload(input: Record<string, unknown>, existing?: CanvasCard): unknown {
  if (input.card !== undefined) return input.card;
  if (object(input.patch) && existing && typeof input.cardId === 'string') return { ...existing, ...input.patch, id: input.cardId };
  return undefined;
}

function generatedCardId(kind: string): string {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${kind}-${id}`;
}

function normalizeCreatedCard(input: unknown): unknown {
  if (!object(input)) return input;
  const now = new Date().toISOString();
  return {
    ...input,
    ...(typeof input.id === 'string' ? {} : { id: generatedCardId(typeof input.kind === 'string' ? input.kind : 'card') }),
    ...(typeof input.createdAt === 'string' ? {} : { createdAt: now }),
    ...(typeof input.updatedAt === 'string' ? {} : { updatedAt: now }),
  };
}

function rejectUnknownInput(input: Record<string, unknown>, keys: readonly string[]): ToolResult<never> | null {
  const unknownKeys = Object.keys(input).filter((key) => !keys.includes(key));
  return unknownKeys.length ? error('unknown_field', `Unknown canvas tool input field(s): ${unknownKeys.join(', ')}.`) : null;
}

function descriptor(name: string, description: string, inputSchema: Record<string, unknown>, run: (input: Record<string, unknown>) => ToolResult<unknown>, bridge: CanvasBridge) {
  return { name, description, inputSchema, execute: async (input: Record<string, unknown>) => {
    let result: ToolResult<unknown>;
    try { result = run(input ?? {}); } catch { result = error('invalid_card', 'Canvas mutation was rejected.'); }
    bridge.logAgent(result.ok ? `called ${name}` : `called ${name} (rejected: ${result.reason})`);
    return result;
  } };
}

const PERSISTENCE_REASONS = new Set([
  'invalid_request', 'invalid_capability', 'unauthorized', 'not_found',
  'version_conflict', 'rate_limited', 'payload_too_large', 'timeout', 'unavailable', 'invalid_response',
]);
const PERSISTENCE_ACTIONS = ['exploration_updated', 'card_created', 'card_updated', 'card_removed', 'cards_reordered', 'query_executed', 'question_answered', 'chart_suggested'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY = /^[A-Za-z0-9_-]{32,512}$/;

function persistenceError(reason: string, currentVersion?: number): ToolResult<never> {
  const safeReason = PERSISTENCE_REASONS.has(reason) ? reason : 'unavailable';
  const messages: Record<string, string> = {
    invalid_request: 'The exploration request is invalid.',
    invalid_capability: 'The exploration capability is invalid or expired.',
    unauthorized: 'This capability cannot perform that exploration operation.',
    not_found: 'The exploration was not found.',
    version_conflict: 'The exploration changed elsewhere; reload it before saving.',
    rate_limited: 'Exploration quota exceeded. Try again shortly.',
    payload_too_large: 'The exploration payload exceeds the allowed size.',
    timeout: 'Exploration request timed out. Try again.',
    unavailable: 'Exploration persistence is unavailable. Try again.',
    invalid_response: 'Exploration persistence returned an invalid response.',
  };
  return {
    ok: false,
    reason: safeReason,
    error: messages[safeReason],
    ...(safeReason === 'version_conflict' && typeof currentVersion === 'number' && Number.isSafeInteger(currentVersion) && currentVersion >= 0 ? { currentVersion } : {}),
  };
}

function validPersistedRecord(value: unknown, includeSnapshot: boolean): ToolResult<PersistedExploration> {
  if (!object(value) || typeof value.explorationId !== 'string' || !UUID.test(value.explorationId)
    || value.schemaVersion !== 1 || typeof value.name !== 'string' || value.name.length < 1 || value.name.length > 200
    || typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 0
    || !['owner', 'editor', 'viewer'].includes(value.role as string)) return persistenceError('invalid_response');
  let snapshot: { cards: readonly CanvasCard[] } = { cards: [] };
  if (includeSnapshot) {
    if (!object(value.snapshot) || !Array.isArray(value.snapshot.cards) || value.snapshot.cards.length > 100) return persistenceError('invalid_response');
    const cards: CanvasCard[] = [];
    const ids = new Set<string>();
    for (const candidate of value.snapshot.cards) {
      const card = validateCanvasCard(candidate);
      if (!card.ok || ids.has(card.ok ? card.data.id : '')) return persistenceError('invalid_response');
      ids.add(card.data.id);
      cards.push(card.data);
    }
    snapshot = { cards };
  }
  return { ok: true, data: {
    explorationId: value.explorationId,
    schemaVersion: 1,
    name: value.name,
    snapshot,
    version: value.version,
    role: value.role as PersistedExploration['role'],
    ...(typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
  } };
}

function safePersistenceResponse(raw: unknown, includeSnapshot: boolean): ToolResult<PersistedExploration> {
  if (!object(raw)) return persistenceError('invalid_response');
  if (raw.ok !== true) {
    const currentVersion = object(raw) && typeof raw.currentVersion === 'number' ? raw.currentVersion : undefined;
    return persistenceError(typeof raw.reason === 'string' ? raw.reason : 'unavailable', currentVersion);
  }
  return validPersistedRecord(raw.data, includeSnapshot);
}

function safeListResponse(raw: unknown): ToolResult<readonly PersistedExplorationSummary[]> {
  if (!object(raw)) return persistenceError('invalid_response');
  if (raw.ok !== true) return persistenceError(typeof raw.reason === 'string' ? raw.reason : 'unavailable');
  if (!Array.isArray(raw.data)) return persistenceError('invalid_response');
  const summaries: PersistedExplorationSummary[] = [];
  for (const item of raw.data.slice(0, 100)) {
    const result = validPersistedRecord(item, false);
    if (!result.ok) return persistenceError('invalid_response');
    summaries.push({
      explorationId: result.data.explorationId,
      schemaVersion: result.data.schemaVersion,
      name: result.data.name,
      version: result.data.version,
      role: result.data.role,
      ...(result.data.createdAt ? { createdAt: result.data.createdAt } : {}),
      ...(result.data.updatedAt ? { updatedAt: result.data.updatedAt } : {}),
    });
  }
  return { ok: true, data: summaries };
}

async function invokeExplorationState(body: Record<string, unknown>): Promise<unknown> {
  try {
    // Keep the Supabase module out of the test/import path: it validates the
    // Vite environment at module initialization, while the WebMCP polyfill
    // tests provide an in-memory transport instead.
    const { supabase } = await import('./supabase.ts');
    const result = await supabase.functions.invoke('exploration-state', { body });
    if (result.error) return { ok: false, reason: 'unavailable', error: 'Exploration persistence is unavailable.' };
    return result.data;
  } catch {
    return { ok: false, reason: 'unavailable', error: 'Exploration persistence is unavailable.' };
  }
}

function persistedDescriptor(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  run: (input: Record<string, unknown>) => Promise<ToolResult<unknown>>,
  bridge: PersistedCanvasBridge,
) {
  return {
    name, description, inputSchema,
    execute: async (input: Record<string, unknown>) => {
      let result: ToolResult<unknown>;
      try { result = await run(input ?? {}); } catch { result = persistenceError('unavailable'); }
      // Deliberately log only the tool name and reason. In particular, do not
      // stringify request bodies because they contain the bearer capability.
      bridge.logAgent(result.ok ? `called ${name}` : `called ${name} (rejected: ${result.reason})`);
      return result;
    },
  };
}

function isPersistedBridge(bridge: CanvasBridge): bridge is PersistedCanvasBridge {
  return typeof (bridge as Partial<PersistedCanvasBridge>).getCapability === 'function'
    && typeof (bridge as Partial<PersistedCanvasBridge>).getExplorationId === 'function'
    && typeof (bridge as Partial<PersistedCanvasBridge>).getVersion === 'function';
}

export function createPersistedCanvasTools(bridge: PersistedCanvasBridge) {
  let currentRole = bridge.getRole?.() ?? null;
  let currentId = bridge.getExplorationId() ?? null;
  const invoke = bridge.invokePersistence ?? invokeExplorationState;
  const capability = (): ToolResult<string> => {
    const value = bridge.getCapability();
    return typeof value === 'string' && CAPABILITY.test(value) ? { ok: true, data: value } : persistenceError('unauthorized');
  };
  const remember = (record: PersistedExploration) => {
    currentId = record.explorationId;
    currentRole = record.role;
    bridge.setPersistedExploration?.(record);
    bridge.replaceState(createCanvasState(record.snapshot.cards));
  };
  const request = async (body: Record<string, unknown>, includeSnapshot: boolean): Promise<ToolResult<PersistedExploration>> => safePersistenceResponse(await invoke(body), includeSnapshot);

  return [
    persistedDescriptor('list_explorations', 'List saved explorations accessible with the host session capability. Results contain ids, names, roles, and versions only; open an exploration to read its cards.', { type: 'object', properties: {} }, async (input) => {
      if (Object.keys(input).length) return persistenceError('invalid_request');
      const key = capability();
      if (!key.ok) return key;
      return safeListResponse(await invoke({ operation: 'list_explorations', capability: key.data, actor: 'agent' }));
    }, bridge),
    persistedDescriptor('open_exploration', 'Open an accessible saved exploration by id. The server determines the owner/editor/viewer role from the host capability.', { type: 'object', properties: { explorationId: { type: 'string' } }, required: ['explorationId'] }, async (input) => {
      if (!known(input, ['explorationId']) || typeof input.explorationId !== 'string' || !UUID.test(input.explorationId)) return persistenceError('invalid_request');
      const key = capability();
      if (!key.ok) return key;
      const result = await request({ operation: 'open_exploration', explorationId: input.explorationId, capability: key.data, actor: 'agent' }, true);
      if (result.ok) remember(result.data);
      return result;
    }, bridge),
    persistedDescriptor('create_exploration', 'Create a saved exploration from the current validated canvas. The host supplies the owner capability; the model cannot provide or receive bearer secrets.', { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, async (input) => {
      if (!known(input, ['name']) || typeof input.name !== 'string' || input.name.trim().length === 0 || input.name.length > 200) return persistenceError('invalid_request');
      const key = capability();
      if (!key.ok) return key;
      const cards = bridge.getState().cards;
      const validated = validatePersistedCards(cards);
      if (!validated.ok) return validated;
      const result = await request({ operation: 'create_exploration', name: input.name, schemaVersion: 1, snapshot: { cards: validated.data }, capability: key.data, actor: 'agent' }, true);
      if (result.ok) remember(result.data);
      return result;
    }, bridge),
    persistedDescriptor('update_exploration', 'Persist the current validated canvas using compare-and-swap. expectedVersion is required; stale saves return version_conflict and never overwrite another editor. Viewers cannot mutate, and only owners may rename.', { type: 'object', properties: { expectedVersion: { type: 'integer', minimum: 0 }, action: { type: 'string', enum: PERSISTENCE_ACTIONS }, mutationId: { type: 'string' }, cardId: { type: 'string' }, name: { type: 'string' } }, required: ['expectedVersion'] }, async (input) => {
      if (!known(input, ['expectedVersion', 'action', 'mutationId', 'cardId', 'name']) || typeof input.expectedVersion !== 'number' || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) return persistenceError('invalid_request');
      if (currentRole === 'viewer' || bridge.getRole?.() === 'viewer') return persistenceError('unauthorized');
      const id = currentId ?? bridge.getExplorationId() ?? null;
      if (!id || !UUID.test(id)) return persistenceError('not_found');
      const key = capability();
      if (!key.ok) return key;
      const action = input.action === undefined ? 'exploration_updated' : input.action;
      if (typeof action !== 'string' || !(PERSISTENCE_ACTIONS as readonly string[]).includes(action)) return persistenceError('invalid_request');
      if (input.name !== undefined && (typeof input.name !== 'string' || input.name.trim().length === 0 || input.name.length > 200)) return persistenceError('invalid_request');
      if (input.name !== undefined && (currentRole ?? bridge.getRole?.()) !== 'owner') return persistenceError('unauthorized');
      if (input.mutationId !== undefined && (typeof input.mutationId !== 'string' || input.mutationId.length < 1 || input.mutationId.length > 120)) return persistenceError('invalid_request');
      if (input.cardId !== undefined && (typeof input.cardId !== 'string' || input.cardId.length < 1 || input.cardId.length > 120)) return persistenceError('invalid_request');
      const validated = validatePersistedCards(bridge.getState().cards);
      if (!validated.ok) return validated;
      const result = await request({ operation: 'mutate_exploration', explorationId: id, capability: key.data, expectedVersion: input.expectedVersion, snapshot: { cards: validated.data }, action, mutationId: input.mutationId ?? `webmcp-${Date.now()}`, cardId: input.cardId, name: input.name, actor: 'agent' }, true);
      if (result.ok) remember(result.data);
      return result;
    }, bridge),
  ];
}

function validatePersistedCards(cards: readonly CanvasCard[]): ToolResult<readonly CanvasCard[]> {
  if (!Array.isArray(cards) || cards.length > 100) return persistenceError('invalid_request');
  const ids = new Set<string>();
  const normalized: CanvasCard[] = [];
  for (const candidate of cards) {
    const card = validateCanvasCard(candidate);
    if (!card.ok) return persistenceError('invalid_request');
    if (ids.has(card.data.id)) return persistenceError('invalid_request');
    ids.add(card.data.id);
    normalized.push(card.data);
  }
  return { ok: true, data: normalized };
}

export function createCanvasTools(bridge: CanvasBridge) {
  const mutate = (action: (state: CanvasState) => ToolResult<CanvasState>): ToolResult<CanvasState> => {
    const result = action(bridge.getState());
    if (result.ok) bridge.replaceState(result.data);
    return result;
  };
  const tools = [
    descriptor('get_exploration_context', 'Read the local Exploration Canvas cards and selected card. Cards contain governed intent/provenance only; they never contain raw SQL, Vega specs, URLs, transforms, or unbounded source rows.', { type: 'object', properties: {} }, () => ({ ok: true, data: bridge.getState() }), bridge),
    descriptor('create_canvas_card', 'Create one validated chart, table-preview, note, question, or metric-answer card. Pass the complete card under { card }; use a stable unique id. Dataset queries and chart contracts are allow-listed and app-owned data/spec construction remains private.', { type: 'object', properties: { card: { type: 'object' } }, required: ['card'] }, (input) => mutate((state) => {
      const invalidInput = rejectUnknownInput(input, ['card']);
      if (invalidInput) return invalidInput;
      const card = validateCanvasCard(normalizeCreatedCard(input.card));
      if (!card.ok) return card;
      if (state.cards.some((candidate) => candidate.id === card.data.id)) return error('duplicate_card', `Card id "${card.data.id}" already exists.`);
      return { ok: true, data: { ...state, cards: [...state.cards, card.data], selectedCardId: card.data.id } };
    }), bridge),
    descriptor('update_canvas_card', 'Replace one card atomically with a complete validated card, or pass a validated patch under { patch } with cardId. The id and kind cannot change.', { type: 'object', properties: { cardId: { type: 'string' }, card: { type: 'object' }, patch: { type: 'object' } }, required: ['cardId'] }, (input) => mutate((state) => {
      const invalidInput = rejectUnknownInput(input, ['cardId', 'card', 'patch']);
      if (invalidInput) return invalidInput;
      if (typeof input.cardId !== 'string') return error('invalid_card', 'cardId is required.');
      const index = state.cards.findIndex((candidate) => candidate.id === input.cardId);
      if (index < 0) return error('unknown_card', `Card id "${input.cardId}" does not exist.`);
      const existing = state.cards[index];
      const candidate = cardPayload(input, existing);
      if (!object(candidate)) return error('invalid_card', 'Pass a complete card or patch object.');
      const nextInput = { ...candidate, id: input.cardId, kind: candidate.kind ?? existing.kind, createdAt: candidate.createdAt ?? existing.createdAt, updatedAt: candidate.updatedAt ?? new Date().toISOString() };
      const card = validateCanvasCard(nextInput);
      if (!card.ok) return card;
      if (card.data.kind !== existing.kind) return error('invalid_card', 'A card update cannot change kind.');
      const cards = [...state.cards]; cards[index] = card.data;
      return { ok: true, data: { ...state, cards } };
    }), bridge),
    descriptor('remove_canvas_card', 'Remove one card by stable cardId. The selected card advances to its nearest remaining card.', { type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }, (input) => mutate((state) => {
      const invalidInput = rejectUnknownInput(input, ['cardId']);
      if (invalidInput) return invalidInput;
      if (typeof input.cardId !== 'string') return error('invalid_card', 'cardId is required.');
      const index = state.cards.findIndex((candidate) => candidate.id === input.cardId);
      if (index < 0) return error('unknown_card', `Card id "${input.cardId}" does not exist.`);
      const cards = state.cards.filter((candidate) => candidate.id !== input.cardId);
      const selectedCardId = state.selectedCardId === input.cardId ? cards[Math.min(index, cards.length - 1)]?.id ?? null : state.selectedCardId;
      return { ok: true, data: { cards, selectedCardId } };
    }), bridge),
    descriptor('reorder_canvas_cards', 'Replace card order using every current stable card id exactly once. No card is created, removed, or changed.', { type: 'object', properties: { cardIds: { type: 'array', items: { type: 'string' } } }, required: ['cardIds'] }, (input) => mutate((state) => {
      const invalidInput = rejectUnknownInput(input, ['cardIds']);
      if (invalidInput) return invalidInput;
      if (!Array.isArray(input.cardIds) || input.cardIds.length !== state.cards.length || input.cardIds.some((id) => typeof id !== 'string')) return error('invalid_reorder', 'cardIds must contain every current card id exactly once.');
      const expected = new Set(state.cards.map((card) => card.id));
      const actual = new Set(input.cardIds as string[]);
      if (actual.size !== expected.size || [...expected].some((id) => !actual.has(id))) return error('invalid_reorder', 'cardIds must contain every current card id exactly once.');
      const byId = new Map(state.cards.map((card) => [card.id, card]));
      return { ok: true, data: { ...state, cards: (input.cardIds as string[]).map((id) => byId.get(id)!) } };
    }), bridge),
  ];
  if (isPersistedBridge(bridge)) tools.push(...createPersistedCanvasTools(bridge));
  return tools;
}

/** Register only the persisted surface, useful when a host wants to keep the
 * local card tools and persistence lifecycle on separate effects. */
export function registerPersistedCanvasTools(bridge: PersistedCanvasBridge): () => void {
  const modelContext = (globalThis as unknown as { document?: { modelContext?: { registerTool: (tool: unknown) => unknown } } }).document?.modelContext;
  if (!modelContext) return () => {};
  const unregisterFns = createPersistedCanvasTools(bridge).map((tool) => modelContext.registerTool(tool));
  return () => callUnregisterFns(unregisterFns);
}

export function registerCanvasTools(bridge: CanvasBridge): () => void {
  const modelContext = (globalThis as unknown as { document?: { modelContext?: { registerTool: (tool: unknown) => unknown } } }).document?.modelContext;
  if (!modelContext) return () => {};
  const unregisterFns = createCanvasTools(bridge).map((tool) => modelContext.registerTool(tool));
  return () => callUnregisterFns(unregisterFns);
}
