import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addCanvasCard,
  createCanvasState,
  createChartCard,
  createMetricAnswerCard,
  createNoteCard,
  createTablePreviewCard,
  duplicateCanvasCard,
  moveCanvasCard,
  removeCanvasCard,
  renameCanvasCard,
  selectCanvasCard,
  reorderCanvasCards,
} from './explorationCanvas.ts';

const query = {
  source: 'customers' as const,
  dimensions: [{ field: { dataset: 'customers' as const, field: 'segment' } }],
  measures: [{ field: { dataset: 'customers' as const, field: 'customer_id' }, aggregate: 'count_distinct' as const }],
};
const chart = {
  version: 1 as const,
  mark: 'bar' as const,
  encoding: {
    x: { field: 'segment', type: 'nominal' as const },
    y: { field: 'customer_id', type: 'quantitative' as const, aggregate: 'count' as const },
  },
};

test('canvas card lifecycle is immutable and keeps a selected card', () => {
  const chartCard = createChartCard(query, chart, { id: 'chart-1', now: '2026-09-02T00:00:00.000Z' });
  const tableCard = createTablePreviewCard({ kind: 'dataset', datasetId: 'customers' }, {
    columns: ['name', 'segment'], rowCount: 2, sampled: false, fetchedAt: '2026-09-02T00:00:00.000Z',
  }, { id: 'table-1', now: '2026-09-02T00:00:00.000Z' });
  const noteCard = createNoteCard('Keep this context', { id: 'note-1', now: '2026-09-02T00:00:00.000Z' });
  const answerCard = createMetricAnswerCard('What is MRR?', {
    kind: 'semantic', source: { kind: 'semantic', cube: 'mrr_monthly' }, measures: ['mrr_monthly.total_mrr'], limit: 1,
  }, {
    id: 'answer-1', now: '2026-09-02T00:00:00.000Z',
    definitions: [{ kind: 'measure', name: 'mrr_monthly.total_mrr', cube: 'mrr_monthly' }],
    result: { columns: ['value'], rows: [{ value: 10 }], rowCount: 1, truncated: false },
    summary: 'MRR is $10.',
    answeredAt: '2026-09-02T00:00:00.000Z', caveats: [],
  });

  let state = createCanvasState();
  state = addCanvasCard(state, chartCard);
  state = addCanvasCard(state, tableCard);
  state = addCanvasCard(state, noteCard);
  state = addCanvasCard(state, answerCard);
  assert.deepEqual(state.cards.map((card) => card.id), ['chart-1', 'table-1', 'note-1', 'answer-1']);
  assert.equal(state.selectedCardId, 'answer-1');

  const beforeRename = state;
  state = selectCanvasCard(state, 'note-1');
  state = renameCanvasCard(state, 'note-1', 'Context', '2026-09-02T00:01:00.000Z');
  assert.equal(state.cards[2] && 'title' in state.cards[2] ? state.cards[2].title : undefined, 'Context');
  assert.equal(beforeRename.cards[2] && 'title' in beforeRename.cards[2] ? beforeRename.cards[2].title : undefined, undefined);

  state = duplicateCanvasCard(state, 'note-1', { id: 'note-2', now: '2026-09-02T00:02:00.000Z' });
  assert.deepEqual(state.cards.map((card) => card.id), ['chart-1', 'table-1', 'note-1', 'note-2', 'answer-1']);
  assert.equal(state.selectedCardId, 'note-2');
  state = reorderCanvasCards(state, ['answer-1', 'chart-1']);
  assert.deepEqual(state.cards.map((card) => card.id), ['answer-1', 'chart-1', 'table-1', 'note-1', 'note-2']);
  state = moveCanvasCard(state, 'note-2', -1);
  assert.deepEqual(state.cards.map((card) => card.id), ['answer-1', 'chart-1', 'table-1', 'note-2', 'note-1']);

  state = removeCanvasCard(state, 'answer-1');
  assert.deepEqual(state.cards.map((card) => card.id), ['chart-1', 'table-1', 'note-2', 'note-1']);
  assert.equal(state.selectedCardId, 'note-2');
  assert.equal(removeCanvasCard(state, 'missing').cards.length, 4);
});
