// Supabase-backed twin of Phase 2's in-memory-only activity log: same
// LogEntry shape, but persisted and realtime-synced across viewers instead
// of living only in the browser tab that made the edit.

import { REPORT_ID } from './chartState.ts';
import { supabase } from './supabase.ts';
import type { LogEntry } from '../components/ActivityLog.tsx';

interface LogRow {
  id: number;
  actor: LogEntry['actor'];
  message: string;
  created_at: string;
}

function toEntry(row: LogRow): LogEntry {
  return { id: row.id, actor: row.actor, message: row.message, ts: new Date(row.created_at).toLocaleTimeString() };
}

export async function loadActivityLog(reportId: string = REPORT_ID, roomId?: string): Promise<LogEntry[]> {
  if (!roomId) return [];
  const { data, error } = await supabase
    .from('activity_log')
    .select('id, actor, message, created_at')
    .eq('report_id', reportId)
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error || !data) return [];
  return (data as LogRow[]).map(toEntry);
}

export function subscribeActivityLog(onInsert: (entry: LogEntry) => void, reportId: string = REPORT_ID, roomId?: string): () => void {
  if (!roomId) return () => {};
  const channel = supabase
    .channel(`activity_log:${roomId}:${reportId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'activity_log', filter: `room_id=eq.${roomId}` },
      (payload) => onInsert(toEntry(payload.new as LogRow)),
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
