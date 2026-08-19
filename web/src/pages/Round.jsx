import { Nav } from '../components/Nav.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { useJson } from '../hooks/useJson.js';

function PairingCard({ pairing }) {
  if (pairing.bye) {
    return (
      <div className="card">
        <div className="pairing">
          <strong>{pairing.player1?.name}</strong>
          <span className="meta-line" style={{ margin: 0 }}>
            Bye (pasa de ronda)
          </span>
        </div>
      </div>
    );
  }

  const status = pairing.status === 'complete' && !pairing.gameUrl ? 'needs_review' : pairing.status;

  return (
    <div className="card">
      <div className="pairing">
        <span>
          <strong>{pairing.player1?.name}</strong> vs <strong>{pairing.player2?.name}</strong>
        </span>
        <span style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {pairing.gameUrl && (
            <a href={pairing.gameUrl} target="_blank" rel="noreferrer">
              ver partida
            </a>
          )}
          <StatusBadge status={status} />
        </span>
      </div>
    </div>
  );
}

export function Round() {
  const { data: round, error } = useJson('./data/current-round.json');

  return (
    <div className="page">
      <Nav current="round" />
      <h1>Ronda actual</h1>
      <p className="meta-line">
        {round ? `Ronda ${round.round}` : 'Cargando...'}
        {round?.windowStart && ` · desde ${new Date(round.windowStart).toLocaleDateString('es-ES')}`}
        {round?.windowEnd && ` hasta ${new Date(round.windowEnd).toLocaleDateString('es-ES')}`}
      </p>

      {error && <p className="empty-state">No se pudieron cargar los datos.</p>}

      {round && round.pairings.length === 0 && (
        <p className="empty-state">No hay una ronda activa todavía.</p>
      )}

      {round?.pairings.map((pairing) => (
        <PairingCard key={pairing.matchId} pairing={pairing} />
      ))}
    </div>
  );
}
