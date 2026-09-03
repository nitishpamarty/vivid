import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { loadNorthbeamData, loadUsageData } from './lib/loadData';
import type { AcquisitionChannel, NorthbeamData, Region, UsageData } from './lib/types';
import {
  arrBridge, arrMixByChannel, computeKpis, logoChurnPct, monthLabel, monthList,
  netNewLogosByRegion, nrrTrailing12, topAccounts,
} from './lib/metrics';
import { PALETTE, BRAND } from './lib/palette';
import {
  decodeDashboardState, type ChartId, type DashboardState, DEFAULT_DASHBOARD_STATE,
  DASHBOARD_SCHEMA_VERSION, loadDashboardSnapshot, subscribeDashboardState, swatchHex,
} from './lib/chartState';
import type { ReportChartContract, ReportChartId } from './lib/reportChartContract';
import { applyReportFilters, type ReportFilters } from './lib/reportFilters';
import { toggleArrMixChannel } from './lib/arrMixPresentation';
import { toggleTopAccount } from './lib/topAccountsPresentation';
import { toggleNetNewLogosRegion } from './lib/netNewLogosPresentation';
import { registerNorthbeamTools } from './lib/registerWebMcpTools';
import { registerSemanticWebMcpTools } from './lib/registerSemanticWebMcpTools';
import { getBusinessDefinitions, queryBusinessMetric } from './lib/semanticLayerClient';
import { loadActivityLog, subscribeActivityLog } from './lib/activityLog';
import { Topbar, type ReportId } from './components/Topbar';
import { Filters } from './components/Filters';
import { KpiRow } from './components/KpiRow';
import { ArrBridgePanel } from './components/ArrBridgePanel';
import { RetentionPanel } from './components/RetentionPanel';
import { ArrMixDonut } from './components/ArrMixDonut';
import { TopAccounts } from './components/TopAccounts';
import { NewLogosHeatmap } from './components/NewLogosHeatmap';
import { ActivityLog, type LogEntry } from './components/ActivityLog';
import { UsageDashboard } from './components/UsageDashboard';
import { buildRoomUrl, createRoomSession, parseRoomSession, type RoomSession } from './lib/roomSession';
import { createSharedRoom, mutateSharedState } from './lib/sharedStateClient';
import { mutationBlockReason, shouldApplyVersion, type SharedStatus } from './lib/sharedStateLifecycle';
import { addUndoFrame, invalidateUndoFrames, popUndoFrame, type UndoFrame } from './lib/undoState';

