import { Nav } from '../components/Nav.jsx';
import { useJson } from '../hooks/useJson.js';

export function Bracket() {
  const { data: bracket, error } = useJson('./data/bracket.json');

  const notStarted = bracket && bracket.phase !== 'stage-two' && bracket.phase !== 'complete';

  return (
    <div className="page">
      <Nav current="bracket" />
      <h1>Fase eliminatoria</h1>

      {error && <p className="empty-state">No se pudieron cargar los datos.</p>}

      {notStarted && (
        <p className="empty-state">
          El bracket se activará cuando termine la fase de grupos (rondas suizas).
        </p>
      )}

      {bracket && !notStarted && bracket.rounds.length === 0 && (
        <p className="empty-state">El bracket todavía no se ha generado.</p>
      )}

      {bracket && bracket.rounds.length > 0 && (
        <div className="bracket">
          {bracket.rounds.map((round) => (
            <div className="bracket-round" key={round.round}>
              <h3>Ronda {round.round}</h3>
              {round.matches.map((match) => (
                <div className="card" key={match.matchId}>
                  <div>{match.player1?.name ?? 'TBD'}</div>
                  <div>{match.player2?.name ?? 'TBD'}</div>
                  {match.winner && <div className="meta-line">Gana: {match.winner}</div>}
                  {match.gameUrl && (
                    <a href={match.gameUrl} target="_blank" rel="noreferrer">
                      ver partida
                    </a>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
