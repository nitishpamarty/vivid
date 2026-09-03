// Report-agnostic wire protocol for the shared-state Edge Function/RPC.
// `TState` is `DashboardState` for Revenue (`northbeam`) or
// `UsageDashboardState` for Product Usage — the protocol itself only cares
// about the envelope shape, never the report-specific state contents.

export type SharedMutation =
  | { kind: 'chart_patch'; chartId: string; patch: Record<string, unknown>; actor: 'person' | 'agent' }
  | { kind: 'filter_patch'; patch: Record<string, unknown>; actor: 'person' | 'agent' }
  | { kind: 'undo'; actor: 'person'; restoreState: Record<string, unknown>; undoOfVersion: number };

export interface SharedActivity {
  id: number;
  actor: 'person' | 'agent';
  message: string;
  ts: string;
}

export interface SharedMutationSuccess<TState> {
  ok: true;
  data: { state: TState; version: number; activity: SharedActivity };
}

export interface SharedMutationFailure {
  ok: false;
  reason: string;
  error: string;
  currentVersion?: number;
}

export type SharedMutationResult<TState> = SharedMutationSuccess<TState> | SharedMutationFailure;

export function parseSharedMutationResult<TState>(value: unknown): SharedMutationResult<TState> {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'invalid_response', error: 'Shared-state service returned no result.' };
  const result = value as Record<string, unknown>;
  if (result.ok === false && typeof result.reason === 'string' && typeof result.error === 'string') {
    return { ok: false, reason: result.reason, error: result.error, ...(typeof result.currentVersion === 'number' ? { currentVersion: result.currentVersion } : {}) };
  }
  const data = result.data as Record<string, unknown> | undefined;
  const activity = data?.activity as Record<string, unknown> | undefined;
  if (result.ok === true && data?.state && typeof data.version === 'number' && activity && typeof activity.id === 'number' &&
      (activity.actor === 'person' || activity.actor === 'agent') && typeof activity.message === 'string' && typeof activity.ts === 'string') {
    return { ok: true, data: { state: data.state as TState, version: data.version, activity: activity as unknown as SharedActivity } };
  }
  return { ok: false, reason: 'invalid_response', error: 'Shared-state service returned an invalid result.' };
}
