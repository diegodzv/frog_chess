import { Nav } from '../components/Nav.jsx';
import { useJson } from '../hooks/useJson.js';

const PHASE_LABELS = {
  registration: 'Inscripción abierta',
  'stage-one': 'Fase de grupos (suizo)',
  'stage-two': 'Fase eliminatoria',
  complete: 'Torneo finalizado'
};

export function Standings() {
  const { data: standings, error } = useJson('./data/standings.json');
  const { data: meta } = useJson('./data/meta.json');

  return (
    <div className="page">
      <Nav current="standings" />
      <h1>Clasificación</h1>
      <p className="meta-line">
        {meta ? `${PHASE_LABELS[meta.phase] ?? meta.phase} · Ronda ${meta.currentRound || '-'}` : 'Cargando...'}
        {standings?.updatedAt ? ` · Actualizado ${new Date(standings.updatedAt).toLocaleString('es-ES')}` : ''}
      </p>

      {error && <p className="empty-state">No se pudieron cargar los datos.</p>}

      {standings && standings.rows.length === 0 && (
        <p className="empty-state">Todavía no hay clasificación disponible.</p>
      )}

      {standings && standings.rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Jugador</th>
              <th>Puntos</th>
              <th>Récord (V-D-T)</th>
            </tr>
          </thead>
          <tbody>
            {standings.rows.map((row) => (
              <tr key={row.chesscomUsername ?? row.name}>
                <td>{row.rank}</td>
                <td>
                  {row.chesscomUsername ? (
                    <a href={`https://www.chess.com/member/${row.chesscomUsername}`} target="_blank" rel="noreferrer">
                      {row.name}
                    </a>
                  ) : (
                    row.name
                  )}
                </td>
                <td>{row.matchPoints}</td>
                <td>{row.record}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
