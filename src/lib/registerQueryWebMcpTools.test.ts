import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerQueryTools } from './registerQueryWebMcpTools.ts';

type RegisteredTool = {
  name: string;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

const query = {
  source: 'customers',
  dimensions: [{ field: { dataset: 'customers', field: 'region' } }],
  measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }],
  limit: 10,
};

function installPolyfill(tools: RegisteredTool[], unregistered: string[]) {
  (globalThis as unknown as { document?: unknown }).document = {
    modelContext: {
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
        return () => unregistered.push(tool.name);
      },
    },
  };
}

function removePolyfill() {
  delete (globalThis as unknown as { document?: unknown }).document;
}

test('registers query tools, returns compact options, and cleans up via the document polyfill', async () => {
  const registered: RegisteredTool[] = [];
  const unregistered: string[] = [];
  const logs: string[] = [];
  installPolyfill(registered, unregistered);
  try {
    const cleanup = registerQueryTools((message) => logs.push(message), async () => ({
      ok: true,
      data: {
        rows: [{ 'customers.region': 'NA', 'customers.customer_id:count': 12, secret: 'never-return' }],
        metadata: {
          sourceTables: ['customers'], relationshipPath: [], truncated: false, resultCount: 1,
          appliedLimits: { limit: 10, offset: 0, maxSourceRows: 100000, maxResponseBytes: 1000000, statementTimeoutMs: 5000 },
        },
      },
    }));
    assert.deepEqual(registered.map(({ name }) => name), ['get_query_options', 'query_dataset_aggregate']);

    const options = await registered[0].execute({}) as { ok: true; data: { datasets: unknown[]; relationships: unknown[]; limits: Record<string, number> } };
    assert.equal(options.ok, true);
    assert.equal(options.data.datasets.length, 7);
    assert.equal(options.data.relationships.length, 2);
    assert.equal(options.data.limits.maxLimit, 500);

    const result = await registered[1].execute({ query }) as { ok: true; data: { rows: Record<string, unknown>[]; metadata: Record<string, unknown> } };
    assert.equal(result.ok, true);
    assert.deepEqual(result.data.rows, [{ 'customers.region': 'NA', 'customers.customer_id:count': 12 }]);
    assert.deepEqual(result.data.metadata.sourceTables, ['customers']);
    assert.equal(logs.length, 2);
    cleanup();
    assert.deepEqual(unregistered, ['get_query_options', 'query_dataset_aggregate']);
  } finally {
    removePolyfill();
  }
});

test('rejects invalid contracts before calling the aggregate backend', async () => {
  const registered: RegisteredTool[] = [];
  const unregistered: string[] = [];
  let calls = 0;
  installPolyfill(registered, unregistered);
  try {
    registerQueryTools(() => {}, async () => {
      calls += 1;
      return { ok: true, data: { rows: [], metadata: {} } };
    });
    const result = await registered[1].execute({ query: { ...query, sql: 'select * from customers' } }) as { ok: false; reason: string; error: string };
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unknown_field');
    assert.match(result.error, /Unknown query field/);
    assert.equal(calls, 0);
  } finally {
    removePolyfill();
  }
});

test('returns a bounded backend error envelope and logs rejection', async () => {
  const registered: RegisteredTool[] = [];
  const unregistered: string[] = [];
  const logs: string[] = [];
  installPolyfill(registered, unregistered);
  try {
    registerQueryTools((message) => logs.push(message), async () => ({
      ok: false, reason: 'unavailable', error: 'select secret from users; SERVICE_ROLE_KEY=do-not-leak',
    }));
    const result = await registered[1].execute({ query }) as { ok: false; reason: string; error: string };
    assert.deepEqual(result, { ok: false, reason: 'unavailable', error: 'Aggregate query service is unavailable. Try again.' });
    assert.match(logs[0], /rejected: unavailable/);
  } finally {
    removePolyfill();
  }
});
