const LABELS = {
  pending: 'Pendiente',
  complete: 'Completada',
  bye: 'Bye',
  waiting: 'Por jugar',
  manual: 'Resultado manual',
  double: 'Doble forfeit',
  needs_review: 'Revisar'
};

export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{LABELS[status] ?? status}</span>;
}
