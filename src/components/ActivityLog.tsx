export interface LogEntry {
  id: number;
  actor: 'person' | 'agent';
  message: string;
  ts: string;
}

export function ActivityLog({ entries }: { entries: LogEntry[] }) {
  return (
    <div className="card">
      <p className="panel-title">Activity</p>
      <p className="panel-sub">Person and agent chart edits — an Agent line only appears when a registered tool call actually ran</p>
      {entries.length === 0 ? (
        <p className="log-empty">No activity yet.</p>
      ) : (
        <ul className="log-list">
          {entries.map((e) => (
            <li key={e.id} className="log-row">
              <span className={`actor ${e.actor}`}>{e.actor === 'agent' ? 'Agent' : 'Person'}</span>
              <span className="msg">{e.message}</span>
              <span className="ts">{e.ts}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
