import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Department, UsageData } from '../lib/types';
import {
  activityGrid, computeUsageKpis, engagementDistribution, HOUR_BUCKETS, monthlyViewTotals, topReports, viewsByOwnerTeam,
} from '../lib/usageMetrics';
import { monthLabel } from '../lib/metrics';
import {
  defaultUsageDashboardState, findUsageValue, scopeUsageData,
  usageMonthList, usageReportOptions, USAGE_REPORT_ID, USAGE_SCHEMA_VERSION, validateUsageFilterPatch,
  type UsageDashboardState, type UsageFilters as UsageFiltersState,
} from '../lib/usageFilters';
import { loadUsageDashboardSnapshot, subscribeUsageDashboardState } from '../lib/usageSharedState';
import { registerUsageTools } from '../lib/registerUsageWebMcpTools';
import { loadActivityLog, subscribeActivityLog } from '../lib/activityLog';
import { Topbar, type ReportId } from './Topbar';
import { UsageFilters } from './UsageFilters';
import { ActivityLog, type LogEntry } from './ActivityLog';
import type { RoomSession } from '../lib/roomSession';
import { createSharedRoom, mutateSharedState } from '../lib/sharedStateClient';
import { mutationBlockReason, shouldApplyVersion, type SharedStatus } from '../lib/sharedStateLifecycle';
import { addUndoFrame, invalidateUndoFrames, popUndoFrame, type UndoFrame } from '../lib/undoState';

interface Props { data: UsageData; report: ReportId; onChangeReport: (r: ReportId) => void; session: RoomSession; }

function delta(value: number, suffix: string) { return `${value >= 0 ? '+' : ''}${value.toFixed(0)}${suffix}`; }

