import type {
  AnswerCard,
  CardId,
  CanvasCard,
  ChartCard,
  ChartContract,
  DataSource,
  DatasetSource,
  NoteCard,
  QueryContract,
  TablePreviewCard,
} from './explorationModel.ts';

export interface CanvasState {
  cards: readonly CanvasCard[];
  selectedCardId: CardId | null;
}

export interface CanvasIdOptions {
  id?: CardId;
  now?: string;
}

const timestamp = (now?: string): string => now ?? new Date().toISOString();
const generatedId = (prefix: string): CardId => {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
};

export function createCanvasState(cards: readonly CanvasCard[] = []): CanvasState {
  return { cards: [...cards], selectedCardId: cards[0]?.id ?? null };
}

export function createChartCard(
  query: QueryContract,
  chart: ChartContract,
  options: CanvasIdOptions & { title?: string } = {},
): ChartCard {
  const createdAt = timestamp(options.now);
  return { id: options.id ?? generatedId('chart'), kind: 'chart', ...(options.title ? { title: options.title } : {}), query, chart, createdAt, updatedAt: createdAt };
}

export function createTablePreviewCard(
  source: DatasetSource,
  preview?: TablePreviewCard['preview'],
  options: CanvasIdOptions & { title?: string } = {},
): TablePreviewCard {
  const createdAt = timestamp(options.now);
  return { id: options.id ?? generatedId('table'), kind: 'table-preview', ...(options.title ? { title: options.title } : {}), source, ...(preview ? { preview } : {}), createdAt, updatedAt: createdAt };
}

export function createNoteCard(text = '', options: CanvasIdOptions & { title?: string } = {}): NoteCard {
  const createdAt = timestamp(options.now);
  return { id: options.id ?? generatedId('note'), kind: 'note', ...(options.title ? { title: options.title } : {}), text, createdAt, updatedAt: createdAt };
}

export function createMetricAnswerCard(
  question: string,
  query: AnswerCard['query'],
  options: CanvasIdOptions & Pick<AnswerCard, 'definitions' | 'result' | 'summary' | 'answeredAt' | 'caveats' | 'suggestedChart'> & { title?: string },
): AnswerCard {
  const createdAt = timestamp(options.now);
  return {
    id: options.id ?? generatedId('answer'), kind: 'metric-answer',
    ...(options.title ? { title: options.title } : {}), question,
    definitions: options.definitions, query, result: options.result,
    summary: options.summary,
    answeredAt: options.answeredAt, caveats: options.caveats,
    ...(options.suggestedChart ? { suggestedChart: options.suggestedChart } : {}),
    createdAt, updatedAt: createdAt,
  };
}

export function selectCanvasCard(state: CanvasState, cardId: CardId | null): CanvasState {
  if (cardId !== null && !state.cards.some((card) => card.id === cardId)) return state;
  return { ...state, selectedCardId: cardId };
}

export function addCanvasCard(state: CanvasState, card: CanvasCard): CanvasState {
  if (state.cards.some((candidate) => candidate.id === card.id)) return state;
  return { cards: [...state.cards, card], selectedCardId: card.id };
}

export function updateCanvasCard(
  state: CanvasState,
  cardId: CardId,
  update: (card: CanvasCard) => CanvasCard,
  now = new Date().toISOString(),
): CanvasState {
  let changed = false;
  const cards = state.cards.map((card) => {
    if (card.id !== cardId) return card;
    const next = update(card);
    if (next.id !== card.id) return card;
    changed = true;
    return { ...next, updatedAt: now };
  });
  return changed ? { ...state, cards } : state;
}

export function renameCanvasCard(state: CanvasState, cardId: CardId, title: string, now?: string): CanvasState {
  const trimmed = title.trim();
  return updateCanvasCard(state, cardId, (card) => ({ ...card, ...(trimmed ? { title: trimmed } : { title: undefined }) }), now);
}

export function duplicateCanvasCard(state: CanvasState, cardId: CardId, options: CanvasIdOptions = {}): CanvasState {
  const original = state.cards.find((card) => card.id === cardId);
  if (!original) return state;
  const createdAt = timestamp(options.now);
  const copy = { ...original, id: options.id ?? generatedId(original.kind), createdAt, updatedAt: createdAt } as CanvasCard;
  const index = state.cards.findIndex((card) => card.id === cardId);
  const cards = [...state.cards];
  cards.splice(index + 1, 0, copy);
  return { cards, selectedCardId: copy.id };
}

export function removeCanvasCard(state: CanvasState, cardId: CardId): CanvasState {
  const index = state.cards.findIndex((card) => card.id === cardId);
  if (index < 0) return state;
  const cards = state.cards.filter((card) => card.id !== cardId);
  let selectedCardId = state.selectedCardId;
  if (selectedCardId === cardId) selectedCardId = cards[Math.min(index, cards.length - 1)]?.id ?? null;
  return { cards, selectedCardId };
}

export function reorderCanvasCards(state: CanvasState, orderedIds: readonly CardId[]): CanvasState {
  const byId = new Map(state.cards.map((card) => [card.id, card]));
  const seen = new Set<CardId>();
  const ordered = orderedIds
    .filter((id) => !seen.has(id) && seen.add(id))
    .map((id) => byId.get(id))
    .filter((card): card is CanvasCard => Boolean(card));
  const included = new Set(ordered.map((card) => card.id));
  const remaining = state.cards.filter((card) => !included.has(card.id));
  const cards = [...ordered, ...remaining];
  return { ...state, cards };
}

export function moveCanvasCard(state: CanvasState, cardId: CardId, direction: -1 | 1): CanvasState {
  const index = state.cards.findIndex((card) => card.id === cardId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= state.cards.length) return state;
  const cards = [...state.cards];
  [cards[index], cards[nextIndex]] = [cards[nextIndex], cards[index]];
  return { ...state, cards };
}

export type { AnswerCard, CanvasCard, ChartCard, ChartContract, DataSource, DatasetSource, NoteCard, QueryContract, TablePreviewCard };
