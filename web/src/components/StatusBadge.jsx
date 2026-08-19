const LABELS = {
  pending: 'Pendiente',
  complete: 'Completada',
  needs_review: 'Revisar'
};

export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{LABELS[status] ?? status}</span>;
}
