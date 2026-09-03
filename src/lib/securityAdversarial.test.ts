import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCanvasState } from './explorationCanvas.ts';
import { validateQueryContract } from './queryContract.ts';
import {
  createCanvasTools,
  createPersistedCanvasTools,
  validateCanvasCard,
  type PersistedCanvasBridge,
} from './registerCanvasWebMcpTools.ts';
import { createQueryTools } from './registerQueryWebMcpTools.ts';

const aggregateMigration = readFileSync(new URL('../../supabase/migrations/0004_query_aggregate_rpc.sql', import.meta.url), 'utf8');
const persistenceMigration = readFileSync(new URL('../../supabase/migrations/0005_exploration_persistence.sql', import.meta.url), 'utf8');
const aggregateEdge = readFileSync(new URL('../../supabase/functions/aggregate-query/index.ts', import.meta.url), 'utf8');
const persistenceEdge = readFileSync(new URL('../../supabase/functions/exploration-state/index.ts', import.meta.url), 'utf8');
const semanticEdge = readFileSync(new URL('../../supabase/functions/semantic-layer/index.ts', import.meta.url), 'utf8');

const query = {
  source: 'customers',
  dimensions: [{ field: { dataset: 'customers', field: 'region' } }],
  measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }],
  limit: 10,
};

const chartCard = {
  id: 'chart-1', kind: 'chart', createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
  query,
  chart: { version: 1, mark: 'bar', encoding: {
    x: { field: 'region', type: 'nominal' }, y: { field: 'customer_id', type: 'quantitative', aggregate: 'count' },
  } },
};

const assertRejected = (input: unknown) => {
  const result = validateQueryContract(input);
  assert.equal(result.ok, false);
};

test('rejects a hostile query corpus before any aggregate executor is reached', async () => {
  const hostile = [
    { ...query, sql: 'select secret from users' },
    { ...query, source: 'customers; drop table customers' },
    { ...query, dimensions: [{ field: { dataset: 'customers', field: 'name) || (select token' } }] },
    { ...query, relationshipPath: ['customers_to_mrr_monthly'] },
    { ...query, dimensions: Array.from({ length: 6 }, () => query.dimensions[0]) },
    { ...query, limit: 501 },
    { ...query, limit: Infinity },
    { ...query, offset: -1 },
    { ...query, filters: Array.from({ length: 11 }, () => ({ field: { dataset: 'customers', field: 'region' }, operator: 'eq', value: 'NA' })) },
    { ...query, filters: [{ field: { dataset: 'customers', field: 'region' }, operator: 'eq', value: ['NA'] }] },
  ];
  for (const input of hostile) assertRejected(input);

  let calls = 0;
  const tools = createQueryTools(() => {}, async () => { calls += 1; return { ok: true, data: { rows: [], metadata: {} } }; });
  const result = await tools[1].execute({ query: { ...query, sql: 'select * from secrets' } });
  assert.equal((result as { ok: boolean }).ok, false);
  assert.equal(calls, 0);
}
);

test('canvas WebMCP rejects raw Vega/SQL and leaves state unchanged on failure', async () => {
  let state = createCanvasState([chartCard as never]);
  const logs: string[] = [];
  const tools = createCanvasTools({
    getState: () => state,
    replaceState: (next) => { state = next; },
    logAgent: (message) => logs.push(message),
  });
  const before = state;
  for (const card of [
    { ...chartCard, data: { values: ['secret'] } },
    { ...chartCard, chart: { ...chartCard.chart, data: { url: 'https://attacker.invalid' } } },
    { ...chartCard, query: { ...query, rawSql: 'select * from customers' } },
  ]) {
    const result = await tools[1].execute({ card });
    assert.equal((result as { ok: boolean }).ok, false);
    assert.deepEqual(state, before);
  }
  assert.ok(logs.every((message) => !message.includes('secret') && !message.includes('select')));
});

