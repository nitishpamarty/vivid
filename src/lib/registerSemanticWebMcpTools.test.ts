import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerSemanticWebMcpTools, type SemanticToolBridge } from './registerSemanticWebMcpTools.ts';
import type { SemanticLayerResult } from './semanticLayerClient.ts';

type RegisteredTool = { name: string; execute: (input: Record<string, unknown>) => Promise<unknown> };

function installPolyfill(tools: RegisteredTool[], unregistered: string[]) {
  (globalThis as unknown as { document?: unknown }).document = {
    modelContext: { registerTool(tool: RegisteredTool) { tools.push(tool); return () => unregistered.push(tool.name); } },
  };
}
function removePolyfill() { delete (globalThis as unknown as { document?: unknown }).document; }

function makeBridge(overrides: Partial<SemanticToolBridge> = {}): SemanticToolBridge {
  return {
    getBusinessDefinitions: async () => ({ ok: true, data: { measures: [] } }) as SemanticLayerResult,
    queryBusinessMetric: async () => ({ ok: true, data: { rows: [] } }) as SemanticLayerResult,
    ...overrides,
  };
}

test('registers exactly the two semantic tools and cleans up', () => {
  const registered: RegisteredTool[] = [];
  const unregistered: string[] = [];
  installPolyfill(registered, unregistered);
  try {
    const cleanup = registerSemanticWebMcpTools(makeBridge());
    assert.deepEqual(registered.map((t) => t.name), ['get_business_definitions', 'query_business_metric']);
    cleanup();
    assert.deepEqual(unregistered, ['get_business_definitions', 'query_business_metric']);
  } finally {
    removePolyfill();
  }
});

test('does nothing without a model context', () => {
  const documentHost = globalThis as unknown as { document?: unknown };
  const originalDocument = documentHost.document;
  delete documentHost.document;
  try {
    const cleanup = registerSemanticWebMcpTools(makeBridge());
    assert.doesNotThrow(cleanup);
  } finally {
    if (originalDocument === undefined) delete documentHost.document;
    else documentHost.document = originalDocument;
  }
});

test('get_business_definitions delegates to the bridge', async () => {
  const registered: RegisteredTool[] = [];
  const unregistered: string[] = [];
  installPolyfill(registered, unregistered);
  try {
    registerSemanticWebMcpTools(makeBridge({ getBusinessDefinitions: async () => ({ ok: true, data: { measures: ['mrr_cube.mrr'] } }) }));
    const tool = registered.find((t) => t.name === 'get_business_definitions')!;
    const result = await tool.execute({}) as { ok: true; data: { measures: string[] } };
    assert.equal(result.ok, true);
    assert.deepEqual(result.data.measures, ['mrr_cube.mrr']);
  } finally {
    removePolyfill();
  }
});

test('query_business_metric passes the query object through to the bridge', async () => {
  const registered: RegisteredTool[] = [];
  const unregistered: string[] = [];
  installPolyfill(registered, unregistered);
  try {
    let received: Record<string, unknown> | undefined;
    registerSemanticWebMcpTools(makeBridge({
      queryBusinessMetric: async (query) => { received = query; return { ok: true, data: {} }; },
    }));
    const tool = registered.find((t) => t.name === 'query_business_metric')!;
    await tool.execute({ query: { measures: ['mrr_cube.mrr'] } });
    assert.deepEqual(received, { measures: ['mrr_cube.mrr'] });
  } finally {
    removePolyfill();
  }
});

test('query_business_metric surfaces a not_ready error from the bridge', async () => {
  const registered: RegisteredTool[] = [];
  const unregistered: string[] = [];
  installPolyfill(registered, unregistered);
  try {
    registerSemanticWebMcpTools(makeBridge({
      queryBusinessMetric: async () => { throw new Error('not_ready'); },
    }));
    const tool = registered.find((t) => t.name === 'query_business_metric')!;
    const result = await tool.execute({ query: {} }) as { ok: false; reason: string };
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not_ready');
  } finally {
    removePolyfill();
  }
});

test('does not register any chart/report tool', () => {
  const registered: RegisteredTool[] = [];
  const unregistered: string[] = [];
  installPolyfill(registered, unregistered);
  try {
    registerSemanticWebMcpTools(makeBridge());
    assert.ok(!registered.some((t) => t.name === 'update_chart_spec' || t.name === 'get_report_context'));
  } finally {
    removePolyfill();
  }
});

test('source has no import from chartState (independence guard)', () => {
  const src = readFileSync(fileURLToPath(new URL('./registerSemanticWebMcpTools.ts', import.meta.url)), 'utf8');
  assert.ok(!/from ['"].*chartState/.test(src), 'registerSemanticWebMcpTools.ts must not import chartState');
});
