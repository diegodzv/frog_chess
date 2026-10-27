import { Nav } from '../components/Nav.jsx';
import { useJson } from '../hooks/useJson.js';
import { dataUrl } from '../dataset.js';
import { PHASE_LABELS, bestOfText, formatDate, playerLink } from '../components/format.js';

const vd = (r) => `${r.win}-${r.loss}`;
const vtd = (g) => `${g.win}-${g.draw}-${g.loss}`;
const pct = (x) => `${(x * 100).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

function OutcomeCell({ row, provisional }) {
  if (row.outcome) {
    const cls =
      row.outcome === 'Campeón'
        ? 'outcome-champion'
        : row.outcome === 'Finalista' || row.outcome === 'En juego'
          ? 'outcome-final'
          : 'outcome-out';
    return <span className={cls}>{row.outcome}</span>;
  }
  if (row.qualified) {
    return <span className="outcome-qualified">{provisional ? 'En zona de playoffs' : 'Clasificado'}</span>;
  }
  return null;
}

function PlayerCell({ row }) {
  return playerLink(row) ? (
    <a href={playerLink(row)} target="_blank" rel="noreferrer">
      {row.name}
    </a>
  ) : (
    row.name
  );
}

/** Overall ranking once the bracket exists: how far each player got, then points and resistance over the whole tournament. */
function FinalStandings({ final }) {
  return (
    <>
      <h2>Clasificación general{final.provisional ? ' (provisional)' : ''}</h2>
      <p className="legend">
        Primero quien llegó más lejos en las eliminatorias; dentro de cada grupo, más puntos y después más resistencia,
        contando todo el torneo.
      </p>
      <div className="table-wrap">
        <table className="standings">
          <thead>
            <tr>
              <th>#</th>
              <th>Jugador</th>
              <th title="Puntos: 1 por cada encuentro ganado, fase suiza y eliminatorias">Pts</th>
              <th title="Encuentros ganados-perdidos en todo el torneo">V-D</th>
              <th title="Resistencia: porcentaje de victorias medio de tus rivales">Resist.</th>
              <th title="Resistencia media de tus rivales">Resist. rivales</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {final.rows.map((row) => (
              <tr key={row.playerId}>
                <td className="num">{row.rank}</td>
                <td>
                  <PlayerCell row={row} />
                </td>
                <td className="num strong">{row.points}</td>
                <td className="num">{vd(row.record)}</td>
                <td className="num">{pct(row.resistance)}</td>
                <td className="num">{pct(row.opponentsResistance)}</td>
                <td>
                  <OutcomeCell row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Fase suiza</h2>
    </>
  );
}

export function Standings() {
  const { data: standings, error } = useJson(dataUrl('standings.json'));
  const { data: meta } = useJson(dataUrl('meta.json'));

  const rows = standings?.rows ?? [];
  const provisional = standings?.phase === 'stage-one';
  const started = rows.length > 0;

  return (
    <div className="page wide">
      <Nav current="standings" />
      <h1>Clasificación</h1>
      <p className="meta-line">
        {meta
          ? `${PHASE_LABELS[meta.phase] ?? meta.phase}${meta.currentRoundLabel ? ` · ${meta.currentRoundLabel}` : ''}`
          : 'Cargando...'}
        {standings?.updatedAt ? ` · Actualizado ${formatDate(standings.updatedAt)}` : ''}
      </p>

      {meta?.champion && (
        <div className="champion-banner">
          <span className="trophy" aria-hidden="true">
            🏆
          </span>
          <div>
            <div className="champion-title">Campeón</div>
            <div className="champion-name">{meta.champion.name}</div>
          </div>
        </div>
      )}

      {error && <p className="empty-state">No se pudieron cargar los datos.</p>}
      {standings && !started && <p className="empty-state">Todavía no hay clasificación disponible.</p>}

      {started && (
        <>
          {standings.final && <FinalStandings final={standings.final} />}
          <p className="legend">
            {meta?.swissRounds} rondas suizas ({bestOfText(meta?.series?.swiss)}). Los {standings.cutoff} primeros pasan a
            eliminatorias{provisional ? ' (provisional hasta la última ronda)' : ''}. Cada jugador tiene su resistencia:
            el porcentaje de victorias medio de todos sus rivales, con su récord actual. Se ordena por puntos y, con los
            mismos puntos, por resistencia y después por la resistencia de los rivales.
          </p>
          <div className="table-wrap">
            <table className="standings">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Jugador</th>
                  <th title="Puntos: 1 por cada encuentro ganado (el bye cuenta como victoria)">Pts</th>
                  <th title="Encuentros (series): ganados-perdidos">V-D</th>
                  <th title="Partidas sueltas: victorias-tablas-derrotas">Partidas V-T-D</th>
                  <th title="Resistencia: porcentaje de victorias medio de tus rivales">Resist.</th>
                  <th title="Resistencia media de tus rivales">Resist. rivales</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.playerId}
                    className={`${row.qualified ? 'qualified' : ''} ${row.rank === standings.cutoff ? 'cutoff-line' : ''}`}
                  >
                    <td className="num">{row.rank}</td>
                    <td>
                      <PlayerCell row={row} />
                      {row.byes > 0 && (
                        <span className="tag" title="Ha tenido un bye">
                          bye
                        </span>
                      )}
                    </td>
                    <td className="num strong">{row.points}</td>
                    <td className="num">{vd(row.record)}</td>
                    <td className="num">{vtd(row.games)}</td>
                    <td className="num">{pct(row.resistance)}</td>
                    <td className="num">{pct(row.opponentsResistance)}</td>
                    <td>
                      <OutcomeCell row={row} provisional={provisional} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
