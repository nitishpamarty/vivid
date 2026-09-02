export type ReportId = 'revenue' | 'people' | 'usage';

const REPORTS: { id: ReportId; label: string; sub: string }[] = [
  { id: 'revenue', label: 'Revenue', sub: 'Revenue overview · fictional demo data' },
  { id: 'people', label: 'People', sub: 'People overview · fictional demo data' },
  { id: 'usage', label: 'Product Usage', sub: 'Report engagement overview · fictional demo data' },
];

interface Props {
  report: ReportId;
  onChangeReport: (report: ReportId) => void;
}

export function Topbar({ report, onChangeReport }: Props) {
  const active = REPORTS.find((r) => r.id === report) ?? REPORTS[0];
  return (
    <div className="topbar">
      <div className="brand">
        <span className="mark">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 2L4 12h5v10l8-12h-5z" fill="#fff" /></svg>
        </span>
        <div>
          <div className="name">Northbeam</div>
          <div className="sub">{active.sub}</div>
        </div>
      </div>
      <div className="report-tabs">
        {REPORTS.map((r) => (
          <button
            type="button"
            key={r.id}
            className={`report-tab ${report === r.id ? 'active' : ''}`}
            onClick={() => onChangeReport(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
