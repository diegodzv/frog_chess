import { Nav } from '../components/Nav.jsx';
import { useJson } from '../hooks/useJson.js';
import { REGISTRATION_ISSUE_URL } from '../config.js';

export function Register() {
  const { data: meta } = useJson('./data/meta.json');
  const { data: players } = useJson('./data/players.json');

  const isOpen = meta?.phase === 'registration';
  const count = meta?.playerCount ?? 0;
  const max = meta?.playerCap?.max ?? 0;
  const pct = max ? Math.min(100, Math.round((count / max) * 100)) : 0;

  return (
    <div className="page">
      <Nav current="register" />
      <h1>Inscripción</h1>

      {meta && (
        <>
          <p className="meta-line">
            {count} / {max} plazas ocupadas · {isOpen ? 'inscripción abierta' : 'inscripción cerrada'}
          </p>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </>
      )}

      {isOpen ? (
        <>
          <p>
            Para inscribirte, abre un issue en GitHub con tu nombre y tu usuario de chess.com. Un bot lo
            validará automáticamente y te confirmará la inscripción en el propio issue.
          </p>
          <a className="btn" href={REGISTRATION_ISSUE_URL} target="_blank" rel="noreferrer">
            Inscribirme
          </a>
        </>
      ) : (
        <p className="empty-state">La inscripción ya no está abierta.</p>
      )}

      {players && players.players.length > 0 && (
        <>
          <h2>Jugadores inscritos</h2>
          <ul>
            {players.players
              .filter((p) => p.status === 'active')
              .map((p) => (
                <li key={p.chesscomUsername}>{p.name}</li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}
