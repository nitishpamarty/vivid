import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyDisplayTypeOverrides, buildDefaultContract, buildVegaLiteSpec, COLUMN_TYPES, DATASET_CATALOG,
  fetchDatasetAggregate, fetchDatasetRows, inferColumnTypes, validateChartContract,
  type AggregateQueryMetadata,
  type ColumnType, type ExploreChartContract,
} from '../lib/datasets';
import { buildAggregateChartPlan, projectAggregateRows, type AggregateChartPlan } from '../lib/exploreAggregate';
import { registerExploreTools, type DatasetSchema, type ExploreBridge, type ToolResult } from '../lib/registerExploreWebMcpTools';
import { Topbar, type ReportId } from './Topbar';
import { ActivityLog, type LogEntry } from './ActivityLog';
import { VegaLiteChart } from './VegaLiteChart';
import { ExplorationCanvas } from './ExplorationCanvas';
import type { ChartContract } from '../lib/explorationModel.ts';
import type { QueryDatasetId } from '../lib/queryContract.ts';
import type { RoomSession } from '../lib/roomSession.ts';

interface ExploreState {
  datasetId: string | null;
  columns: Record<string, ColumnType>;
  overrides: Record<string, ColumnType>;
  rawRows: Record<string, unknown>[];
  totalCount: number;
  sampled: boolean;
  contract: ExploreChartContract | null;
}

interface AggregateChartState {
  plan: AggregateChartPlan | null;
  rows: Record<string, unknown>[];
  metadata: AggregateQueryMetadata | null;
  loading: boolean;
  error: string | null;
}

interface ComposedChartInput {
  query: import('../lib/queryContract.ts').NormalizedQueryContract;
  chart: ExploreChartContract;
}

const EMPTY_STATE: ExploreState = {
  datasetId: null, columns: {}, overrides: {}, rawRows: [], totalCount: 0, sampled: false, contract: null,
};

function toSchema(s: ExploreState): DatasetSchema | null {
  if (!s.datasetId) return null;
  const { warnings } = applyDisplayTypeOverrides(s.rawRows, s.overrides);
  return {
    datasetId: s.datasetId, columns: s.columns, overrides: s.overrides, warnings, totalCount: s.totalCount, sampled: s.sampled,
  };
}

