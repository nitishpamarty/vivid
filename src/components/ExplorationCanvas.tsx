import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  updateCanvasCard,
  type CanvasState,
} from '../lib/explorationCanvas.ts';
import type {
  AnswerCard,
  CardId,
  CanvasCard,
  ChartContract,
  DatasetSource,
  QueryContract,
  TablePreviewCard,
} from '../lib/explorationModel.ts';
import {
  buildComposedChart,
  getCompositionFields,
  getRelationshipOptions,
} from '../lib/explorationComposition.ts';
import { getReachableDatasets, type NormalizedQueryContract, type QueryAggregate, type QueryDatasetId, type QueryFilterOperator } from '../lib/queryContract.ts';
import { registerCanvasTools, validateCanvasCard, type PersistedCanvasBridge } from '../lib/registerCanvasWebMcpTools.ts';
import type { RoomSession } from '../lib/roomSession.ts';
import {
  createExploration,
  getExplorationId,
  mutateExploration,
  openExploration,
  setExplorationId,
  snapshotForCanvas,
  subscribeExploration,
  type PersistedExploration,
} from '../lib/explorationPersistence.ts';

interface ActiveChart {
  query: QueryContract;
  chart: ChartContract;
}

interface ActivePreview {
  source: DatasetSource;
  preview: NonNullable<TablePreviewCard['preview']>;
}

export interface ExplorationCanvasProps {
  session?: RoomSession;
  activeChart?: ActiveChart | null;
  activePreview?: ActivePreview | null;
  activeDatasetId?: QueryDatasetId | null;
  onComposedChart?: (query: NormalizedQueryContract, chart: ChartContract) => void;
  onAgentActivity?: (message: string) => void;
}

const defaultTitle = (kind: string): string => ({
  chart: 'Chart',
  'table-preview': 'Table preview',
  note: 'Note',
  'metric-answer': 'Metric answer',
}[kind] ?? 'Card');

const sourceLabel = (card: { query: QueryContract }): string => {
  if ('kind' in card.query && card.query.kind === 'semantic') return `semantic · ${card.query.source.cube}`;
  if (!('kind' in card.query)) return getReachableDatasets(card.query.source, card.query.relationshipPath).join(' → ');
  return 'query';
};

const pathLabel = (query: QueryContract): string => {
  if ('kind' in query) return '';
  return query.relationshipPath?.length ? `Path: ${query.relationshipPath.join(' → ')}` : 'Path: none';
};

const cardTitle = (card: { kind: string; title?: string }): string => card.title ?? defaultTitle(card.kind);
const shouldApplyRemote = (incoming: number, current: number): boolean => Number.isSafeInteger(incoming) && incoming > current;

function validateSnapshotCards(cards: readonly unknown[]): CanvasCard[] | null {
  const ids = new Set<string>();
  const normalized: CanvasCard[] = [];
  for (const candidate of cards) {
    const result = validateCanvasCard(candidate);
    if (!result.ok || ids.has(result.data.id)) return null;
    ids.add(result.data.id);
    normalized.push(result.data);
  }
  return normalized;
}

function answerPlaceholder(): AnswerCard {
  return createMetricAnswerCard(
    'New metric question',
    {
      kind: 'semantic', source: { kind: 'semantic', cube: 'mrr_monthly' },
      measures: ['mrr_monthly.total_mrr'], limit: 1,
    },
    {
      definitions: [{ kind: 'measure', name: 'mrr_monthly.total_mrr', cube: 'mrr_monthly' }],
      result: { columns: [], rows: [], rowCount: 0, truncated: false },
      summary: 'Answer not run yet.',
      answeredAt: new Date().toISOString(), caveats: ['Answer not run yet.'],
    },
  );
}

