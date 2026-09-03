// Product Usage's Supabase reads — room-scoped, versioned, realtime-synced,
// the same shape as chartState.ts's Revenue equivalents. Kept in its own
// module (separate from usageFilters.ts's pure validation/scoping) so tests
// can import the pure logic without pulling in import.meta.env-dependent
// supabase.ts, mirroring how chartState.ts (impure) stays separate from
// reportFilters.ts (pure, tested).

import { supabase } from './supabase.ts';
import { USAGE_REPORT_ID, USAGE_SCHEMA_VERSION, type UsageDashboardState } from './usageFilters.ts';

export interface UsageDashboardSnapshot {
  state: UsageDashboardState;
  version: number;
}

export async function loadUsageDashboardSnapshot(roomId: string | undefined, defaultState: UsageDashboardState): Promise<UsageDashboardSnapshot> {
  if (!roomId) return { state: defaultState, version: 0 };
  const { data, error } = await supabase
    .from('dashboard_state')
    .select('schema_version, version, state')
    .eq('report_id', USAGE_REPORT_ID)
    .eq('room_id', roomId)
    .maybeSingle();
  if (error) throw new Error('Shared dashboard is unavailable.');
  if (!data || data.schema_version !== USAGE_SCHEMA_VERSION || typeof data.version !== 'number') {
    throw new Error('Shared dashboard state is unavailable.');
  }
  return { state: data.state as UsageDashboardState, version: data.version };
}

export function subscribeUsageDashboardState(onChange: (state: UsageDashboardState, version: number) => void, roomId: string | undefined, onStatus?: (status: 'subscribed' | 'unavailable') => void): () => void {
  if (!roomId) return () => {};
  const channel = supabase
    .channel(`dashboard_state:${roomId}:${USAGE_REPORT_ID}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'dashboard_state', filter: `room_id=eq.${roomId}` },
      (payload) => {
        // The table also carries `northbeam` rows for the same room; ignore
        // any update that isn't this subscription's own report id.
        if (payload.new.report_id !== USAGE_REPORT_ID) return;
        onChange(payload.new.state as UsageDashboardState, Number(payload.new.version));
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onStatus?.('subscribed');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onStatus?.('unavailable');
    });
  return () => { supabase.removeChannel(channel); };
}
