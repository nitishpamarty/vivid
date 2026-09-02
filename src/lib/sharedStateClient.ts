import { supabase } from './supabase.ts';
import type { DashboardState } from './chartState.ts';
import type { RoomSession } from './roomSession.ts';
import { parseSharedMutationResult, type SharedMutation, type SharedMutationResult } from './sharedStateProtocol.ts';
export { parseSharedMutationResult } from './sharedStateProtocol.ts';
export type { SharedMutation, SharedMutationResult } from './sharedStateProtocol.ts';

async function invoke(body: Record<string, unknown>): Promise<SharedMutationResult> {
  const { data, error } = await supabase.functions.invoke('shared-state', { body });
  if (error) return { ok: false, reason: 'unavailable', error: 'Shared session is unavailable. Try again.' };
  return parseSharedMutationResult(data);
}

export function createSharedRoom(session: RoomSession, state: DashboardState, schemaVersion: number): Promise<SharedMutationResult> {
  return invoke({ operation: 'create_room', roomId: session.roomId, capability: session.capability, state, schemaVersion });
}

export function mutateSharedState(session: RoomSession, expectedVersion: number, mutation: SharedMutation): Promise<SharedMutationResult> {
  return invoke({ operation: 'mutate', roomId: session.roomId, capability: session.capability, expectedVersion, mutation });
}