export function ExplorationCanvas({ session, activeChart = null, activePreview = null, activeDatasetId = null, onComposedChart, onAgentActivity }: ExplorationCanvasProps) {
  const [canvas, setCanvas] = useState<CanvasState>(() => createCanvasState());
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;
  const [persistenceStatus, setPersistenceStatus] = useState<'loading' | 'saving' | 'ready' | 'error' | 'conflict' | 'local'>('local');
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [persistenceVersion, setPersistenceVersion] = useState(0);
  const [persistenceRole, setPersistenceRole] = useState<'owner' | 'editor' | 'viewer' | null>(null);
  const [explorationId, setExplorationIdState] = useState<string | null>(null);
  const roleRef = useRef<'owner' | 'editor' | 'viewer' | null>(null);
  const skipPersistRef = useRef(false);
  const explorationIdRef = useRef<string | null>(null);
  const versionRef = useRef(0);
  const readyRef = useRef(!session);
  const pendingRef = useRef<CanvasState | null>(null);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const conflictRef = useRef<PersistedExploration | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const commitCanvas = useCallback((updater: (state: CanvasState) => CanvasState, persist = true) => setCanvas((state) => {
    const next = updater(state);
    canvasRef.current = next;
    if (persist && readyRef.current && session && explorationIdRef.current) {
      pendingRef.current = next;
      dirtyRef.current = true;
      void flushRef.current();
    }
    return next;
  }), [session]);
  const [relationshipId, setRelationshipId] = useState('');
  const [dimensionKey, setDimensionKey] = useState('');
  const [measureKey, setMeasureKey] = useState('');
  const [measureAggregate, setMeasureAggregate] = useState('');
  const [filterKey, setFilterKey] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [compositionError, setCompositionError] = useState<string | null>(null);
  const primaryChartId = useRef<CardId | null>(null);
  const activeChartRef = useRef(activeChart);
  activeChartRef.current = activeChart;
  const activePreviewRef = useRef(activePreview);
  activePreviewRef.current = activePreview;

  const applyRemote = useCallback((remote: PersistedExploration) => {
    if (!shouldApplyRemote(remote.version, versionRef.current)) return;
    const cards = validateSnapshotCards(remote.snapshot.cards);
    if (!cards) {
      setPersistenceStatus('error');
      setPersistenceError('A remote canvas snapshot failed local validation and was ignored.');
      return;
    }
    // Never overwrite edits that have not been accepted by the server. Keep
    // the remote snapshot available for an explicit retry/reconciliation.
    if (dirtyRef.current || savingRef.current || pendingRef.current) {
      conflictRef.current = remote;
      setPersistenceVersion(remote.version);
      setPersistenceStatus('conflict');
      setPersistenceError(`Another editor saved version ${remote.version}. Your local edits are preserved.`);
      return;
    }
    versionRef.current = remote.version;
    roleRef.current = remote.role;
    setPersistenceRole(remote.role);
    setPersistenceVersion(remote.version);
    const next = createCanvasState(cards);
    canvasRef.current = next;
    setCanvas(next);
  }, []);

  const flush = useCallback(async () => {
    if (!session || !explorationIdRef.current || savingRef.current || !pendingRef.current || conflictRef.current) return;
    savingRef.current = true;
    setPersistenceStatus('saving');
    const next = pendingRef.current;
    pendingRef.current = null;
    const result = await mutateExploration(session, explorationIdRef.current, versionRef.current, snapshotForCanvas(next.cards));
    savingRef.current = false;
    if (!result.ok) {
      if (result.reason === 'version_conflict' && result.currentVersion !== undefined) {
        const remote = await openExploration(session, explorationIdRef.current);
        if (remote.ok) conflictRef.current = remote.data;
        setPersistenceVersion(result.currentVersion);
        setPersistenceStatus('conflict');
        setPersistenceError('Another editor saved this exploration. Your local edits are preserved; review and retry when ready.');
      } else {
        pendingRef.current = pendingRef.current ?? next;
        setPersistenceStatus('error');
        setPersistenceError(result.error);
      }
      return;
    }
    versionRef.current = result.data.version;
    setPersistenceVersion(result.data.version);
    roleRef.current = result.data.role;
    setPersistenceRole(result.data.role);
    setPersistenceStatus('ready');
    setPersistenceError(null);
    dirtyRef.current = Boolean(pendingRef.current);
    if (pendingRef.current) void flushRef.current();
  }, [session]);
  flushRef.current = flush;

  const retryPersistence = useCallback(() => {
    const remote = conflictRef.current;
    if (!remote) return;
    versionRef.current = remote.version;
    setPersistenceVersion(remote.version);
    conflictRef.current = null;
    pendingRef.current = canvasRef.current;
    dirtyRef.current = true;
    setPersistenceStatus('ready');
    setPersistenceError(null);
    void flushRef.current();
  }, []);

  // A capability-backed exploration is created once per session/link. The
  // id is added to the URL fragment so re-opening the shared link loads the
  // same server snapshot without putting the capability in query parameters.
  useEffect(() => {
    if (!session) return;
    let active = true;
    const existingId = getExplorationId(window.location.href);
    setPersistenceStatus('loading');
    const load = existingId
      ? openExploration(session, existingId)
      : createExploration(session, snapshotForCanvas([]));
    void load.then((result) => {
      if (!active) return;
      if (!result.ok) {
        setPersistenceStatus('error');
        setPersistenceError(result.error);
        return;
      }
      const id = result.data.explorationId;
      explorationIdRef.current = id;
      setExplorationIdState(id);
      if (!existingId) window.history.replaceState(null, '', setExplorationId(window.location.href, id));
      versionRef.current = result.data.version;
      roleRef.current = result.data.role;
      setPersistenceVersion(result.data.version);
      setPersistenceRole(result.data.role);
      conflictRef.current = null;
      pendingRef.current = null;
      dirtyRef.current = false;
      const cards = validateSnapshotCards(result.data.snapshot.cards);
      if (!cards) {
        setPersistenceStatus('error');
        setPersistenceError('The saved canvas failed local validation and was not loaded.');
        return;
      }
      let loaded = createCanvasState(cards);
      // Preserve the existing Connect Data first-chart affordance for a new
      // exploration, while never replacing cards loaded from a shared link.
      if (loaded.cards.length === 0 && activeChartRef.current) {
        const current = activeChartRef.current;
        const card = createChartCard(current.query, current.chart, { title: current.chart.title ?? 'Current chart' });
        primaryChartId.current = card.id;
        loaded = addCanvasCard(loaded, card);
      }
      canvasRef.current = loaded;
      setCanvas(loaded);
      readyRef.current = true;
      setPersistenceStatus('ready');
      setPersistenceError(null);
      if (loaded.cards.length > 0 && result.data.snapshot.cards.length === 0) {
        pendingRef.current = loaded;
        dirtyRef.current = true;
        void flushRef.current();
      }
      const stop = subscribeExploration(session, id, applyRemote, (status) => {
        if (active && status === 'unavailable') {
          setPersistenceStatus('error');
          setPersistenceError('Live updates are unavailable; saved edits can still be retried.');
        }
      });
      // Keep cleanup tied to this load, including when a tab changes quickly.
      cleanupRef.current = stop;
    });
    return () => { active = false; cleanupRef.current?.(); cleanupRef.current = null; readyRef.current = !session; };
  }, [session, applyRemote]);

  // The current single-chart flow becomes the first card automatically. A
  // stable JSON key keeps contract edits from creating a new card on every
  // render while still mirroring an agent/person chart-contract update.
  const activeChartKey = useMemo(() => activeChart ? JSON.stringify(activeChart) : null, [activeChart]);
  useEffect(() => {
    if (!readyRef.current) return;
    const current = activeChartRef.current;
    if (!current || !activeChartKey) return;
    commitCanvas((state) => {
      const primaryId = primaryChartId.current;
      const existing = primaryId ? state.cards.find((card) => card.id === primaryId && card.kind === 'chart') : undefined;
      if (existing?.kind === 'chart') {
        return updateCanvasCard(state, existing.id, (card) => card.kind === 'chart'
          ? { ...card, query: current.query, chart: current.chart, title: current.chart.title ?? card.title }
          : card);
      }
      const card = createChartCard(current.query, current.chart, { title: current.chart.title ?? 'Current chart' });
      primaryChartId.current = card.id;
      return addCanvasCard(state, card);
    });
  }, [activeChartKey]);

  const addCard = (card: Parameters<typeof addCanvasCard>[1]) => commitCanvas((state) => addCanvasCard(state, card));
  const rename = (cardId: CardId, title: string) => commitCanvas((state) => renameCanvasCard(state, cardId, title));
  const canvasBridge: PersistedCanvasBridge = {
    getState: () => canvasRef.current,
    replaceState: (next) => {
      const skipPersist = skipPersistRef.current;
      skipPersistRef.current = false;
      commitCanvas(() => next, !skipPersist);
    },
    logAgent: onAgentActivity ?? (() => {}),
    getCapability: () => session?.capability,
    getExplorationId: () => explorationIdRef.current,
    getVersion: () => versionRef.current,
    getRole: () => roleRef.current,
    setPersistedExploration: (record) => {
      skipPersistRef.current = true;
      explorationIdRef.current = record.explorationId;
      setExplorationIdState(record.explorationId);
      if (typeof window !== 'undefined') window.history.replaceState(null, '', setExplorationId(window.location.href, record.explorationId));
      versionRef.current = record.version;
      setPersistenceVersion(record.version);
      roleRef.current = record.role;
      setPersistenceRole(record.role);
    },
  };
  useEffect(() => registerCanvasTools(canvasBridge), [commitCanvas, onAgentActivity, session]);
  const selected = canvas.cards.find((card) => card.id === canvas.selectedCardId);
  const canEdit = persistenceStatus !== 'loading' && persistenceStatus !== 'error' && persistenceRole !== 'viewer';
  const canRetry = persistenceRole !== 'viewer';
  const addCurrentChart = () => {
    const current = activeChartRef.current;
    if (!current) return;
    addCard(createChartCard(current.query, current.chart, { title: current.chart.title ?? 'Chart' }));
  };
  const addPreview = () => {
    const current = activePreviewRef.current;
    if (!current) return;
    addCard(createTablePreviewCard(current.source, current.preview));
  };
  const addMetricAnswer = () => addCard(answerPlaceholder());
  const relationshipOptions = useMemo(
    () => activeDatasetId ? getRelationshipOptions(activeDatasetId) : [],
    [activeDatasetId],
  );
  const compositionFields = useMemo(
    () => activeDatasetId ? getCompositionFields(activeDatasetId, relationshipId ? [relationshipId] : []) : [],
    [activeDatasetId, relationshipId],
  );
  const dimensions = compositionFields.filter(({ definition }) => definition.dimension);
  const measures = compositionFields.filter(({ definition }) => definition.aggregates?.length);
  const filters = compositionFields.filter(({ definition }) => definition.filterable);
  const findField = (key: string) => compositionFields.find(({ ref }) => `${ref.dataset}.${ref.field}` === key);

  useEffect(() => {
    setRelationshipId('');
    setCompositionError(null);
  }, [activeDatasetId]);
  useEffect(() => {
    if (!dimensions.some(({ ref }) => `${ref.dataset}.${ref.field}` === dimensionKey)) {
      setDimensionKey(dimensions[0] ? `${dimensions[0].ref.dataset}.${dimensions[0].ref.field}` : '');
    }
    if (!measures.some(({ ref }) => `${ref.dataset}.${ref.field}` === measureKey)) {
      const first = measures[0];
      setMeasureKey(first ? `${first.ref.dataset}.${first.ref.field}` : '');
      setMeasureAggregate(first?.definition.aggregates?.[0] ?? '');
    }
    if (!filters.some(({ ref }) => `${ref.dataset}.${ref.field}` === filterKey)) setFilterKey('');
  }, [dimensions, measures, filters, dimensionKey, measureKey, filterKey]);
  const createComposed = () => {
    if (!activeDatasetId) return;
    const dimension = findField(dimensionKey);
    const measure = findField(measureKey);
    if (!dimension || !measure || !measureAggregate) {
      setCompositionError('Choose one dimension and one measure.');
      return;
    }
    const filter = filterKey && filterValue !== '' ? findField(filterKey) : undefined;
    let raw: string | number | boolean | undefined;
    if (filter) {
      if (filter.definition.type === 'number') raw = Number(filterValue);
      else if (filter.definition.type === 'boolean') {
        if (filterValue !== 'true' && filterValue !== 'false') {
          setCompositionError('Boolean filters must be true or false.');
          return;
        }
        raw = filterValue === 'true';
      } else raw = filterValue;
    }
    const result = buildComposedChart({
      source: activeDatasetId,
      relationshipPath: relationshipId ? [relationshipId] : [],
      dimension: dimension.ref,
      measure: { field: measure.ref, aggregate: measureAggregate as QueryAggregate },
      ...(filter ? { filter: { field: filter.ref, operator: 'eq' as QueryFilterOperator, value: raw } } : {}),
      title: `${dimension.ref.field} by ${measure.ref.field}`,
    });
    if (!result.ok) {
      setCompositionError(result.error);
      return;
    }
    setCompositionError(null);
    addCard(createChartCard(result.data.query, result.data.chart as ChartContract, { title: result.data.chart.title ?? 'Composed chart' }));
    onComposedChart?.(result.data.query, result.data.chart as ChartContract);
  };

  return (
    <section className="card canvas" aria-label="Exploration canvas">
      <div className="canvas-head">
        <div>
          <p className="panel-title">Exploration canvas</p>
          <p className="panel-sub">Arrange governed query cards. Cards never store raw data or Vega specs.</p>
          <p className="explore-status" data-testid="canvas-persistence-status" aria-live="polite">
            {persistenceStatus === 'local' && 'Local canvas'}
            {persistenceStatus === 'loading' && 'Loading saved canvas…'}
            {persistenceStatus === 'saving' && `Saving exploration${explorationId ? ` · v${persistenceVersion}` : ''}`}
            {persistenceStatus === 'ready' && `Saved exploration${explorationId ? ` · v${persistenceVersion}` : ''}${persistenceRole ? ` · ${persistenceRole}` : ''}`}
            {persistenceStatus === 'error' && 'Save unavailable'}
            {persistenceStatus === 'conflict' && 'Conflict detected — your local edits are preserved.'}
          </p>
          {(persistenceStatus === 'error' || persistenceStatus === 'conflict') && persistenceError && <p className="explore-status explore-status-error" role="alert">{persistenceError}</p>}
          {persistenceStatus === 'conflict' && canRetry && <button type="button" className="canvas-add" onClick={retryPersistence}>Retry save my changes</button>}
          {persistenceStatus === 'error' && session && canRetry && <button type="button" className="canvas-add" onClick={() => { setPersistenceStatus('ready'); setPersistenceError(null); pendingRef.current = canvasRef.current; dirtyRef.current = true; void flushRef.current(); }}>Retry save</button>}
        </div>
        <div className="canvas-actions">
          <button type="button" className="canvas-add" onClick={addCurrentChart} disabled={!activeChart || !canEdit}>+ Chart</button>
          <button type="button" className="canvas-add" onClick={addPreview} disabled={!activePreview || !canEdit}>+ Table</button>
          <button type="button" className="canvas-add" onClick={() => addCard(createNoteCard(''))} disabled={!canEdit}>+ Note</button>
          <button type="button" className="canvas-add" onClick={addMetricAnswer} disabled={!canEdit}>+ Metric answer</button>
        </div>
      </div>

      {activeDatasetId && relationshipOptions.length > 0 && (
        <div className="canvas-composer" aria-label="Multi-dataset chart composer">
          <div>
            <p className="panel-title">Compose from related data</p>
            <p className="panel-sub">Select one declared relationship path. Fields from other tables stay unavailable until that path is selected.</p>
          </div>
          <div className="canvas-composer-grid">
            <label htmlFor="canvas-relationship-path">Relationship path
              <select id="canvas-relationship-path" value={relationshipId} onChange={(event) => setRelationshipId(event.target.value)} disabled={!canEdit}>
                <option value="">{activeDatasetId} only</option>
                {relationshipOptions.map((relationship) => <option key={relationship.id} value={relationship.id}>{activeDatasetId} → {relationship.to}</option>)}
              </select>
            </label>
            <label htmlFor="canvas-dimension">Dimension
              <select id="canvas-dimension" value={dimensionKey} onChange={(event) => setDimensionKey(event.target.value)} disabled={!canEdit}>
                {dimensions.map(({ ref }) => <option key={`${ref.dataset}.${ref.field}`} value={`${ref.dataset}.${ref.field}`}>{ref.dataset}.{ref.field}</option>)}
              </select>
            </label>
            <label htmlFor="canvas-measure">Measure
              <select id="canvas-measure" value={measureKey} onChange={(event) => { setMeasureKey(event.target.value); const selected = findField(event.target.value); setMeasureAggregate(selected?.definition.aggregates?.[0] ?? ''); }} disabled={!canEdit}>
                {measures.map(({ ref }) => <option key={`${ref.dataset}.${ref.field}`} value={`${ref.dataset}.${ref.field}`}>{ref.dataset}.{ref.field}</option>)}
              </select>
            </label>
            <label htmlFor="canvas-aggregate">Aggregate
              <select id="canvas-aggregate" value={measureAggregate} onChange={(event) => setMeasureAggregate(event.target.value)} disabled={!canEdit}>
                {(findField(measureKey)?.definition.aggregates ?? []).map((aggregate) => <option key={aggregate} value={aggregate}>{aggregate}</option>)}
              </select>
            </label>
            <label htmlFor="canvas-filter">Filter (optional)
              <select id="canvas-filter" value={filterKey} onChange={(event) => setFilterKey(event.target.value)} disabled={!canEdit}>
                <option value="">No filter</option>
                {filters.map(({ ref }) => <option key={`${ref.dataset}.${ref.field}`} value={`${ref.dataset}.${ref.field}`}>{ref.dataset}.{ref.field}</option>)}
              </select>
            </label>
            {filterKey && <label htmlFor="canvas-filter-value">Equals
              <input id="canvas-filter-value" value={filterValue} onChange={(event) => setFilterValue(event.target.value)} placeholder="exact value" disabled={!canEdit} />
            </label>}
          </div>
          <div className="canvas-composer-foot">
            <span className="canvas-detail">Tables: {[activeDatasetId, ...(relationshipOptions.find(({ id }) => id === relationshipId)?.to ? [relationshipOptions.find(({ id }) => id === relationshipId)!.to] : [])].join(' → ')}</span>
            <button type="button" className="canvas-add" onClick={createComposed} disabled={!canEdit}>+ Add governed chart</button>
          </div>
          {compositionError && <p className="explore-status explore-status-error" role="alert">{compositionError}</p>}
        </div>
      )}

      {canvas.cards.length === 0 && <p className="canvas-empty" role="status">No cards yet. Add a governed chart, table preview, note, or metric answer above.</p>}
      <div className="canvas-grid">
        {canvas.cards.map((card, index) => {
          const title = cardTitle(card);
          const selectedCard = card.id === canvas.selectedCardId;
          return (
            <article
              className={`canvas-card ${selectedCard ? 'selected' : ''}`}
              key={card.id}
              data-testid={`canvas-card-${card.id}`}
              tabIndex={0}
              aria-label={`${title} canvas card`}
              aria-current={selectedCard ? 'true' : undefined}
              onClick={() => commitCanvas((state) => selectCanvasCard(state, card.id))}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  commitCanvas((state) => selectCanvasCard(state, card.id));
                }
              }}
            >
              <div className="canvas-card-head">
                <span className="canvas-kind">{card.kind}</span>
                <div className="canvas-card-actions">
                  <button type="button" aria-label={`Move ${title} up`} onClick={(event) => { event.stopPropagation(); commitCanvas((state) => moveCanvasCard(state, card.id, -1)); }} disabled={!canEdit || index === 0}>↑</button>
                  <button type="button" aria-label={`Move ${title} down`} onClick={(event) => { event.stopPropagation(); commitCanvas((state) => moveCanvasCard(state, card.id, 1)); }} disabled={!canEdit || index === canvas.cards.length - 1}>↓</button>
                  <button type="button" aria-label={`Duplicate ${title}`} onClick={(event) => { event.stopPropagation(); commitCanvas((state) => duplicateCanvasCard(state, card.id)); }} disabled={!canEdit}>Duplicate</button>
                  <button type="button" aria-label={`Remove ${title}`} onClick={(event) => { event.stopPropagation(); commitCanvas((state) => removeCanvasCard(state, card.id)); }} disabled={!canEdit}>Remove</button>
                </div>
              </div>
              <input
                aria-label={`Rename ${title}`}
                className="canvas-title"
                value={title}
                readOnly={!canEdit}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => rename(card.id, event.target.value)}
              />
              {card.kind === 'chart' && (
                <div className="canvas-card-body">
                  <p><span className="canvas-badge">{'kind' in card.query ? 'Semantic query' : 'Direct dataset query'}</span> {card.chart.mark} chart · {sourceLabel(card)}</p>
                  <p className="canvas-detail">{pathLabel(card.query) || 'Governed query · app-owned data'}</p>
                  <p className="canvas-detail">{Object.entries(card.chart.encoding).map(([channel, encoding]) => `${channel}: ${encoding?.dataset ? `${encoding.dataset}.` : ''}${encoding?.field ?? ''}`).join(' · ')}</p>
                </div>
              )}
              {card.kind === 'table-preview' && (
                <div className="canvas-card-body">
                  <p><span className="canvas-badge">{card.preview?.sampled ? 'Sampled preview' : 'Complete preview'}</span> {card.source.datasetId} · {card.preview?.rowCount.toLocaleString() ?? 'No'} rows</p>
                  <p className="canvas-detail">Preview only; chart aggregates use the governed exact query path.</p>
                  <p className="canvas-detail">{card.preview?.columns.join(', ') ?? 'Schema preview'}</p>
                </div>
              )}
              {card.kind === 'note' && (
                <textarea
                  aria-label={`Edit ${title}`}
                  className="canvas-note"
                  value={card.text}
                  placeholder="Add context for this exploration"
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => commitCanvas((state) => updateCanvasCard(state, card.id, (current) => current.kind === 'note' ? { ...current, text: event.target.value } : current))}
                />
              )}
              {card.kind === 'metric-answer' && (
                <div className="canvas-card-body">
                  <p><span className="canvas-badge">Semantic query</span>{card.suggestedChart && <span className="canvas-badge canvas-badge-secondary">Suggested chart · not applied</span>}</p>
                  <p>{card.question}</p>
                  <p>{card.summary}</p>
                  <p className="canvas-detail">Definitions: {card.definitions.map((definition) => definition.name).join(', ')}</p>
                  <p className="canvas-detail">{card.query.source.cube} · {card.result.rowCount.toLocaleString()} result rows · governed semantic result</p>
                  {card.caveats.length > 0 && <p className="canvas-detail">Caveat: {card.caveats[0]}</p>}
                  {card.suggestedChart && <p className="canvas-detail">Suggestion: {card.suggestedChart.mark} chart; apply it with an explicit chart-card mutation.</p>}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {selected && <p className="canvas-selected">Selected: {cardTitle(selected)}</p>}
    </section>
  );
}
