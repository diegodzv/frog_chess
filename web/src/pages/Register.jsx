import { Nav } from '../components/Nav.jsx';
import { useJson } from '../hooks/useJson.js';
import { dataUrl } from '../dataset.js';
import { REGISTRATION_FORM_URL } from '../config.js';
import { bestOfText } from '../components/format.js';

export function Register() {
  const { data: meta } = useJson(dataUrl('meta.json'));
  const { data: players } = useJson(dataUrl('players.json'));

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

      {isOpen && meta?.expectedFormat && (
        <p className="legend">
          Formato con los {count} inscritos actuales: {meta.expectedFormat.swissRounds} rondas suizas ({bestOfText(meta.series?.swiss)})
          y pasan a eliminatorias los {meta.expectedFormat.playoffCutoff} mejores (semifinales y final al mejor de{' '}
          {meta.series?.final}). El número de clasificados se fija al cerrar la inscripción.
        </p>
      )}

      {isOpen ? (
        <>
          <p>
            Para inscribirte rellena el formulario con tu nombre y tu usuario de chess.com. La organización añade a los
            inscritos a esta lista; puede tardar unos días en aparecer tu nombre.
          </p>
          {REGISTRATION_FORM_URL ? (
            <a className="btn" href={REGISTRATION_FORM_URL} target="_blank" rel="noreferrer">
              Inscribirme
            </a>
          ) : (
            <p>El enlace al formulario está en el canal de Teams del torneo.</p>
          )}
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
