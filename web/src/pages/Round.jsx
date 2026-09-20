import { useState } from 'react';
import { Nav } from '../components/Nav.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { useJson } from '../hooks/useJson.js';
import { dataUrl } from '../dataset.js';
import { formatDate, gameSequence } from '../components/format.js';

const SHORT_LABEL = {
  'Dieciseisavos de final': '1/16',
  'Octavos de final': 'Octavos',
  'Cuartos de final': 'Cuartos',
  Semifinales: 'Semis',
  Final: 'Final'
};

const shortLabel = (round) => SHORT_LABEL[round.label] ?? `R${round.number}`;

function PlayerName({ player, won, lost, left }) {
  return (
    <span className={`pname ${left ? 'left' : ''} ${won ? 'won' : ''} ${lost ? 'lost' : ''}`}>
      {player?.seed && <span className="seed">{player.seed}</span>}
      <span className="pname-text">
        <span>{player?.name ?? '—'}</span>
        {player?.chesscomUsername && (
          <a
            className="cc-user"
            href={`https://www.chess.com/member/${player.chesscomUsername}`}
            target="_blank"
            rel="noreferrer"
            title="Abrir el perfil en chess.com para retarle"
          >
            @{player.chesscomUsername}
          </a>
        )}
      </span>
    </span>
  );
}

function Pairing({ pairing }) {
  if (pairing.bye) {
    return (
      <div className="pairing-row bye-row">
        <span className="table-no">·</span>
        <PlayerName player={pairing.player1} won />
        <span className="bye-note">descansa esta ronda (bye: cuenta como victoria)</span>
      </div>
    );
  }

  const badge =
    pairing.manual === 'double' || pairing.manual === 'double_forfeit' ? 'double' : pairing.manual ? 'manual' : pairing.status;
  const sequence = gameSequence(pairing.games);
  const finished = pairing.status === 'complete';
  // Double forfeit: nobody won, both lost.
  const lost = (side) => finished && pairing.winner !== side;

  return (
    <div className={`pairing-row ${pairing.status}`}>
      <span className="table-no">{pairing.table}</span>
      <PlayerName player={pairing.player1} won={pairing.winner === 'p1'} lost={lost('p1')} left />
      <span className="score">{pairing.score ? `${pairing.score.p1} – ${pairing.score.p2}` : 'vs'}</span>
      <PlayerName player={pairing.player2} won={pairing.winner === 'p2'} lost={lost('p2')} />
      <span
        className="games"
        title="Partidas de la serie desde el punto de vista del jugador de la izquierda: V victoria, D derrota, ½ tablas"
      >
        {sequence ?? ''}
      </span>
      <StatusBadge status={badge} />
    </div>
  );
}

export function Round() {
  const { data, error } = useJson(dataUrl('rounds.json'));
  const [selected, setSelected] = useState(() => Number(new URLSearchParams(window.location.search).get('round')) || null);

  const rounds = data?.rounds ?? [];
  const current = rounds.find((r) => r.current) ?? rounds[rounds.length - 1];
  const active = rounds.find((r) => r.number === selected) ?? current;

  const played = active ? active.pairings.filter((p) => p.status === 'complete' || p.status === 'bye').length : 0;
  const total = active?.pairings.length ?? 0;

  return (
    <div className="page wide">
      <Nav current="round" />
      <h1>Rondas</h1>

      {error && <p className="empty-state">No se pudieron cargar los datos.</p>}
      {data && rounds.length === 0 && <p className="empty-state">No hay una ronda activa todavía.</p>}

      {rounds.length > 0 && (
        <div className="round-tabs" role="tablist">
          {rounds.map((round) => (
            <button
              key={round.number}
              role="tab"
              aria-selected={round.number === active?.number}
              className={`${round.number === active?.number ? 'active' : ''} ${round.phase === 'stage-two' ? 'elim' : ''}`}
              onClick={() => {
                setSelected(round.number);
                const url = new URL(window.location.href);
                url.searchParams.set('round', round.number);
                window.history.replaceState(null, '', url);
              }}
            >
              {shortLabel(round)}
              {round.current && <span className="dot" title="Ronda en curso" />}
            </button>
          ))}
        </div>
      )}

      {active && (
        <>
          <h2>{active.label}</h2>
          <p className="meta-line">
            Al mejor de {active.bestOf}
            {active.startedAt && ` · ${formatDate(active.startedAt)}`}
            {active.endedAt ? ` – ${formatDate(active.endedAt)}` : active.current ? ' – en curso' : ''}
            {' · '}
            {played}/{total} resueltos
          </p>
          <div className="pairing-list">
            {active.pairings.map((pairing) => (
              <Pairing key={pairing.matchId} pairing={pairing} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