function RevenueDashboard({ data, report, onChangeReport, session }: { data: NorthbeamData; report: ReportId; onChangeReport: (r: ReportId) => void; session: RoomSession }) {
  // Calendar axis stays derived from the unfiltered data so windowing
  // (arrBridge/retention slice(-N)) is stable regardless of active filters —
  // only the rows feeding each metric are filtered, never the month list.
  const months = useMemo(() => monthList(data), [data]);
  const latest = months[months.length - 1];

  const [dashboard, setDashboard] = useState<DashboardState>(DEFAULT_DASHBOARD_STATE);
  const [version, setVersion] = useState(0);
  const [sharedStatus, setSharedStatus] = useState<SharedStatus>('connecting');
  const [undoStack, setUndoStack] = useState<UndoFrame<DashboardState>[]>([]);
  const [undoNotice, setUndoNotice] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const dashboardRef = useRef(dashboard);
  dashboardRef.current = dashboard;
  const versionRef = useRef(version);
  versionRef.current = version;
  const undoStackRef = useRef(undoStack);
  undoStackRef.current = undoStack;

  const { charts: chartState, filters, chartContracts } = dashboard;

  // Subscribe before fetching. A newer Realtime event must not be overwritten
  // by the initial fetch that was already in flight.
  useEffect(() => {
    let active = true;
    let fetchReady = false;
    let realtimeReady = false;
    let connectionFailed = false;
    setSharedStatus('connecting');
    const markReady = () => {
      if (active && fetchReady && realtimeReady && !connectionFailed) setSharedStatus('ready');
    };
    const applySnapshot = (state: DashboardState, nextVersion: number) => {
      if (!active || !shouldApplyVersion(versionRef.current, nextVersion)) return;
      if (nextVersion > versionRef.current) {
        const remaining = invalidateUndoFrames(undoStackRef.current, nextVersion);
        if (remaining.length !== undoStackRef.current.length) setUndoNotice('Dashboard changed elsewhere; Undo history cleared.');
        undoStackRef.current = remaining;
        setUndoStack(remaining);
      }
      versionRef.current = nextVersion;
      dashboardRef.current = state;
      setVersion(nextVersion);
      setDashboard(state);
      markReady();
    };
    loadActivityLog('northbeam', session.roomId).then(setLog);
    const unsubState = subscribeDashboardState((state, nextVersion) => {
      applySnapshot(state, nextVersion);
    }, 'northbeam', session.roomId, (status) => {
      if (!active) return;
      if (status === 'unavailable') {
        connectionFailed = true;
        setSharedStatus('unavailable');
      } else {
        realtimeReady = true;
        markReady();
      }
    });
    const unsubLog = subscribeActivityLog((entry) => {
      setLog((prev) => (prev.some((e) => e.id === entry.id) ? prev : [...prev, entry].slice(-50)));
    }, 'northbeam', session.roomId);
    void createSharedRoom<DashboardState>(session, DEFAULT_DASHBOARD_STATE, DASHBOARD_SCHEMA_VERSION)
      .then((result) => {
        if (!active || !result.ok) throw new Error('unavailable');
        return loadDashboardSnapshot('northbeam', session.roomId);
      })
      .then((snapshot) => {
        fetchReady = true;
        applySnapshot(snapshot.state, snapshot.version);
        markReady();
      })
      .catch(() => { if (active) setSharedStatus('unavailable'); });
    return () => { active = false; unsubState(); unsubLog(); };
  }, [session.roomId]);

  // The server accepts the mutation only when this version is still current.
  const applySharedMutation = useCallback(async (mutation: Parameters<typeof mutateSharedState>[2], recordUndo = true) => {
    const blockReason = mutationBlockReason(sharedStatus);
    if (blockReason) throw new Error(blockReason);
    const current = dashboardRef.current;
    const expectedVersion = versionRef.current;
    const result = await mutateSharedState<DashboardState>(session, expectedVersion, mutation);
    if (!result.ok) {
      const error = new Error(result.error);
      error.name = result.reason;
      throw error;
    }
    const rawState = result.data.state as unknown;
    const hasContracts = typeof rawState === 'object' && rawState !== null && !Array.isArray(rawState) && 'chartContracts' in rawState;
    const decoded = decodeDashboardState(rawState, hasContracts ? DASHBOARD_SCHEMA_VERSION : 4);
    if (!decoded.ok) throw new Error('Shared dashboard state is unavailable.');
    const data = { ...result.data, state: decoded.data };
    if (recordUndo && mutation.kind !== 'undo') {
      undoStackRef.current = addUndoFrame(undoStackRef.current, current, data.version, mutation);
    }
    dashboardRef.current = data.state;
    versionRef.current = data.version;
    setVersion(data.version);
    setUndoStack(undoStackRef.current);
    setUndoNotice('');
    setDashboard(data.state);
    setLog((prev) => prev.some((entry) => entry.id === data.activity.id) ? prev : [...prev, data.activity].slice(-50));
    return data;
  }, [session, sharedStatus]);

  const applyChartPatch = useCallback(async (chartId: ChartId, patch: Record<string, unknown>, actor: 'person' | 'agent' = 'person') => {
    const result = await applySharedMutation({ kind: 'chart_patch', chartId, patch, actor });
    return result.state.charts[chartId];
  }, [applySharedMutation]);

  const applyFilterPatch = useCallback(async (patch: Record<string, unknown>, actor: 'person' | 'agent' = 'person') => {
    const result = await applySharedMutation({ kind: 'filter_patch', patch, actor });
    return result.state.filters;
  }, [applySharedMutation]);

  const applyChartContract = useCallback(async (chartId: ReportChartId, contract: ReportChartContract, actor: 'person' | 'agent' = 'person') => {
    const result = await applySharedMutation({ kind: 'chart_contract', chartId, contract, actor });
    return result.state.chartContracts[chartId];
  }, [applySharedMutation]);

  useEffect(() => {
    if (sharedStatus !== 'ready') return;
    const bridge = {
      getChartState: () => dashboardRef.current.charts,
      applyChartPatch: (chartId: ChartId, patch: Record<string, unknown>) => applyChartPatch(chartId, patch, 'agent'),
      getFilters: () => dashboardRef.current.filters,
      applyFilterPatch: (patch: Record<string, unknown>) => applyFilterPatch(patch, 'agent'),
      getChartContracts: () => dashboardRef.current.chartContracts,
      applyChartContract: (chartId: ReportChartId, contract: ReportChartContract) => applyChartContract(chartId, contract, 'agent'),
      getTopAccounts: () => accountsRef.current,
      getAccountMatches: (query: string) => accountDirectoryRef.current
        .filter((account) => account.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8),
      getValidAccountNames: () => data.customers.map((c) => c.name),
    };
    const semanticBridge = { getBusinessDefinitions, queryBusinessMetric };
    const registerAll = () => {
      const unregisterChart = registerNorthbeamTools(bridge);
      const unregisterSemantic = registerSemanticWebMcpTools(semanticBridge);
      return () => { unregisterChart(); unregisterSemantic(); };
    };
    // A real WebMCP browser injects document.modelContext at document_start, before this
    // effect runs. This re-entry point exists only so evidence/README.md's manual loop can
    // be driven from devtools in a browser that doesn't have that extension.
    (window as unknown as { __vividRegisterTools?: () => () => void }).__vividRegisterTools = registerAll;
    return registerAll();
  }, [applyChartContract, applyChartPatch, applyFilterPatch, sharedStatus]);

  const handleUndo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const frame = stack[stack.length - 1];
    if (frame.resultingVersion !== versionRef.current) {
      undoStackRef.current = [];
      setUndoStack([]);
      setUndoNotice('Dashboard changed elsewhere; Undo was cleared.');
      return;
    }
    void applySharedMutation({ kind: 'undo', actor: 'person', restoreState: frame.state as unknown as Record<string, unknown>, undoOfVersion: frame.resultingVersion }, false)
      .then(() => {
        undoStackRef.current = popUndoFrame(undoStackRef.current);
        setUndoStack(undoStackRef.current);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'conflict') {
          undoStackRef.current = [];
          setUndoStack([]);
          setUndoNotice('Dashboard changed elsewhere; Undo was rejected.');
        }
      });
  }, [applySharedMutation]);

  const handleFilterChange = useCallback((patch: Partial<ReportFilters>) => {
    void applyFilterPatch(patch).catch(() => {});
  }, [applyFilterPatch]);

  const handleToggleChannel = useCallback((channel: AcquisitionChannel) => {
    const next = toggleArrMixChannel(dashboardRef.current.filters.channel, channel);
    void applyFilterPatch({ channel: next }).catch(() => {});
  }, [applyFilterPatch]);

  const handleToggleRegion = useCallback((region: Region) => {
    const next = toggleNetNewLogosRegion(dashboardRef.current.filters.region, region);
    void applyFilterPatch({ region: next }).catch(() => {});
  }, [applyFilterPatch]);

  const handleToggleAccount = useCallback((name: string) => {
    const next = toggleTopAccount(dashboardRef.current.filters.accountName, name);
    void applyFilterPatch({ accountName: next }).catch(() => {});
  }, [applyFilterPatch]);

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
  const mixChannels: { label: string; channel: AcquisitionChannel; arr: number; pct: number; color: string }[] = [
    { label: 'Paid', channel: 'Paid', arr: mix.Paid, pct: (mix.Paid / mixTotal) * 100, color: PALETTE.cat1 },
    { label: 'Organic', channel: 'Organic', arr: mix.Organic, pct: (mix.Organic / mixTotal) * 100, color: PALETTE.cat2 },
    { label: 'Referral', channel: 'Referral', arr: mix.Referral, pct: (mix.Referral / mixTotal) * 100, color: PALETTE.cat3 },
    { label: 'Partner', channel: 'Partner', arr: mix.Partner, pct: (mix.Partner / mixTotal) * 100, color: PALETTE.cat4 },
  ];

  const accounts = topAccounts(accountPickerData, latest, 5);
  // The tool bridge is only re-registered when the mutation handlers change —
  // accounts changes every render, so
  // getTopAccounts must read it through a ref, not close over the value.
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const accountDirectory = useMemo(() => {
    const currentArr = new Map(
      data.mrrRows.filter((row) => row.month === latest).map((row) => [row.customerId, row.mrr * 12]),
    );
    return data.customers.map((customer) => ({ name: customer.name, arr: currentArr.get(customer.customerId) ?? 0 }));
  }, [data, latest]);
  const accountDirectoryRef = useRef(accountDirectory);
  accountDirectoryRef.current = accountDirectory;

  const last6 = months.slice(-6);
  const last6Labels = last6.map(monthLabel);
  const heatmap = netNewLogosByRegion(filteredData, last6);

  if (sharedStatus !== 'ready') {
    return (
      <div className="northbeam" data-report={report}>
        <div className="shell"><Topbar report={report} onChangeReport={onChangeReport} />
          <div className="shared-status-card card" data-shared-status={sharedStatus}>
            <p className="panel-title">Shared session {sharedStatus === 'connecting' ? 'connecting…' : 'unavailable'}</p>
            <p className="panel-sub">{sharedStatus === 'connecting' ? 'Loading the authoritative room state.' : 'The room could not be reached. No local fallback is being shown.'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="northbeam" data-report={report}>
      <div className="shell">
        <Topbar report={report} onChangeReport={onChangeReport} />
        <div className="shared-status" aria-label="Shared session status">Live shared session · v{version}</div>
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
          {undoNotice && <span className="undo-notice" role="status">{undoNotice}</span>}
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
              <ArrMixDonut
                channels={mixChannels}
                activeChannel={filters.channel}
                onToggle={handleToggleChannel}
                presentation={chartContracts.arr_mix.presentation}
              />
            </div>

            <div className="card">
              <p className="panel-title">Top accounts</p>
              <p className="panel-sub">By current ARR — click an account to filter</p>
              <TopAccounts
                accounts={accounts}
                activeAccount={filters.accountName}
                onToggle={handleToggleAccount}
                presentation={chartContracts.top_accounts.presentation}
              />
            </div>

            <div className="card">
              <p className="panel-title">Net new logos</p>
              <p className="panel-sub">By region, last 6 months — click a region to filter</p>
              <NewLogosHeatmap
                months={last6Labels}
                byRegion={heatmap}
                activeRegion={filters.region}
                onToggle={handleToggleRegion}
                presentation={chartContracts.net_new_logos.presentation}
              />
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
  const [session, setSession] = useState<RoomSession | null>(() => parseRoomSession(window.location.href));
  const [data, setData] = useState<{ revenue: NorthbeamData; usage: UsageData } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    Promise.all([loadNorthbeamData(), loadUsageData()])
      .then(([revenue, usage]) => setData({ revenue, usage }))
      .catch((e) => setError(String(e)));
  }, [session]);

  if (!session) {
    return (
      <div className="northbeam session-landing">
        <div className="landing-card card">
          <div className="brand"><div className="mark" aria-hidden="true">V</div><div><div className="name">Vivid</div><div className="sub">Shared analytics workspace</div></div></div>
          <h1>Start a live dashboard session</h1>
          <p>This demo uses a private link for each session. Start one, then share this browser URL with your viewer.</p>
          <button type="button" className="start-session-btn" onClick={() => {
            const next = createRoomSession();
            window.history.replaceState(null, '', buildRoomUrl(window.location.href, next));
            setSession(next);
          }}>Start live session</button>
          <p className="landing-note">No login. Anyone with the link can edit this fictional dashboard.</p>
        </div>
      </div>
    );
  }

  if (error) return <div className="northbeam"><div className="error">Failed to load data: {error}</div></div>;
  if (!data) return <div className="northbeam"><div className="loading">Loading Northbeam data…</div></div>;

  if (report === 'usage') return <UsageDashboard data={data.usage} report={report} onChangeReport={setReport} session={session} />;
  return <RevenueDashboard data={data.revenue} report={report} onChangeReport={setReport} session={session} />;
}