export function ExploreDashboard({ report, onChangeReport, session }: { report: ReportId; onChangeReport: (r: ReportId) => void; session: RoomSession }) {
  const [state, setState] = useState<ExploreState>(EMPTY_STATE);
  // Tool calls can arrive back-to-back with no render committed in between,
  // same reasoning as dashboardRef in App.tsx — this ref is the source of
  // truth mutating bridge methods read/write, not the last render's closure.
  const stateRef = useRef(state);
  stateRef.current = state;

  const [log, setLog] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [aggregateChart, setAggregateChart] = useState<AggregateChartState>({
    plan: null, rows: [], metadata: null, loading: false, error: null,
  });
  const [composedChart, setComposedChart] = useState<ComposedChartInput | null>(null);
  const [composedAggregate, setComposedAggregate] = useState<AggregateChartState>({
    plan: null, rows: [], metadata: null, loading: false, error: null,
  });

  const addLog = useCallback((actor: LogEntry['actor'], message: string) => {
    logIdRef.current += 1;
    setLog((prev) => [...prev, { id: logIdRef.current, actor, message, ts: new Date().toLocaleTimeString() }].slice(-50));
  }, []);

  const connectDataset = useCallback(async (datasetId: string): Promise<ToolResult<DatasetSchema>> => {
    const dataset = DATASET_CATALOG.find((d) => d.id === datasetId);
    if (!dataset) {
      return { ok: false, reason: 'unknown_dataset', error: `"${datasetId}" is not a known dataset. Valid ids: ${DATASET_CATALOG.map((d) => d.id).join(', ')}.` };
    }
    setConnecting(true);
    setConnectError(null);
    try {
      const { rows, totalCount, sampled } = await fetchDatasetRows(dataset);
      const columns = inferColumnTypes(rows);
      const contract = buildDefaultContract(columns, rows);
      const next: ExploreState = { datasetId, columns, overrides: {}, rawRows: rows, totalCount, sampled, contract };
      stateRef.current = next;
      setState(next);
      setComposedChart(null);
      return { ok: true, data: toSchema(next)! };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      setConnectError(error);
      return { ok: false, reason: 'fetch_failed', error };
    } finally {
      setConnecting(false);
    }
  }, []);

  const setColumnDisplayType = useCallback((column: string, type: ColumnType): ToolResult<DatasetSchema> => {
    const current = stateRef.current;
    if (!current.datasetId) return { ok: false, reason: 'not_connected', error: 'No dataset is connected yet — call connect_dataset first.' };
    if (!(column in current.columns)) {
      return { ok: false, reason: 'unknown_column', error: `"${column}" is not a column on the active dataset. Columns: ${Object.keys(current.columns).join(', ')}.` };
    }
    const next: ExploreState = { ...current, overrides: { ...current.overrides, [column]: type } };
    stateRef.current = next;
    setState(next);
    return { ok: true, data: toSchema(next)! };
  }, []);

  const setContract = useCallback((input: unknown) => {
    const current = stateRef.current;
    if (!current.datasetId) {
      return { ok: false, reason: 'not_connected', error: 'No dataset is connected yet — call connect_dataset first.' } as const;
    }
    const result = validateChartContract(input, Object.keys(current.columns));
    if (!result.ok) return result;
    const next: ExploreState = { ...current, contract: result.contract };
    stateRef.current = next;
    setState(next);
    return result;
  }, []);

  // Chart data is always an exact, bounded server aggregate. The sampled row
  // fetch remains available for schema/preview UX, but is never a chart
  // fallback when this request is loading or fails.
  useEffect(() => {
    if (!state.datasetId || !state.contract) {
      setAggregateChart({ plan: null, rows: [], metadata: null, loading: false, error: null });
      return;
    }
    const planned = buildAggregateChartPlan(state.datasetId, state.contract);
    if (!planned.ok) {
      setAggregateChart({ plan: null, rows: [], metadata: null, loading: false, error: planned.error });
      return;
    }
    let active = true;
    setAggregateChart({ plan: planned.data, rows: [], metadata: null, loading: true, error: null });
    fetchDatasetAggregate(planned.data.query).then((result) => {
      if (!active) return;
      const projected = projectAggregateRows(planned.data, result.rows);
      const aggregateOverrides = Object.fromEntries(
        planned.data.channels
          .map((channel) => [channel.outputField, state.overrides[channel.sourceField]] as const)
          .filter(([, type]) => type !== undefined),
      );
      const cast = applyDisplayTypeOverrides(projected, aggregateOverrides);
      setAggregateChart({ plan: planned.data, rows: cast.rows, metadata: result.metadata, loading: false, error: null });
    }).catch((error: unknown) => {
      if (!active) return;
      setAggregateChart({
        plan: planned.data, rows: [], metadata: null, loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return () => { active = false; };
  }, [state.datasetId, state.contract, state.overrides]);

  // Composed cards use the same exact aggregate endpoint as the active
  // single-table chart. Their path and field refs are already validated by
  // the canvas composer; this second plan pass keeps rendering governed too.
  useEffect(() => {
    if (!composedChart) {
      setComposedAggregate({ plan: null, rows: [], metadata: null, loading: false, error: null });
      return;
    }
    const planned = buildAggregateChartPlan(
      composedChart.query.source,
      composedChart.chart,
      composedChart.query.relationshipPath,
    );
    if (!planned.ok) {
      setComposedAggregate({ plan: null, rows: [], metadata: null, loading: false, error: planned.error });
      return;
    }
    let active = true;
    setComposedAggregate({ plan: planned.data, rows: [], metadata: null, loading: true, error: null });
    fetchDatasetAggregate(planned.data.query).then((result) => {
      if (!active) return;
      const projected = projectAggregateRows(planned.data, result.rows);
      setComposedAggregate({ plan: planned.data, rows: projected, metadata: result.metadata, loading: false, error: null });
    }).catch((error: unknown) => {
      if (!active) return;
      setComposedAggregate({ plan: planned.data, rows: [], metadata: null, loading: false, error: error instanceof Error ? error.message : String(error) });
    });
    return () => { active = false; };
  }, [composedChart]);

  const bridge = useMemo<ExploreBridge>(() => ({
    connectDataset,
    getSchema: () => toSchema(stateRef.current),
    setColumnDisplayType,
    getContract: () => stateRef.current.contract,
    setContract,
    logAgent: (message) => addLog('agent', message),
  }), [connectDataset, setColumnDisplayType, setContract, addLog]);

  useEffect(() => {
    (window as unknown as { __vividRegisterExploreTools?: () => () => void }).__vividRegisterExploreTools = () => registerExploreTools(bridge);
    return registerExploreTools(bridge);
  }, [bridge]);

  const handlePickDataset = useCallback((id: string) => {
    connectDataset(id).then((r) => {
      addLog('person', r.ok ? `connected dataset: ${id}` : `failed to connect ${id}: ${r.error}`);
    });
  }, [connectDataset, addLog]);

  const handleSetColumnType = useCallback((column: string, type: ColumnType) => {
    const r = setColumnDisplayType(column, type);
    addLog('person', r.ok ? `set ${column} display type to ${type}` : `failed to set ${column} type: ${r.error}`);
  }, [setColumnDisplayType, addLog]);

  const schema = toSchema(state);
  const fieldAliases = useMemo(
    () => Object.fromEntries((aggregateChart.plan?.channels ?? []).map((channel) => [channel.channel, channel.outputField])) as Partial<Record<'x' | 'y' | 'color' | 'theta', string>>,
    [aggregateChart.plan],
  );
  const spec = useMemo(
    () => (state.contract && aggregateChart.metadata ? buildVegaLiteSpec(state.contract, aggregateChart.rows, fieldAliases) : null),
    [state.contract, aggregateChart.metadata, aggregateChart.rows, fieldAliases],
  );
  const composedFieldAliases = useMemo(
    () => Object.fromEntries((composedAggregate.plan?.channels ?? []).map((channel) => [channel.channel, channel.outputField])) as Partial<Record<'x' | 'y' | 'color' | 'theta', string>>,
    [composedAggregate.plan],
  );
  const composedSpec = useMemo(
    () => (composedChart && composedAggregate.metadata ? buildVegaLiteSpec(composedChart.chart, composedAggregate.rows, composedFieldAliases) : null),
    [composedChart, composedAggregate.metadata, composedAggregate.rows, composedFieldAliases],
  );
  const activeLabel = DATASET_CATALOG.find((d) => d.id === state.datasetId)?.label;

  return (
    <div className="northbeam" data-report={report}>
      <div className="shell">
        <Topbar report={report} onChangeReport={onChangeReport} />

        <div className="stack">
        <div className="card">
          <p className="panel-title">Connect a dataset</p>
          <p className="panel-sub">Real Postgres tables (Supabase) — pick one, then co-author the chart below by editing its display types or letting an agent set the chart contract via WebMCP.</p>
          <div className="explore-picker">
            {DATASET_CATALOG.map((d) => (
              <button
                type="button"
                key={d.id}
                className={`pill-select ${state.datasetId === d.id ? 'active' : ''}`}
                onClick={() => handlePickDataset(d.id)}
                disabled={connecting}
              >
                {d.label}
              </button>
            ))}
          </div>
          {connecting && <p className="explore-status">Connecting…</p>}
          {connectError && <p className="explore-status explore-status-error" role="alert">Failed to connect: {connectError}</p>}
        </div>

        {state.datasetId && (
          <ExplorationCanvas
            session={session}
            activeDatasetId={state.datasetId as QueryDatasetId}
            activeChart={state.contract && aggregateChart.plan ? {
              query: aggregateChart.plan.query,
              chart: state.contract as ChartContract,
            } : null}
            onComposedChart={(query, chart) => setComposedChart({ query, chart })}
            onAgentActivity={(message) => addLog('agent', message)}
            activePreview={{
              source: { kind: 'dataset', datasetId: state.datasetId as QueryDatasetId },
              preview: {
                columns: Object.keys(state.columns),
                rowCount: state.rawRows.length,
                sampled: state.sampled,
                fetchedAt: new Date().toISOString(),
              },
            }}
          />
        )}

        {schema && (
          <>
            {schema.sampled && (
              <p className="sample-banner" role="status" data-testid="sampled-preview-banner">
                <strong>Sampled preview.</strong> Showing {state.rawRows.length.toLocaleString()} of ~{schema.totalCount.toLocaleString()} rows in {activeLabel}, ordered deterministically. The chart below uses a separate exact aggregate query.
              </p>
            )}

            <div className="card">
              <p className="panel-title">Schema</p>
              <p className="panel-sub">Display type is presentation-only, this session — it doesn't change the database column.</p>
              <table className="schema-table">
                <thead>
                  <tr><th scope="col">Column</th><th scope="col">Inferred type</th><th scope="col">Display type</th><th scope="col">Cast warnings</th></tr>
                </thead>
                <tbody>
                  {Object.entries(schema.columns).map(([col, inferred]) => (
                    <tr key={col}>
                      <td className="schema-col-name">{col}</td>
                      <td className="schema-col-type">{inferred}</td>
                      <td>
                        <select
                          aria-label={`Display type for ${col}`}
                          value={schema.overrides[col] ?? inferred}
                          onChange={(e) => handleSetColumnType(col, e.target.value as ColumnType)}
                        >
                          {COLUMN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td className="schema-col-warn">{schema.warnings[col] ? `${schema.warnings[col]} couldn't convert` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <p className="panel-title">{state.contract?.title ?? `${activeLabel} chart`}</p>
              <p className="panel-sub">Agent-editable via the set_chart_contract WebMCP tool — mark and encoding only, the app owns the underlying data.</p>
              {aggregateChart.loading && <p className="explore-status">Running exact aggregate…</p>}
              {aggregateChart.error && <p className="explore-status explore-status-error" role="alert">Exact aggregate unavailable: {aggregateChart.error}</p>}
              {spec && <VegaLiteChart spec={spec} className="explore-chart" />}
              {aggregateChart.metadata?.resultCount === 0 && <p className="explore-empty" role="status">No matching rows for this governed query.</p>}
              {aggregateChart.metadata && aggregateChart.plan && (
                <div className="aggregate-provenance" aria-label="Exact aggregate scope" data-testid="exact-aggregate-provenance">
                  <span className="aggregate-badge">Exact aggregate</span>
                  <span>Source: {aggregateChart.metadata.sourceTables.join(' → ')}</span>
                  <span>Grouped by: {aggregateChart.plan.query.dimensions.length ? aggregateChart.plan.query.dimensions.map(({ field }) => field.field).join(', ') : 'all rows'}</span>
                  <span>Measures: {aggregateChart.plan.query.measures.map(({ field, aggregate }) => `${aggregate}(${field.field})`).join(', ')}</span>
                  <span>Result: {aggregateChart.metadata.resultCount.toLocaleString()} row{aggregateChart.metadata.resultCount === 1 ? '' : 's'} / server limit {aggregateChart.metadata.appliedLimits.limit}{aggregateChart.metadata.truncated ? ' (more omitted)' : ''}</span>
                </div>
              )}
            </div>

            {composedChart && (
              <div className="card" data-testid="composed-chart-result">
                <p className="panel-title">{composedChart.chart.title ?? 'Composed chart'}</p>
                <p className="panel-sub">Exact aggregate across an explicitly selected relationship path.</p>
                {composedAggregate.loading && <p className="explore-status">Running exact aggregate…</p>}
                {composedAggregate.error && <p className="explore-status explore-status-error" role="alert">Exact aggregate unavailable: {composedAggregate.error}</p>}
                {composedSpec && <VegaLiteChart spec={composedSpec} className="explore-chart" />}
                {composedAggregate.metadata?.resultCount === 0 && <p className="explore-empty" role="status">No matching rows for this governed relationship path.</p>}
                {composedAggregate.metadata && composedAggregate.plan && (
                  <div className="aggregate-provenance" aria-label="Composed aggregate scope" data-testid="composed-exact-provenance">
                    <span className="aggregate-badge">Exact aggregate</span>
                    <span>Tables: {composedAggregate.metadata.sourceTables.join(' → ')}</span>
                    <span>Path: {composedAggregate.metadata.relationshipPath.join(' → ')}</span>
                    <span>Grouped by: {composedAggregate.plan.query.dimensions.map(({ field }) => `${field.dataset}.${field.field}`).join(', ')}</span>
                    <span>Measures: {composedAggregate.plan.query.measures.map(({ field, aggregate }) => `${aggregate}(${field.dataset}.${field.field})`).join(', ')}</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <ActivityLog entries={log} />
        </div>
      </div>
    </div>
  );
}
