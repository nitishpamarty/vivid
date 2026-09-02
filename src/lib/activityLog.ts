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

export async function loadActivityLog(reportId: string = REPORT_ID): Promise<LogEntry[]> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('id, actor, message, created_at')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error || !data) return [];
  return (data as LogRow[]).map(toEntry);
}

export function insertActivityLog(actor: LogEntry['actor'], message: string, reportId: string = REPORT_ID): void {
  supabase
    .from('activity_log')
    .insert({ report_id: reportId, actor, message })
    .then(({ error }) => {
      if (error) console.error('insertActivityLog failed', error);
    });
}

export function subscribeActivityLog(onInsert: (entry: LogEntry) => void, reportId: string = REPORT_ID): () => void {
  const channel = supabase
    .channel(`activity_log:${reportId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'activity_log', filter: `report_id=eq.${reportId}` },
      (payload) => onInsert(toEntry(payload.new as LogRow)),
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
