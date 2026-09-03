import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CHART_STATE } from './chartValidation.ts';
import { DEFAULT_FILTERS } from './reportFilters.ts';
import { DEFAULT_REPORT_CHART_CONTRACTS, type ReportChartContracts } from './reportChartContract.ts';
import { registerNorthbeamTools, type ToolBridge } from './registerWebMcpTools.ts';

type RegisteredTool = { name: string; execute: (input: Record<string, unknown>) => Promise<unknown> };

function install(tools: RegisteredTool[], unregistered: string[]) {
  (globalThis as unknown as { document?: unknown }).document = { modelContext: {
    registerTool(tool: RegisteredTool) { tools.push(tool); return () => unregistered.push(tool.name); },
  } };
}

function remove() { delete (globalThis as unknown as { document?: unknown }).document; }

function bridge() {
  let contracts: ReportChartContracts = DEFAULT_REPORT_CHART_CONTRACTS;
  let contractCalls = 0;
  const state: ToolBridge = {
    getChartState: () => DEFAULT_CHART_STATE,
    applyChartPatch: async (chartId) => DEFAULT_CHART_STATE[chartId],
    getFilters: () => DEFAULT_FILTERS,
    applyFilterPatch: async () => DEFAULT_FILTERS,
    getTopAccounts: () => [],
    getAccountMatches: () => [],
    getValidAccountNames: () => [],
    getChartContracts: () => contracts,
    applyChartContract: async (chartId, contract) => {
      contractCalls += 1;
      contracts = { ...contracts, [chartId]: contract } as ReportChartContracts;
      return contracts[chartId];
    },
  };
  return { state, getContractCalls: () => contractCalls, getContracts: () => contracts };
}

test('registers discovery/read/write tools and cleans every registration', async () => {
  const tools: RegisteredTool[] = [];
  const unregistered: string[] = [];
  const local = bridge();
  install(tools, unregistered);
  try {
    const cleanup = registerNorthbeamTools(local.state);
    assert.deepEqual(tools.map(({ name }) => name), [
      'get_report_context', 'list_report_chart_options', 'get_report_chart_contract',
      'set_report_chart_contract', 'list_report_options', 'update_chart_spec',
      'set_report_filters', 'find_account_values', 'find_field_values',
    ]);
    const options = await tools[1].execute({}) as { ok: true; data: unknown[] };
    assert.equal(options.data.length, 6);
    const read = await tools[2].execute({ chartId: 'arr_mix' }) as { ok: true; data: unknown };
    assert.deepEqual(read.data, DEFAULT_REPORT_CHART_CONTRACTS.arr_mix);
    const write = await tools[3].execute({ chartId: 'arr_mix', contract: { version: 1, chartId: 'arr_mix', presentation: 'bar' } }) as { ok: true };
    assert.equal(write.ok, true);
    assert.equal(local.getContractCalls(), 1);
    cleanup();
    assert.deepEqual(unregistered, tools.map(({ name }) => name));
  } finally { remove(); }
});

test('validates before transport and leaves the prior contract unchanged', async () => {
  const tools: RegisteredTool[] = [];
  const local = bridge();
  install(tools, []);
  try {
    registerNorthbeamTools(local.state);
    const before = local.getContracts();
    const rejected = await tools[3].execute({ chartId: 'arr_mix', contract: { version: 1, chartId: 'arr_mix', presentation: 'donut', data: { values: ['secret'] } } }) as { ok: false; reason: string };
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, 'unknown_field');
    assert.equal(local.getContractCalls(), 0);
    assert.deepEqual(local.getContracts(), before);
    const mismatch = await tools[3].execute({ chartId: 'arr_mix', contract: { version: 1, chartId: 'top_accounts', presentation: 'bar' } }) as { ok: false; reason: string };
    assert.equal(mismatch.ok, false);
    assert.equal(local.getContractCalls(), 0);
  } finally { remove(); }
});
