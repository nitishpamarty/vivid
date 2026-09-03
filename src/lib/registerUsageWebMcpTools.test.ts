import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerUsageTools, type UsageToolBridge } from './registerUsageWebMcpTools.ts';
import type { UsageFilters } from './usageFilters.ts';

type RegisteredTool = { name: string; execute: (input: Record<string, unknown>) => Promise<unknown> };

function installPolyfill(tools: RegisteredTool[], unregistered: string[]) {
  (globalThis as unknown as { document?: unknown }).document = {
    modelContext: { registerTool(tool: RegisteredTool) { tools.push(tool); return () => unregistered.push(tool.name); } },
  };
}
function removePolyfill() { delete (globalThis as unknown as { document?: unknown }).document; }

function makeBridge(overrides: Partial<UsageToolBridge> = {}): UsageToolBridge {
  let filters: UsageFilters = { ownerTeam: 'all', reportId: 'all', asOfMonth: '2024-03' };
  return {
    getContext: () => ({ filters }),
    getOptions: () => ({ ownerTeam: ['all', 'Sales'], reportId: ['all'], asOfMonth: ['2024-03'] }),
    getFilters: () => filters,
    applyFilterPatch: async (patch) => { filters = { ...filters, ...patch } as UsageFilters; return filters; },
    getValidReportIds: () => ['r1', 'r2'],
    getValidMonths: () => ['2024-01', '2024-02', '2024-03'],
    findValues: () => ({ field: 'ownerTeam', value: 'Sales' }),
    ...overrides,
  };
}

test('registers exactly the four usage-namespaced tools and cleans up', () => {
  const registered: RegisteredTool[] = [];
  const unregistered: string[] = [];
  installPolyfill(registered, unregistered);
  try {
    const cleanup = registerUsageTools(makeBridge());
    assert.deepEqual(registered.map((t) => t.name), ['get_usage_context', 'list_usage_options', 'set_usage_filters', 'find_usage_values']);
    cleanup();
    assert.deepEqual(unregistered, ['get_usage_context', 'list_usage_options', 'set_usage_filters', 'find_usage_values']);
  } finally {
    removePolyfill();
  }
});

test('set_usage_filters rejects an invalid patch before mutating', async () => {
  const registered: RegisteredTool[] = [];
  const unregistered: string[] = [];
  installPolyfill(registered, unregistered);
  try {
    let applied = 0;
    registerUsageTools(makeBridge({ applyFilterPatch: async (patch) => { applied += 1; return { ownerTeam: 'all', reportId: 'all', asOfMonth: '2024-03', ...patch } as UsageFilters; } }));
    const tool = registered.find((t) => t.name === 'set_usage_filters')!;
    const result = await tool.execute({ patch: { reportId: 'ghost' } }) as { ok: false; reason: string };
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid_value');
    assert.equal(applied, 0);
  } finally {
    removePolyfill();
  }
});

test('set_usage_filters applies a validated patch through the bridge', async () => {
  const registered: RegisteredTool[] = [];
  const unregistered: string[] = [];
  installPolyfill(registered, unregistered);
  try {
    registerUsageTools(makeBridge());
    const tool = registered.find((t) => t.name === 'set_usage_filters')!;
    const result = await tool.execute({ patch: { ownerTeam: 'Sales' } }) as { ok: true; data: UsageFilters };
    assert.equal(result.ok, true);
    assert.equal(result.data.ownerTeam, 'Sales');
  } finally {
    removePolyfill();
  }
});

test('find_usage_values rejects an empty phrase and returns a no-match reason when nothing resolves', async () => {
  const registered: RegisteredTool[] = [];
  const unregistered: string[] = [];
  installPolyfill(registered, unregistered);
  try {
    registerUsageTools(makeBridge({ findValues: () => null }));
    const tool = registered.find((t) => t.name === 'find_usage_values')!;
    const empty = await tool.execute({ phrase: '' }) as { ok: false; reason: string };
    assert.equal(empty.reason, 'invalid_query');
    const noMatch = await tool.execute({ phrase: 'nonsense' }) as { ok: false; reason: string };
    assert.equal(noMatch.reason, 'no_match');
  } finally {
    removePolyfill();
  }
});

test('does not register update_chart_spec or any Revenue-namespaced tool', () => {
  const registered: RegisteredTool[] = [];
  const unregistered: string[] = [];
  installPolyfill(registered, unregistered);
  try {
    registerUsageTools(makeBridge());
    assert.ok(!registered.some((t) => t.name === 'update_chart_spec' || t.name === 'get_report_context'));
  } finally {
    removePolyfill();
  }
});
