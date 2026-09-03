import { supabase } from './supabase.ts';
import type { RoomSession } from './roomSession.ts';
import { parseSharedMutationResult, type SharedMutation, type SharedMutationResult } from './sharedStateProtocol.ts';
import { readEdgeFunctionError } from './edgeFunctionErrors.ts';
export { parseSharedMutationResult } from './sharedStateProtocol.ts';
export type { SharedMutation, SharedMutationResult } from './sharedStateProtocol.ts';

async function invoke<TState>(body: Record<string, unknown>): Promise<SharedMutationResult<TState>> {
  const { data, error } = await supabase.functions.invoke('shared-state', { body });
  if (error) {
    const safe = await readEdgeFunctionError(error);
    return safe ? { ok: false, ...safe } : { ok: false, reason: 'unavailable', error: 'Shared session is unavailable. Try again.' };
  }
  return parseSharedMutationResult<TState>(data);
}

// `reportId` defaults to Revenue's `northbeam` so existing call sites are
// unchanged; Product Usage call sites pass `'product_usage'` explicitly.
export function createSharedRoom<TState>(session: RoomSession, state: TState, schemaVersion: number, reportId = 'northbeam'): Promise<SharedMutationResult<TState>> {
  return invoke<TState>({ operation: 'create_room', roomId: session.roomId, capability: session.capability, state, schemaVersion, reportId });
}

export function mutateSharedState<TState>(session: RoomSession, expectedVersion: number, mutation: SharedMutation, reportId = 'northbeam'): Promise<SharedMutationResult<TState>> {
  return invoke<TState>({ operation: 'mutate', roomId: session.roomId, capability: session.capability, expectedVersion, mutation, reportId });
}
