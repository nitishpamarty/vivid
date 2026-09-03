import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasState } from './explorationCanvas.ts';
import { createPersistedCanvasTools, registerCanvasTools, registerPersistedCanvasTools, validateCanvasCard, type CanvasBridge, type PersistedCanvasBridge } from './registerCanvasWebMcpTools.ts';

type RegisteredTool = { name: string; execute: (input: Record<string, unknown>) => Promise<unknown> };

const chartCard = {
  id: 'chart-1', kind: 'chart', createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
  query: {
    source: 'customers', dimensions: [{ field: { dataset: 'customers', field: 'region' } }],
    measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }], limit: 10,
  },
  chart: { version: 1, mark: 'bar', encoding: {
    x: { field: 'region', type: 'nominal' }, y: { field: 'customer_id', type: 'quantitative', aggregate: 'count' },
  } },
};

const answerCard = {
  id: 'answer-1', kind: 'metric-answer', createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
  question: 'What is MRR by month?',
  definitions: [{ kind: 'measure', name: 'mrr_monthly.total_mrr', cube: 'mrr_monthly' }, { kind: 'time_dimension', name: 'mrr_monthly.month', cube: 'mrr_monthly' }],
  query: { kind: 'semantic', source: { kind: 'semantic', cube: 'mrr_monthly' }, measures: ['mrr_monthly.total_mrr'], timeDimensions: [{ dimension: 'mrr_monthly.month', granularity: 'month' }], limit: 12 },
  result: { columns: ['month', 'total_mrr'], rows: [{ month: '2026-09-01', total_mrr: 10 }], rowCount: 1, truncated: false },
  summary: 'MRR is $10 in the returned month.', answeredAt: '2026-09-02T00:00:00.000Z', caveats: ['The result is bounded to 12 rows.'],
};

function install(tools: RegisteredTool[], unregistered: string[]) {
  (globalThis as unknown as { document?: unknown }).document = { modelContext: {
    registerTool(tool: RegisteredTool) { tools.push(tool); return () => unregistered.push(tool.name); },
  } };
}

function remove() { delete (globalThis as unknown as { document?: unknown }).document; }

function bridge(initial = createCanvasState()): { bridge: CanvasBridge; state: () => ReturnType<typeof createCanvasState>; logs: string[] } {
  let current = initial;
  const logs: string[] = [];
  return { bridge: { getState: () => current, replaceState: (next) => { current = next; }, logAgent: (message) => logs.push(message) }, state: () => current, logs };
}

test('registers all canvas tools and mutates local state through the polyfill', async () => {
  const tools: RegisteredTool[] = [];
  const unregistered: string[] = [];
  const local = bridge();
  install(tools, unregistered);
  try {
    const cleanup = registerCanvasTools(local.bridge);
    assert.deepEqual(tools.map(({ name }) => name), ['get_exploration_context', 'create_canvas_card', 'update_canvas_card', 'remove_canvas_card', 'reorder_canvas_cards']);
    const created = await tools[1].execute({ card: chartCard }) as { ok: boolean; data: { selectedCardId: string } };
    assert.equal(created.ok, true);
    assert.equal(created.data.selectedCardId, 'chart-1');
    const context = await tools[0].execute({}) as { ok: true; data: { cards: unknown[] } };
    assert.equal(context.data.cards.length, 1);
    cleanup();
    assert.deepEqual(unregistered, tools.map(({ name }) => name));
  } finally { remove(); }
});

test('rejects unsafe cards and preserves the prior snapshot on failed mutations', async () => {
  const tools: RegisteredTool[] = [];
  const local = bridge();
  install(tools, []);
  try {
    registerCanvasTools(local.bridge);
    const created = await tools[1].execute({ card: chartCard }) as { ok: boolean };
    assert.equal(created.ok, true);
    const before = local.state();
    const rejected = await tools[2].execute({ cardId: 'chart-1', patch: { chart: { mark: 'bar', encoding: {}, data: { values: ['secret'] } } } }) as { ok: false; reason: string };
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, 'unknown_field');
    assert.deepEqual(local.state(), before);
    const unknown = await tools[3].execute({ cardId: 'missing' }) as { ok: false; reason: string };
    assert.equal(unknown.reason, 'unknown_card');
    assert.deepEqual(local.state(), before);
    assert.equal(local.logs.length >= 3, true);
  } finally { remove(); }
});

test('requires an exact permutation when reordering cards', async () => {
  const tools: RegisteredTool[] = [];
  const local = bridge();
  install(tools, []);
  try {
    registerCanvasTools(local.bridge);
    await tools[1].execute({ card: { ...chartCard, id: 'a' } });
    await tools[1].execute({ card: { ...chartCard, id: 'b' } });
    const before = local.state();
    const rejected = await tools[4].execute({ cardIds: ['a'] }) as { ok: false; reason: string };
    assert.equal(rejected.reason, 'invalid_reorder');
    assert.deepEqual(local.state(), before);
    const moved = await tools[4].execute({ cardIds: ['a', 'b'] }) as { ok: true; data: { cards: { id: string }[] } };
    assert.deepEqual(moved.data.cards.map(({ id }) => id), ['a', 'b']);
  } finally { remove(); }
});

