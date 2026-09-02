import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { loadNorthbeamData, loadPeopleData, loadUsageData } from './lib/loadData';
import type { AcquisitionChannel, NorthbeamData, PeopleData, Region, UsageData } from './lib/types';
import {
  arrBridge, arrMixByChannel, computeKpis, logoChurnPct, monthLabel, monthList,
  netNewLogosByRegion, nrrTrailing12, topAccounts,
} from './lib/metrics';
import { PALETTE, BRAND } from './lib/palette';
import {
  type ChartId, type DashboardState, DEFAULT_DASHBOARD_STATE,
  loadDashboardState, saveDashboardState, subscribeDashboardState, swatchHex,
} from './lib/chartState';
import { applyReportFilters, type ReportFilters } from './lib/reportFilters';
import { registerNorthbeamTools } from './lib/registerWebMcpTools';
import { insertActivityLog, loadActivityLog, subscribeActivityLog } from './lib/activityLog';
import { Topbar, type ReportId } from './components/Topbar';
import { Filters } from './components/Filters';
import { KpiRow } from './components/KpiRow';
import { ArrBridgePanel } from './components/ArrBridgePanel';
import { RetentionPanel } from './components/RetentionPanel';
import { ArrMixDonut } from './components/ArrMixDonut';
import { TopAccounts } from './components/TopAccounts';
import { NewLogosHeatmap } from './components/NewLogosHeatmap';
import { ActivityLog, type LogEntry } from './components/ActivityLog';
import { PeopleDashboard } from './components/PeopleDashboard';
import { UsageDashboard } from './components/UsageDashboard';

