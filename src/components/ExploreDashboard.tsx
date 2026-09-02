import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyDisplayTypeOverrides, buildDefaultContract, buildVegaLiteSpec, COLUMN_TYPES, DATASET_CATALOG,
  fetchDatasetRows, inferColumnTypes, validateChartContract,
  type ColumnType, type ExploreChartContract,
} from '../lib/datasets';
import { registerExploreTools, type DatasetSchema, type ExploreBridge, type ToolResult } from '../lib/registerExploreWebMcpTools';
import { Topbar, type ReportId } from './Topbar';
import { ActivityLog, type LogEntry } from './ActivityLog';
import { VegaLiteChart } from './VegaLiteChart';

interface ExploreState {
  datasetId: string | null;
  columns: Record<string, ColumnType>;
  overrides: Record<string, ColumnType>;
  rawRows: Record<string, unknown>[];
  totalCount: number;
  sampled: boolean;
  contract: ExploreChartContract | null;
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

export function ExploreDashboard({ report, onChangeReport }: { report: ReportId; onChangeReport: (r: ReportId) => void }) {
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
  const castRows = useMemo(
    () => (state.datasetId ? applyDisplayTypeOverrides(state.rawRows, state.overrides).rows : []),
    [state],
  );
  const spec = useMemo(() => (state.contract ? buildVegaLiteSpec(state.contract, castRows) : null), [state.contract, castRows]);
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
          {connectError && <p className="explore-status explore-status-error">Failed to connect: {connectError}</p>}
        </div>

        {schema && (
          <>
            {schema.sampled && (
              <p className="sample-banner">
                Showing {state.rawRows.length.toLocaleString()} of ~{schema.totalCount.toLocaleString()} rows in {activeLabel}, ordered deterministically — charts below are over this sample, not the full table.
              </p>
            )}

            <div className="card">
              <p className="panel-title">Schema</p>
              <p className="panel-sub">Display type is presentation-only, this session — it doesn't change the database column.</p>
              <table className="schema-table">
                <thead>
                  <tr><th>Column</th><th>Inferred type</th><th>Display type</th><th>Cast warnings</th></tr>
                </thead>
                <tbody>
                  {Object.entries(schema.columns).map(([col, inferred]) => (
                    <tr key={col}>
                      <td className="schema-col-name">{col}</td>
                      <td className="schema-col-type">{inferred}</td>
                      <td>
                        <select
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
              {spec && <VegaLiteChart spec={spec} className="explore-chart" />}
            </div>
          </>
        )}

        <ActivityLog entries={log} />
        </div>

        <footer className="note">Illustrative data for a fictional company — for direction review only.</footer>
      </div>
    </div>
  );
}