test('accepts complete answer provenance and keeps chart suggestions inert', () => {
  const result = validateCanvasCard({
    ...answerCard,
    suggestedChart: { version: 1, mark: 'bar', encoding: {
      x: { field: 'month', type: 'temporal' },
      y: { field: 'mrr', type: 'quantitative' },
    } },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.kind, 'metric-answer');
    assert.equal(result.data.summary, answerCard.summary);
    assert.deepEqual(result.data.query, answerCard.query);
    assert.deepEqual(result.data.result.rows, answerCard.result.rows);
    assert.ok(result.data.suggestedChart);
  }
});

test('rejects ungrounded or incomplete answer payloads', () => {
  const missingSummary = validateCanvasCard({ ...answerCard, summary: undefined });
  assert.equal(missingSummary.ok, false);

  const missingDefinitions = validateCanvasCard({ ...answerCard, definitions: [] });
  assert.equal(missingDefinitions.ok, false);

  const definitionNotInQuery = validateCanvasCard({
    ...answerCard,
    definitions: [{ kind: 'measure', name: 'mrr_monthly.not_consulted', cube: 'mrr_monthly' }],
  });
  assert.equal(definitionNotInQuery.ok, false);

  const rawSpecSuggestion = validateCanvasCard({
    ...answerCard,
    suggestedChart: { version: 1, mark: 'bar', encoding: {}, data: { values: ['secret'] } },
  });
  assert.equal(rawSpecSuggestion.ok, false);
});

test('persisted tools use the host capability, validate snapshots, and preserve CAS conflicts', async () => {
  const tools: RegisteredTool[] = [];
  const unregistered: string[] = [];
  const calls: Record<string, unknown>[] = [];
  let persisted: unknown;
  let state = createCanvasState([chartCard as never]);
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const bridge: PersistedCanvasBridge = {
    getState: () => state,
    replaceState: (next) => { state = next; },
    logAgent: () => {},
    getCapability: () => 'A'.repeat(43),
    getExplorationId: () => id,
    getVersion: () => 0,
    setPersistedExploration: (next) => { persisted = next; },
    invokePersistence: async (body) => {
      calls.push(body);
      if (body.operation === 'create_exploration') return { ok: true, data: { explorationId: id, schemaVersion: 1, name: 'Demo', snapshot: { cards: state.cards }, version: 0, role: 'owner' } };
      if (body.operation === 'mutate_exploration') return { ok: false, reason: 'version_conflict', error: 'server detail must be hidden', currentVersion: 2, capability: 'leak' };
      return { ok: true, data: { explorationId: id, schemaVersion: 1, name: 'Demo', snapshot: { cards: state.cards }, version: 0, role: 'owner' } };
    },
  };
  const registered = createPersistedCanvasTools(bridge);
  assert.deepEqual(registered.map((tool) => tool.name), ['list_explorations', 'open_exploration', 'create_exploration', 'update_exploration']);
  const created = await registered[2].execute({ name: 'Demo' }) as { ok: boolean; data: { role: string } };
  assert.equal(created.ok, true);
  assert.equal(created.data.role, 'owner');
  assert.equal((calls[0] as Record<string, unknown>).capability, 'A'.repeat(43));
  assert.equal((created as Record<string, unknown>).capability, undefined);
  assert.ok(persisted);

  const conflict = await registered[3].execute({ expectedVersion: 0 }) as { ok: false; reason: string; currentVersion?: number; capability?: string };
  assert.equal(conflict.ok, false);
  assert.equal(conflict.reason, 'version_conflict');
  assert.equal(conflict.currentVersion, 2);
  assert.equal(conflict.capability, undefined);
  assert.equal((calls[1] as Record<string, unknown>).actor, 'agent');
  assert.equal((calls[1] as Record<string, unknown>).snapshot && ((calls[1] as Record<string, unknown>).snapshot as Record<string, unknown>).cards !== undefined, true);

  install(tools, unregistered);
  try {
    const cleanup = registerPersistedCanvasTools(bridge);
    assert.equal(tools.length, 4);
    cleanup();
    assert.deepEqual(unregistered, tools.map(({ name }) => name));
  } finally { remove(); }
});

test('viewer capabilities are rejected before a persistence mutation is sent', async () => {
  let calls = 0;
  const base = bridge(createCanvasState([chartCard as never])).bridge;
  const persistedBridge: PersistedCanvasBridge = {
    ...base,
    getCapability: () => 'A'.repeat(43),
    getExplorationId: () => '123e4567-e89b-12d3-a456-426614174000',
    getVersion: () => 1,
    getRole: () => 'viewer',
    invokePersistence: async () => { calls += 1; return { ok: true, data: {} }; },
  };
  const update = createPersistedCanvasTools(persistedBridge)[3];
  const result = await update.execute({ expectedVersion: 1 }) as { ok: false; reason: string };
  assert.equal(result.reason, 'unauthorized');
  assert.equal(calls, 0);
});