function RevenueDashboard({ data, report, onChangeReport }: { data: NorthbeamData; report: ReportId; onChangeReport: (r: ReportId) => void }) {
  // Calendar axis stays derived from the unfiltered data so windowing
  // (arrBridge/retention slice(-N)) is stable regardless of active filters —
  // only the rows feeding each metric are filtered, never the month list.
  const months = useMemo(() => monthList(data), [data]);
  const latest = months[months.length - 1];

  const [dashboard, setDashboard] = useState<DashboardState>(DEFAULT_DASHBOARD_STATE);
  const [undoStack, setUndoStack] = useState<DashboardState[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const dashboardRef = useRef(dashboard);
  dashboardRef.current = dashboard;
  const undoStackRef = useRef(undoStack);
  undoStackRef.current = undoStack;

  const { charts: chartState, filters } = dashboard;

  // Hydrate from Supabase on mount, then stay synced: another viewer's edit
  // (or the agent, from a different tab) arrives here the same way this
  // tab's own writes echo back — see subscribeDashboardState's doc comment.
  useEffect(() => {
    loadDashboardState().then((state) => {
      dashboardRef.current = state;
      setDashboard(state);
    });
    loadActivityLog().then(setLog);
    const unsubState = subscribeDashboardState((state) => {
      dashboardRef.current = state;
      setDashboard(state);
    });
    const unsubLog = subscribeActivityLog((entry) => {
      setLog((prev) => (prev.some((e) => e.id === entry.id) ? prev : [...prev, entry].slice(-50)));
    });
    return () => { unsubState(); unsubLog(); };
  }, []);

  const addLog = useCallback((actor: LogEntry['actor'], message: string) => {
    insertActivityLog(actor, message);
  }, []);

  // Tool calls (and clicks) can arrive back-to-back with no render committed
  // in between, so dashboardRef/undoStackRef are written here synchronously —
  // they're the source of truth these read from, not whatever the last render saw.
  const applyChartPatch = useCallback((chartId: ChartId, patch: Record<string, unknown>, actor: 'person' | 'agent' = 'person') => {
    const current = dashboardRef.current;
    const next = { ...current, charts: { ...current.charts, [chartId]: { ...current.charts[chartId], ...patch } } };
    undoStackRef.current = [...undoStackRef.current, current].slice(-10);
    dashboardRef.current = next;
    setUndoStack(undoStackRef.current);
    setDashboard(next);
    saveDashboardState(next, actor);
    return next.charts[chartId];
  }, []);

  const applyFilterPatch = useCallback((patch: Record<string, unknown>, actor: 'person' | 'agent' = 'person') => {
    const current = dashboardRef.current;
    const next = { ...current, filters: { ...current.filters, ...patch } };
    undoStackRef.current = [...undoStackRef.current, current].slice(-10);
    dashboardRef.current = next;
    setUndoStack(undoStackRef.current);
    setDashboard(next);
    saveDashboardState(next, actor);
    return next.filters;
  }, []);

  useEffect(() => {
    const bridge = {
      getChartState: () => dashboardRef.current.charts,
      applyChartPatch: (chartId: ChartId, patch: Record<string, unknown>) => applyChartPatch(chartId, patch, 'agent'),
      getFilters: () => dashboardRef.current.filters,
      applyFilterPatch: (patch: Record<string, unknown>) => applyFilterPatch(patch, 'agent'),
      getTopAccounts: () => accountsRef.current,
      getValidAccountNames: () => data.customers.map((c) => c.name),
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
    saveDashboardState(restored, 'person');
    addLog('person', 'undid last edit');
  }, [addLog]);

  const handleFilterChange = useCallback((patch: Partial<ReportFilters>) => {
    applyFilterPatch(patch);
    const [[key, value]] = Object.entries(patch);
    addLog('person', `set ${key} filter to ${value}`);
  }, [applyFilterPatch, addLog]);

  const handleToggleChannel = useCallback((channel: AcquisitionChannel) => {
    const next = dashboardRef.current.filters.channel === channel ? 'all' : channel;
    applyFilterPatch({ channel: next });
    addLog('person', next === 'all' ? 'cleared channel filter (clicked ARR mix)' : `set channel filter to ${next} (clicked ARR mix)`);
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
    [data, filters.segment, filters.region, filters.planTier, filters.channel, filters.contractType],
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

  const mix = arrMixByChannel(filteredData, latest);
  const mixTotal = mix.Paid + mix.Organic + mix.Referral + mix.Partner || 1; // a narrow filter combo can genuinely zero this out
  const mixChannels: { label: string; channel: AcquisitionChannel; pct: number; color: string }[] = [
    { label: 'Paid', channel: 'Paid', pct: (mix.Paid / mixTotal) * 100, color: PALETTE.cat1 },
    { label: 'Organic', channel: 'Organic', pct: (mix.Organic / mixTotal) * 100, color: PALETTE.cat2 },
    { label: 'Referral', channel: 'Referral', pct: (mix.Referral / mixTotal) * 100, color: PALETTE.cat3 },
    { label: 'Partner', channel: 'Partner', pct: (mix.Partner / mixTotal) * 100, color: PALETTE.cat4 },
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
    <div className="northbeam" data-report={report}>
      <div className="shell">
        <Topbar report={report} onChangeReport={onChangeReport} />
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
              <p className="panel-sub">By acquisition channel — click a channel to filter</p>
              <ArrMixDonut channels={mixChannels} activeChannel={filters.channel} onToggle={handleToggleChannel} />
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
  const [report, setReport] = useState<ReportId>('revenue');
  const [data, setData] = useState<{ revenue: NorthbeamData; people: PeopleData; usage: UsageData } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadNorthbeamData(), loadPeopleData(), loadUsageData()])
      .then(([revenue, people, usage]) => setData({ revenue, people, usage }))
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="northbeam"><div className="error">Failed to load data: {error}</div></div>;
  if (!data) return <div className="northbeam"><div className="loading">Loading Northbeam data…</div></div>;

  if (report === 'people') return <PeopleDashboard data={data.people} report={report} onChangeReport={setReport} />;
  if (report === 'usage') return <UsageDashboard data={data.usage} report={report} onChangeReport={setReport} />;
  return <RevenueDashboard data={data.revenue} report={report} onChangeReport={setReport} />;
}
