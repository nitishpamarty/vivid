import { supabase } from './supabase.ts';
import { readEdgeFunctionError } from './edgeFunctionErrors.ts';
import type { RoomSession } from './roomSession.ts';
import type { CanvasCard, ExplorationRole } from './explorationModel.ts';

export interface ExplorationSnapshot {
  cards: readonly CanvasCard[];
}

export interface PersistedExploration {
  explorationId: string;
  schemaVersion: number;
  name: string;
  snapshot: ExplorationSnapshot;
  version: number;
  role: ExplorationRole;
  createdAt?: string;
  updatedAt?: string;
}

export type ExplorationResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string; error: string; currentVersion?: number };

async function invoke<T>(body: Record<string, unknown>): Promise<ExplorationResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke('exploration-state', { body });
    if (error) {
      const safe = await readEdgeFunctionError(error);
      return safe ? { ok: false, ...safe } : { ok: false, reason: 'unavailable', error: 'Exploration persistence is unavailable.' };
    }
    if (!data || typeof data !== 'object') return { ok: false, reason: 'invalid_response', error: 'Exploration persistence returned no result.' };
    const result = data as Record<string, unknown>;
    if (result.ok === false && typeof result.reason === 'string' && typeof result.error === 'string') {
      return { ok: false, reason: result.reason, error: result.error, ...(typeof result.currentVersion === 'number' ? { currentVersion: result.currentVersion } : {}) };
    }
    if (result.ok !== true || !result.data || typeof result.data !== 'object') return { ok: false, reason: 'invalid_response', error: 'Exploration persistence returned an invalid result.' };
    return { ok: true, data: result.data as T };
  } catch {
    return { ok: false, reason: 'unavailable', error: 'Exploration persistence is unavailable.' };
  }
}

export function snapshotForCanvas(cards: readonly CanvasCard[]): ExplorationSnapshot {
  return { cards: [...cards] };
}

export function getExplorationId(input: string | URL): string | null {
  try {
    const url = typeof input === 'string' ? new URL(input, 'http://localhost') : input;
    const id = new URLSearchParams(url.hash.replace(/^#/, '')).get('exploration');
    return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null;
  } catch { return null; }
}

export function setExplorationId(input: string | URL, explorationId: string): string {
  const url = typeof input === 'string' ? new URL(input, 'http://localhost') : new URL(input.toString());
  const params = new URLSearchParams(url.hash.replace(/^#/, ''));
  params.set('exploration', explorationId);
  url.hash = params.toString();
  return url.toString();
}

export function createExploration(session: RoomSession, snapshot: ExplorationSnapshot, name = 'Untitled exploration'): Promise<ExplorationResult<PersistedExploration>> {
  return invoke<PersistedExploration>({ operation: 'create_exploration', name, schemaVersion: 1, snapshot, capability: session.capability, actor: 'person' });
}

export function openExploration(session: RoomSession, explorationId: string): Promise<ExplorationResult<PersistedExploration>> {
  return invoke<PersistedExploration>({ operation: 'open_exploration', explorationId, capability: session.capability, actor: 'person' });
}

export function mutateExploration(session: RoomSession, explorationId: string, expectedVersion: number, snapshot: ExplorationSnapshot, action = 'exploration_updated'): Promise<ExplorationResult<PersistedExploration>> {
  return invoke<PersistedExploration>({
    operation: 'mutate_exploration', explorationId, capability: session.capability,
    expectedVersion, snapshot, action, mutationId: crypto.randomUUID(), actor: 'person',
  });
}

/**
 * Core exploration rows intentionally deny browser Realtime reads. Polling the
 * authorized open RPC keeps the capability and RLS boundary intact while
 * providing live collaboration updates for this no-login demo.
 */
export function subscribeExploration(session: RoomSession, explorationId: string, onChange: (data: PersistedExploration) => void, onStatus?: (status: 'subscribed' | 'unavailable') => void, intervalMs = 5000): () => void {
  let active = true;
  const poll = async () => {
    const result = await openExploration(session, explorationId);
    if (!active) return;
    if (result.ok) { onStatus?.('subscribed'); onChange(result.data); }
    else onStatus?.('unavailable');
  };
  // The Edge Function broadcasts only a version tick after an accepted
  // mutation; the capability-gated open RPC remains the source of snapshot
  // data. Polling stays as a small fallback for deployments without Realtime.
  const channel = supabase
    .channel(`exploration:${explorationId}`)
    .on('broadcast', { event: 'exploration_updated' }, () => { void poll(); })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onStatus?.('subscribed');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onStatus?.('unavailable');
    });
  const timer = window.setInterval(() => { void poll(); }, intervalMs);
  return () => { active = false; window.clearInterval(timer); void supabase.removeChannel(channel); };
}
