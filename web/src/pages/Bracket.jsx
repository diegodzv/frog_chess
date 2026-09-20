import { Nav } from '../components/Nav.jsx';
import { useJson } from '../hooks/useJson.js';
import { dataUrl } from '../dataset.js';
import { gameSequence } from '../components/format.js';

function Slot({ player, score, won, lost }) {
  return (
    <div
      className={`bslot ${won ? 'won' : ''} ${lost ? 'lost' : ''}`}
      title={player?.chesscomUsername ? `chess.com: @${player.chesscomUsername}` : undefined}
    >
      <span className="seed">{player?.seed ?? ''}</span>
      <span className="bname">{player?.name ?? 'Por determinar'}</span>
      <span className="bscore">{score ?? ''}</span>
    </div>
  );
}

function BracketMatch({ match }) {
  const done = match.status === 'complete';
  const seq = gameSequence(match.games);
  return (
    <div className={`bmatch ${match.status}`} title={seq ? `Partidas (jugador de arriba): ${seq}` : undefined}>
      <Slot
        player={match.player1}
        score={done ? match.score.p1 : null}
        won={done && match.winner === 'p1'}
        lost={done && match.winner === 'p2'}
      />
      <Slot
        player={match.player2}
        score={done ? match.score.p2 : null}
        won={done && match.winner === 'p2'}
        lost={done && match.winner === 'p1'}
      />
    </div>
  );
}

export function Bracket() {
  const { data: bracket, error } = useJson(dataUrl('bracket.json'));

  const notStarted = bracket && bracket.phase !== 'stage-two' && bracket.phase !== 'complete';

  return (
    <div className="page wide">
      <Nav current="bracket" />
      <h1>Fase eliminatoria</h1>

      {error && <p className="empty-state">No se pudieron cargar los datos.</p>}

      {notStarted && <p className="empty-state">El bracket se activará cuando termine la fase suiza.</p>}

      {bracket?.champion && (
        <div className="champion-banner">
          <span className="trophy" aria-hidden="true">
            🏆
          </span>
          <div>
            <div className="champion-title">Campeón</div>
            <div className="champion-name">{bracket.champion.name}</div>
          </div>
        </div>
      )}

      {bracket && bracket.rounds.length > 0 && (
        <>
          <p className="legend">
            {bracket.size} clasificados sembrados por su puesto en la fase suiza (1.º contra {bracket.size}.º, etc.). El
            número junto al nombre es la siembra.
          </p>
          <div className="bracket">
            {bracket.rounds.map((round) => (
              <div className={`bracket-round ${round.current ? 'current' : ''}`} key={round.number}>
                <h3>
                  {round.label}
                  <span className="bo">al mejor de {round.bestOf}</span>
                </h3>
                <div className="bracket-matches">
                  {round.matches.map((match) => (
                    <BracketMatch key={match.matchId} match={match} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
