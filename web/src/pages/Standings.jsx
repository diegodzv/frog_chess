import { Nav } from '../components/Nav.jsx';
import { useJson } from '../hooks/useJson.js';
import { dataUrl } from '../dataset.js';
import { PHASE_LABELS, formatDate, playerLink } from '../components/format.js';

const vd = (r) => `${r.win}-${r.loss}`;
const vtd = (g) => `${g.win}-${g.draw}-${g.loss}`;

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
          <p className="legend">
            {meta?.swissRounds} rondas suizas, todas al mejor de {meta?.series?.swiss}. Los {standings.cutoff} primeros
            pasan a eliminatorias{provisional ? ' (provisional hasta la última ronda)' : ''}. Desempates: Buchholz
            mediano → Sonneborn-Berger → diferencia de partidas. Las tablas no cuentan: se juega otra partida hasta que
            alguien gana la serie.
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
                  <th title="Buchholz mediano (fuerza de los rivales)">Buch.</th>
                  <th title="Sonneborn-Berger">S-B</th>
                  <th title="Diferencia de partidas ganadas y perdidas">Dif.</th>
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
                      {playerLink(row) ? (
                        <a href={playerLink(row)} target="_blank" rel="noreferrer">
                          {row.name}
                        </a>
                      ) : (
                        row.name
                      )}
                      {row.byes > 0 && (
                        <span className="tag" title="Ha tenido un bye">
                          bye
                        </span>
                      )}
                    </td>
                    <td className="num strong">{row.points}</td>
                    <td className="num">{vd(row.record)}</td>
                    <td className="num">{vtd(row.games)}</td>
                    <td className="num">{row.buchholz}</td>
                    <td className="num">{row.sonnebornBerger}</td>
                    <td className="num">{row.gameDiff > 0 ? `+${row.gameDiff}` : row.gameDiff}</td>
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
