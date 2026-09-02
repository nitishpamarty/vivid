import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { loadNorthbeamData } from './lib/loadData';
import type { NorthbeamData, Region, Segment } from './lib/types';
import {
  arrBridge, arrMixBySegment, computeKpis, logoChurnPct, monthLabel, monthList,
  netNewLogosByRegion, nrrTrailing12, topAccounts,
} from './lib/metrics';
import { PALETTE, BRAND } from './lib/palette';
import { type ChartId, type DashboardState, loadDashboardState, saveDashboardState, swatchHex } from './lib/chartState';
import { applyReportFilters, type ReportFilters } from './lib/reportFilters';
import { registerNorthbeamTools } from './lib/registerWebMcpTools';
import { Topbar } from './components/Topbar';
import { Filters } from './components/Filters';
import { KpiRow } from './components/KpiRow';
import { ArrBridgePanel } from './components/ArrBridgePanel';
import { RetentionPanel } from './components/RetentionPanel';
import { ArrMixDonut } from './components/ArrMixDonut';
import { TopAccounts } from './components/TopAccounts';
import { NewLogosHeatmap } from './components/NewLogosHeatmap';
import { ActivityLog, type LogEntry } from './components/ActivityLog';

function Dashboard({ data }: { data: NorthbeamData }) {
  // Calendar axis stays derived from the unfiltered data so windowing
  // (arrBridge/retention slice(-N)) is stable regardless of active filters —
  // only the rows feeding each metric are filtered, never the month list.
  const months = useMemo(() => monthList(data), [data]);
  const latest = months[months.length - 1];

  const [dashboard, setDashboard] = useState<DashboardState>(() => loadDashboardState());
  const [undoStack, setUndoStack] = useState<DashboardState[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const dashboardRef = useRef(dashboard);
  dashboardRef.current = dashboard;
  const undoStackRef = useRef(undoStack);
  undoStackRef.current = undoStack;

  const { charts: chartState, filters } = dashboard;

  const addLog = useCallback((actor: LogEntry['actor'], message: string) => {
    setLog((prev) => [...prev, { id: logIdRef.current++, actor, message, ts: new Date().toLocaleTimeString() }].slice(-50));
  }, []);

  // Tool calls (and clicks) can arrive back-to-back with no render committed
  // in between, so dashboardRef/undoStackRef are written here synchronously —
  // they're the source of truth these read from, not whatever the last render saw.
  const applyChartPatch = useCallback((chartId: ChartId, patch: Record<string, unknown>) => {
    const current = dashboardRef.current;
    const next = { ...current, charts: { ...current.charts, [chartId]: { ...current.charts[chartId], ...patch } } };
    undoStackRef.current = [...undoStackRef.current, current].slice(-10);
    dashboardRef.current = next;
    setUndoStack(undoStackRef.current);
    setDashboard(next);
    saveDashboardState(next);
    return next.charts[chartId];
  }, []);

  const applyFilterPatch = useCallback((patch: Record<string, unknown>) => {
    const current = dashboardRef.current;
    const next = { ...current, filters: { ...current.filters, ...patch } };
    undoStackRef.current = [...undoStackRef.current, current].slice(-10);
    dashboardRef.current = next;
    setUndoStack(undoStackRef.current);
    setDashboard(next);
    saveDashboardState(next);
    return next.filters;
  }, []);

  useEffect(() => {
    const bridge = {
      getChartState: () => dashboardRef.current.charts,
      applyChartPatch,
      getFilters: () => dashboardRef.current.filters,
      applyFilterPatch,
      getTopAccounts: () => accountsRef.current,
      logAgent: (message: string) => addLog('agent', message),
    };
    // A real WebMCP browser injects document.modelContext at document_start, before this
    // effect runs. This re-entry point exists only so evidence/README.md's manual loop can
    // be driven from devtools in a browser that doesn't have that extension.
    (window as unknown as { __vividRegisterTools?: () => () => void }).__vividRegisterTools = () => registerNorthbeamTools(bridge);
    return registerNorthbeamTools(bridge);
  }, [applyChartPatch, applyFilterPatch, addLog]);

  const handleUndo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const restored = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    dashboardRef.current = restored;
    setUndoStack(undoStackRef.current);
    setDashboard(restored);
    saveDashboardState(restored);
    addLog('person', 'undid last edit');
  }, [addLog]);

  const handleFilterChange = useCallback((patch: Partial<ReportFilters>) => {
    applyFilterPatch(patch);
    const [[key, value]] = Object.entries(patch);
    addLog('person', `set ${key} filter to ${value}`);
  }, [applyFilterPatch, addLog]);

  const handleToggleSegment = useCallback((segment: Segment) => {
    const next = dashboardRef.current.filters.segment === segment ? 'all' : segment;
    applyFilterPatch({ segment: next });
    addLog('person', next === 'all' ? 'cleared segment filter (clicked ARR mix)' : `set segment filter to ${next} (clicked ARR mix)`);
  }, [applyFilterPatch, addLog]);

  const handleToggleRegion = useCallback((region: Region) => {
    const next = dashboardRef.current.filters.region === region ? 'all' : region;
    applyFilterPatch({ region: next });
    addLog('person', next === 'all' ? 'cleared region filter (clicked heatmap)' : `set region filter to ${next} (clicked heatmap)`);
  }, [applyFilterPatch, addLog]);

  const handleToggleAccount = useCallback((name: string) => {
    const next = dashboardRef.current.filters.accountName === name ? 'all' : name;
    applyFilterPatch({ accountName: next });
    addLog('person', next === 'all' ? 'cleared account filter (clicked top accounts)' : `set account filter to ${next} (clicked top accounts)`);
  }, [applyFilterPatch, addLog]);

  const filteredData = useMemo(() => applyReportFilters(data, filters), [data, filters]);
  const kpis = useMemo(() => computeKpis(filteredData), [filteredData]);

  // Top Accounts is the account-filter picker — it always lists the top 5
  // for the current segment/region/plan (not narrowed by accountName
  // itself), so clicking a different account works without clearing first.
  const accountPickerData = useMemo(
    () => applyReportFilters(data, { ...filters, accountName: 'all' }),
    [data, filters.segment, filters.region, filters.planTier],
  );

  const bridgePoints = useMemo(
    () => arrBridge(filteredData, months, chartState.arr_bridge.windowMonths),
    [filteredData, months, chartState.arr_bridge.windowMonths],
  );

  const nrrMonths = months.slice(-chartState.retention_nrr.windowMonths);
  const churnMonths = months.slice(-chartState.retention_churn.windowMonths);
  const nrrLabels = nrrMonths.map(monthLabel);
  const churnLabels = churnMonths.map(monthLabel);
  const nrrSeries = useMemo(() => nrrMonths.map((m) => nrrTrailing12(filteredData, m, months)), [filteredData, months, nrrMonths]);
  const churnSeries = useMemo(
    () => churnMonths.map((m) => logoChurnPct(filteredData, m, months[months.indexOf(m) - 1])),
    [filteredData, months, churnMonths],
  );

  const mix = arrMixBySegment(filteredData, latest);
  const mixTotal = mix.SMB + mix['Mid-Market'] + mix.Enterprise || 1; // a narrow filter combo can genuinely zero this out
  const mixSegments: { label: string; segment: Segment; pct: number; color: string }[] = [
    { label: 'Enterprise', segment: 'Enterprise', pct: (mix.Enterprise / mixTotal) * 100, color: PALETTE.cat1 },
    { label: 'Mid-Market', segment: 'Mid-Market', pct: (mix['Mid-Market'] / mixTotal) * 100, color: PALETTE.cat2 },
    { label: 'SMB', segment: 'SMB', pct: (mix.SMB / mixTotal) * 100, color: PALETTE.cat3 },
  ];

  const accounts = topAccounts(accountPickerData, latest, 5);
  // The tool bridge is only re-registered when applyChartPatch/applyFilterPatch/
  // addLog change (effectively once) — accounts changes every render, so
  // getTopAccounts must read it through a ref, not close over the value.
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  const last6 = months.slice(-6);
  const last6Labels = last6.map(monthLabel);
  const heatmap = netNewLogosByRegion(filteredData, last6);

  return (
    <div className="northbeam">
      <div className="shell">
        <Topbar />
        <div className="toolbar-row">
          <div className="filters-wrap">
            <Filters filters={filters} onChange={handleFilterChange} />
            {filters.accountName !== 'all' && (
              <button type="button" className="pill-select active account-chip" onClick={() => handleToggleAccount(filters.accountName)}>
                {filters.accountName} ×
              </button>
            )}
          </div>
          <button type="button" className="undo-btn" disabled={undoStack.length === 0} onClick={handleUndo}>
            Undo{undoStack.length > 0 ? ` (${undoStack.length})` : ''}
          </button>
        </div>

        <KpiRow
          arr={kpis.arr} arrGrowthYoY={kpis.arrGrowthYoY} arrSpark={kpis.arrSpark}
          nrr={kpis.nrr} nrrDeltaPp={kpis.nrrDeltaPp} nrrSpark={kpis.nrrSpark}
          churn={kpis.churn} churnDeltaPp={kpis.churnDeltaPp} churnSpark={kpis.churnSpark}
          cac={kpis.cac} cacGrowthQoQ={kpis.cacGrowthQoQ} cacSpark={kpis.cacSpark}
        />

        <div className="grid">
          <div className="stack stack-left">
            <ArrBridgePanel
              points={bridgePoints}
              colors={{ ...PALETTE, brand: BRAND }}
              knobs={{
                positiveColor: swatchHex(chartState.arr_bridge.positiveColor),
                negativeColor: swatchHex(chartState.arr_bridge.negativeColor),
                barWidth: chartState.arr_bridge.barWidth,
              }}
            />
            <RetentionPanel
              nrrMonths={nrrLabels} nrrSeries={nrrSeries}
              churnMonths={churnLabels} churnSeries={churnSeries}
              nrrColor={swatchHex(chartState.retention_nrr.lineColor)}
              churnColor={swatchHex(chartState.retention_churn.lineColor)}
              gridline={PALETTE.gridline}
            />
          </div>

          <div className="stack">
            <div className="card">
              <p className="panel-title">ARR mix</p>
              <p className="panel-sub">By segment — click a segment to filter</p>
              <ArrMixDonut segments={mixSegments} activeSegment={filters.segment} onToggle={handleToggleSegment} />
            </div>

            <div className="card">
              <p className="panel-title">Top accounts</p>
              <p className="panel-sub">By current ARR — click an account to filter</p>
              <TopAccounts accounts={accounts} activeAccount={filters.accountName} onToggle={handleToggleAccount} />
            </div>

            <div className="card">
              <p className="panel-title">Net new logos</p>
              <p className="panel-sub">By region, last 6 months — click a region to filter</p>
              <NewLogosHeatmap months={last6Labels} byRegion={heatmap} activeRegion={filters.region} onToggle={handleToggleRegion} />
            </div>
          </div>
        </div>

        <ActivityLog entries={log} />

        <footer className="note">Illustrative data for a fictional company — for direction review only.</footer>
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<NorthbeamData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadNorthbeamData().then(setData).catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="northbeam"><div className="error">Failed to load data: {error}</div></div>;
  if (!data) return <div className="northbeam"><div className="loading">Loading Northbeam data…</div></div>;
  return <Dashboard data={data} />;
}
