import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CHART_STATE } from './chartValidation.ts';
import { DEFAULT_FILTERS } from './reportFilters.ts';
import { addUndoFrame, invalidateUndoFrames, popUndoFrame } from './undoState.ts';

const DEFAULT_DASHBOARD_STATE = { charts: DEFAULT_CHART_STATE, filters: DEFAULT_FILTERS };

test('a successful undo uses the edit version and pops one frame', () => {
  const frames = addUndoFrame([], DEFAULT_DASHBOARD_STATE, 7, { kind: 'filter_patch', patch: { segment: 'Enterprise' }, actor: 'person' });
  assert.equal(frames.at(-1)?.resultingVersion, 7);
  assert.equal(frames.at(-1)?.mutation.kind, 'filter_patch');
  assert.equal(popUndoFrame(frames).length, 0);
});

test('contract edits are undoable shared mutations', () => {
  const frames = addUndoFrame([], DEFAULT_DASHBOARD_STATE, 8, {
    kind: 'chart_contract', chartId: 'arr_mix', contract: { version: 1, chartId: 'arr_mix', presentation: 'bar' }, actor: 'agent',
  });
  assert.equal(frames.at(-1)?.mutation.kind, 'chart_contract');
});

test('Top Accounts presentation edits use the same undo frame', () => {
  const frames = addUndoFrame([], DEFAULT_DASHBOARD_STATE, 9, {
    kind: 'chart_contract', chartId: 'top_accounts', contract: { version: 1, chartId: 'top_accounts', presentation: 'bar' }, actor: 'agent',
  });
  const mutation = frames.at(-1)?.mutation;
  assert.equal(mutation?.kind, 'chart_contract');
  if (mutation?.kind === 'chart_contract') assert.equal(mutation.chartId, 'top_accounts');
  assert.equal(popUndoFrame(frames).length, 0);
});

test('a remote version invalidates local undo history without changing state', () => {
  const frames = addUndoFrame([], DEFAULT_DASHBOARD_STATE, 7, { kind: 'filter_patch', patch: { segment: 'Enterprise' }, actor: 'person' });
  assert.deepEqual(invalidateUndoFrames(frames, 8), []);
  assert.equal(DEFAULT_DASHBOARD_STATE.filters.segment, 'all');
});