export function UsageDashboard({ data, report, onChangeReport, session }: Props) {
  const allMonths = useMemo(() => usageMonthList(data), [data]);
  const reportOptions = useMemo(() => usageReportOptions(data), [data]);
  const validReportIds = useMemo(() => data.reports.map((r) => r.reportId), [data]);
  const defaultState = useMemo(() => defaultUsageDashboardState(data), [data]);

  const [dashboard, setDashboard] = useState<UsageDashboardState>(defaultState);
  const [version, setVersion] = useState(0);
  const [sharedStatus, setSharedStatus] = useState<SharedStatus>('connecting');
  const [sharedError, setSharedError] = useState('');
  const [undoStack, setUndoStack] = useState<UndoFrame<UsageDashboardState>[]>([]);
  const [undoNotice, setUndoNotice] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const dashboardRef = useRef(dashboard);
  dashboardRef.current = dashboard;
  const versionRef = useRef(version);
  versionRef.current = version;
  const undoStackRef = useRef(undoStack);
  undoStackRef.current = undoStack;

  const { filters } = dashboard;

  useEffect(() => {
    let active = true;
    let fetchReady = false;
    let realtimeReady = false;
    let connectionFailed = false;
    setSharedStatus('connecting');
    setSharedError('');
    const markReady = () => {
      if (active && fetchReady && realtimeReady && !connectionFailed) setSharedStatus('ready');
    };
    const applySnapshot = (state: UsageDashboardState, nextVersion: number) => {
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
    loadActivityLog(USAGE_REPORT_ID, session.roomId).then(setLog);
    const unsubState = subscribeUsageDashboardState((state, nextVersion) => {
      applySnapshot(state, nextVersion);
    }, session.roomId, (status) => {
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
    }, USAGE_REPORT_ID, session.roomId);
    void createSharedRoom(session, defaultState, USAGE_SCHEMA_VERSION, USAGE_REPORT_ID)
      .then((result) => {
        if (!active) return null;
        if (!result.ok) throw new Error(result.error);
        return loadUsageDashboardSnapshot(session.roomId, defaultState);
      })
      .then((snapshot) => {
        if (!snapshot) return;
        fetchReady = true;
        applySnapshot(snapshot.state, snapshot.version);
        markReady();
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSharedError(error instanceof Error ? error.message : 'Shared session is unavailable. Try again.');
        setSharedStatus('unavailable');
      });
    return () => { active = false; unsubState(); unsubLog(); };
  }, [session.roomId]);

  const applySharedMutation = useCallback(async (mutation: Parameters<typeof mutateSharedState<UsageDashboardState>>[2], recordUndo = true) => {
    const blockReason = mutationBlockReason(sharedStatus);
    if (blockReason) throw new Error(blockReason);
    const current = dashboardRef.current;
    const expectedVersion = versionRef.current;
    const result = await mutateSharedState<UsageDashboardState>(session, expectedVersion, mutation, USAGE_REPORT_ID);
    if (!result.ok) {
      const error = new Error(result.error);
      error.name = result.reason;
      throw error;
    }
    if (recordUndo && mutation.kind !== 'undo') {
      undoStackRef.current = addUndoFrame(undoStackRef.current, current, result.data.version, mutation);
    }
    dashboardRef.current = result.data.state;
    versionRef.current = result.data.version;
    setVersion(result.data.version);
    setUndoStack(undoStackRef.current);
    setUndoNotice('');
    setDashboard(result.data.state);
    setLog((prev) => prev.some((entry) => entry.id === result.data.activity.id) ? prev : [...prev, result.data.activity].slice(-50));
    return result.data;
  }, [session, sharedStatus]);

  const applyFilterPatch = useCallback(async (patch: Record<string, unknown>, actor: 'person' | 'agent' = 'person') => {
    const result = await applySharedMutation({ kind: 'filter_patch', patch, actor });
    return result.state.filters;
  }, [applySharedMutation]);

  useEffect(() => {
    if (sharedStatus !== 'ready') return;
    const bridge = {
      getContext: () => ({
        reportId: USAGE_REPORT_ID,
        filters: dashboardRef.current.filters,
        kpis: kpisRef.current,
        topReports: topRef.current,
        teamShares: byTeamRef.current,
        options: usageOptions(),
        activityHeatmap: 'A synthetic typical-week aggregate, not scoped by these filters — see get_usage_context.activityHeatmapNote.',
        activityHeatmapNote: 'Typical week · all usage — not filtered by ownerTeam, reportId, or asOfMonth.',
      }),
      getOptions: () => usageOptions(),
      getFilters: () => dashboardRef.current.filters,
      applyFilterPatch: (patch: Record<string, unknown>) => applyFilterPatch(patch, 'agent'),
      getValidReportIds: () => validReportIds,
      getValidMonths: () => allMonths,
      findValues: (phrase: string) => findUsageValue(phrase, data),
    };
    return registerUsageTools(bridge);

    function usageOptions() {
      return {
        ownerTeam: ['all', ...new Set(data.reports.map((r) => r.ownerTeam))],
        reportId: ['all', ...reportOptions.map((r) => ({ id: r.reportId, name: r.name }))],
        asOfMonth: allMonths,
        clickActions: ['toggle ownerTeam by clicking a team row', 'toggle reportId by clicking a ranked report row'],
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFilterPatch, sharedStatus, data, allMonths, reportOptions, validReportIds]);

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

  const handleFilterChange = useCallback((patch: Partial<UsageFiltersState>) => {
    const validation = validateUsageFilterPatch(patch, validReportIds, allMonths);
    if (!validation.ok) return;
    void applyFilterPatch(patch).catch(() => {});
  }, [applyFilterPatch, validReportIds, allMonths]);

  const handleToggleTeam = useCallback((team: Department) => {
    const next = dashboardRef.current.filters.ownerTeam === team ? 'all' : team;
    void applyFilterPatch({ ownerTeam: next }).catch(() => {});
  }, [applyFilterPatch]);

  const handleToggleReport = useCallback((reportId: string) => {
    const next = dashboardRef.current.filters.reportId === reportId ? 'all' : reportId;
    void applyFilterPatch({ reportId: next }).catch(() => {});
  }, [applyFilterPatch]);

  const scoped = useMemo(() => scopeUsageData(data, filters), [data, filters]);
  const kpis = useMemo(() => computeUsageKpis(scoped, allMonths, filters.asOfMonth), [scoped, allMonths, filters.asOfMonth]);
  const top = useMemo(() => topReports(scoped, kpis.latest, 5), [scoped, kpis.latest]);
  const distribution = useMemo(() => engagementDistribution(scoped, kpis.latest), [scoped, kpis.latest]);
  const activity = useMemo(() => activityGrid(data), [data]); // global typical-week aggregate — deliberately unfiltered
  const byTeam = useMemo(() => viewsByOwnerTeam(scoped, kpis.latest).sort((a, b) => b.views - a.views), [scoped, kpis.latest]);
  const momentum = useMemo(() => monthlyViewTotals(scoped), [scoped]);
  const kpisRef = useRef(kpis); kpisRef.current = kpis;
  const topRef = useRef(top); topRef.current = top;
  const byTeamRef = useRef(byTeam); byTeamRef.current = byTeam;

  const activityMax = Math.max(...activity.flatMap((row) => row.values), 1);
  const teamTotal = byTeam.reduce((sum, team) => sum + team.views, 0) || 1;
  const maxTop = top[0]?.value || 1;
  const maxBin = Math.max(...distribution.map((bin) => bin.count), 1);
  const chart = useMemo(() => {
    const width = 640, height = 190, pad = 28;
    if (momentum.length === 0) return null;
    const values = momentum.map((point) => point.views);
    const min = Math.min(...values), max = Math.max(...values);
    const x = (index: number) => pad + index * (width - pad * 2) / Math.max(values.length - 1, 1);
    const y = (value: number) => height - pad - ((value - min) / Math.max(max - min, 1)) * (height - pad * 2);
    return { width, height, pad, points: values.map((value, index) => `${x(index)},${y(value)}`).join(' '), x, y, last: values.at(-1) ?? 0 };
  }, [momentum]);

  if (sharedStatus !== 'ready') {
    return (
      <div className="northbeam usage-os" data-report={report}>
        <div className="shell"><Topbar report={report} onChangeReport={onChangeReport} />
          <div className="shared-status-card card" data-shared-status={sharedStatus}>
            <p className="panel-title">Shared session {sharedStatus === 'connecting' ? 'connecting…' : 'unavailable'}</p>
            <p className="panel-sub">{sharedStatus === 'connecting' ? 'Loading the authoritative room state.' : sharedError || 'The room could not be reached. No local fallback is being shown.'}</p>
          </div>
        </div>
      </div>
    );
  }

  return <div className="northbeam usage-os" data-report={report}><div className="shell">
    <Topbar report={report} onChangeReport={onChangeReport} />
    <div className="shared-status" aria-label="Shared session status">Live shared session · v{version}</div>
    <div className="toolbar-row">
      <div className="filters-wrap">
        <UsageFilters filters={filters} reportOptions={reportOptions} monthOptions={allMonths} onChange={handleFilterChange} />
        {filters.ownerTeam !== 'all' && (
          <button type="button" className="pill-select active account-chip" onClick={() => handleToggleTeam(filters.ownerTeam as Department)}>
            {filters.ownerTeam} ×
          </button>
        )}
        {filters.reportId !== 'all' && (
          <button type="button" className="pill-select active account-chip" onClick={() => handleToggleReport(filters.reportId)}>
            {reportOptions.find((r) => r.reportId === filters.reportId)?.name ?? filters.reportId} ×
          </button>
        )}
      </div>
      <button type="button" className="undo-btn" disabled={undoStack.length === 0} onClick={handleUndo}>
        Undo{undoStack.length > 0 ? ` (${undoStack.length})` : ''}
      </button>
      {undoNotice && <span className="undo-notice" role="status">{undoNotice}</span>}
    </div>

    <header className="usage-head"><div><p className="usage-kicker">Product intelligence / Activity OS</p><h1>Usage at a glance</h1><p>Find where the product is alive, quiet, or losing momentum.</p></div><div className="usage-period"><strong>As of {monthLabel(kpis.latest)}</strong>{kpis.activeReports} active reports</div></header>
    <div className="usage-pulse" aria-label="Product usage pulse">
      <div><span>Report views</span><strong>{kpis.views.toLocaleString()} <em>{delta(kpis.viewsDeltaPct, '%')}</em></strong></div>
      <div><span>Unique viewers</span><strong>{kpis.uniqueViewers.toLocaleString()} <em>{delta(kpis.uniqueViewersDeltaPct, '%')}</em></strong></div>
      <div><span>Average engagement</span><strong>{kpis.engagement.toFixed(0)} <em>{delta(kpis.engagementDeltaPp, 'pt')}</em></strong></div>
    </div>
    <div className="usage-grid"><div className="usage-left">
      <section className="usage-panel usage-heatmap-panel"><h2>When the workspace is active</h2><p>Typical week · all usage — views by weekday and hour of day, not scoped by the filters above.</p>
        <div className="usage-heatmap"><span />{HOUR_BUCKETS.map((hour) => <span key={hour}>{hour}</span>)}{activity.flatMap((row) => [<span className="usage-day" key={`${row.label}-label`}>{row.label}</span>, ...row.values.map((value, index) => <span className="usage-cell" key={`${row.label}-${HOUR_BUCKETS[index]}`} style={{ '--heat': `${18 + value / activityMax * 78}%` } as CSSProperties} aria-label={`${row.label} ${HOUR_BUCKETS[index]}: ${value} views`}>{value}</span>)])}</div>
        <div className="usage-legend"><span>Quiet</span><i /><span>Busy</span></div>
      </section>
      <section className="usage-panel usage-momentum"><h2>Usage momentum</h2><p>Monthly report views through {monthLabel(kpis.latest)}, for the current selection.</p>
        {chart === null ? <p className="usage-empty">No usage for this selection.</p> : (
          <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`Monthly views ending at ${chart.last.toLocaleString()}`}><line x1={chart.pad} y1={chart.height - chart.pad} x2={chart.width - chart.pad} y2={chart.height - chart.pad} /><polyline points={chart.points} /><circle cx={chart.x(momentum.length - 1)} cy={chart.y(chart.last)} r="4" /><text x={chart.pad} y={chart.height - 7}>{monthLabel(momentum[0]?.month ?? '')}</text><text x={chart.width - chart.pad} y={chart.height - 7} textAnchor="end">{monthLabel(kpis.latest)}</text><text className="usage-last-value" x={chart.width - chart.pad} y={chart.y(chart.last) - 11} textAnchor="end">{chart.last.toLocaleString()}</text></svg>
        )}
      </section>
    </div><aside className="usage-right">
      <section className="usage-panel"><h2>Reports drawing attention</h2><p>Most viewed as of {monthLabel(kpis.latest)} — click a report to filter.</p>
        {top.length === 0 ? <p className="usage-empty">No usage for this selection.</p> : (
          <div className="usage-ranks">{top.map((item) => (
            <button type="button" key={item.reportId} className={`usage-rank-row ${filters.reportId === item.reportId ? 'active' : ''}`} onClick={() => handleToggleReport(item.reportId)}>
              <span>{item.label}</span><strong>{item.value}</strong><i><b style={{ width: `${item.value / maxTop * 100}%` }} /></i>
            </button>
          ))}</div>
        )}
      </section>
      <section className="usage-panel"><h2>Where usage comes from</h2><p>Share of views by owning team as of {monthLabel(kpis.latest)} — click a team to filter.</p>
        {byTeam.length === 0 ? <p className="usage-empty">No usage for this selection.</p> : (
          <div className="usage-teams">{byTeam.map((team) => (
            <button type="button" key={team.team} className={`usage-team-row ${filters.ownerTeam === team.team ? 'active' : ''}`} onClick={() => handleToggleTeam(team.team)}>
              <span>{team.team}</span><i><b style={{ width: `${team.views / teamTotal * 100}%` }} /></i><em>{Math.round(team.views / teamTotal * 100)}%</em>
            </button>
          ))}</div>
        )}
      </section>
      <section className="usage-panel usage-distribution"><h2>Engagement spread</h2><p>Reports by score band as of {monthLabel(kpis.latest)}.</p><div>{distribution.map((bin) => <div key={bin.label}><i><b style={{ height: `${bin.count / maxBin * 100}%` }} /></i><strong>{bin.count}</strong><span>{bin.label}</span></div>)}</div></section>
    </aside></div>

    <ActivityLog entries={log} />
  </div></div>;
}