test('persisted WebMCP cannot supply or elevate a capability and rejects forged transport data', async () => {
  const calls: Record<string, unknown>[] = [];
  const id = '123e4567-e89b-12d3-a456-426614174000';
  let state = createCanvasState([chartCard as never]);
  const bridge: PersistedCanvasBridge = {
    getState: () => state,
    replaceState: (next) => { state = next; },
    logAgent: () => {},
    getCapability: () => 'H'.repeat(43),
    getExplorationId: () => id,
    getVersion: () => 0,
    invokePersistence: async (body) => {
      calls.push(body);
      return { ok: false, reason: 'unauthorized', error: 'db secret=must-not-escape', capability: 'leak' };
    },
  };
  const tools = createPersistedCanvasTools(bridge);
  const forged = await tools[1].execute({ explorationId: id, capability: 'A'.repeat(43) });
  assert.equal((forged as { ok: boolean }).ok, false);
  assert.equal(calls.length, 0);
  const rejected = await tools[2].execute({ name: 'safe', capability: 'A'.repeat(43) });
  assert.equal((rejected as { ok: boolean }).ok, false);
  assert.equal(calls.length, 0);
  const response = await tools[3].execute({ expectedVersion: 0 });
  assert.deepEqual(response, { ok: false, reason: 'unauthorized', error: 'This capability cannot perform that exploration operation.' });
  assert.equal((response as Record<string, unknown>).capability, undefined);
  assert.equal(calls.length, 1);
  assert.equal((calls[0].capability as string), 'H'.repeat(43));
});

test('answer cards require consulted definitions and governed members; suggestions cannot carry Vega escape hatches', () => {
  const answer = {
    id: 'answer-1', kind: 'metric-answer', createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
    question: 'What is MRR?',
    definitions: [{ kind: 'measure', name: 'mrr_monthly.total_mrr', cube: 'mrr_monthly' }],
    query: { kind: 'semantic', source: { kind: 'semantic', cube: 'mrr_monthly' }, measures: ['mrr_monthly.total_mrr'], limit: 1 },
    result: { columns: ['total_mrr'], rows: [{ total_mrr: 10 }], rowCount: 1, truncated: false },
    summary: 'MRR is 10.', answeredAt: '2026-09-02T00:00:00.000Z', caveats: [],
  };
  assert.equal(validateCanvasCard(answer).ok, true);
  assert.equal(validateCanvasCard({ ...answer, definitions: [{ kind: 'measure', name: 'mrr_monthly.fake', cube: 'mrr_monthly' }] }).ok, false);
  assert.equal(validateCanvasCard({ ...answer, definitions: [{ kind: 'measure', name: 'other.total_mrr', cube: 'other' }] }).ok, false);
  assert.equal(validateCanvasCard({ ...answer, suggestedChart: { version: 1, mark: 'bar', encoding: {}, data: { values: ['secret'] } } }).ok, false);
});

test('server source contains independent enforcement for injection, authorization, CAS, limits, and secret redaction', () => {
  assert.match(aggregateEdge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(aggregateEdge, /body\?\.operation !== 'query'/);
  assert.match(aggregateEdge, /request\.method !== 'POST'/);
  assert.match(aggregateMigration, /set_config\('statement_timeout', '5000'/);
  assert.match(aggregateMigration, /revoke all on function public\.query_dataset_aggregate\(jsonb\) from public, anon, authenticated/);
  assert.match(aggregateMigration, /grant execute on function public\.query_dataset_aggregate\(jsonb\) to service_role/);
  assert.match(aggregateMigration, /quote_literal/);
  assert.match(aggregateMigration, /format\(' %I s', source\)/);
  assert.match(aggregateMigration, /source_rows > 100000/);
  assert.match(aggregateMigration, /octet_length\(rows::text\) > 1000000/);

  assert.match(persistenceEdge, /hashCapability/);
  assert.match(persistenceEdge, /knownKeys\(body/);
  assert.doesNotMatch(persistenceEdge, /p_capability_digest: body\.capability/);
  assert.match(persistenceMigration, /alter table explorations enable row level security/);
  assert.match(persistenceMigration, /revoke all on table explorations from public, anon, authenticated/);
  assert.match(persistenceMigration, /p_expected_version/);
  assert.match(persistenceMigration, /for update/);
  assert.match(persistenceMigration, /octet_length\(snapshot::text\) <= 1048576/);
  assert.match(persistenceMigration, /card::text ~\* .*data.*url.*transform.*config/);

  assert.match(semanticEdge, /MAX_QUERY_BYTES/);
  assert.match(semanticEdge, /validQuery/);
  assert.match(semanticEdge, /request\.method !== 'POST'/);
  assert.match(semanticEdge, /Semantic layer request failed\.'/);
  assert.doesNotMatch(semanticEdge, /data\?\.error/);
  assert.match(semanticEdge, /CUBE_API_TOKEN/);
});
