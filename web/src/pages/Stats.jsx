import { Nav } from '../components/Nav.jsx';
import { useJson } from '../hooks/useJson.js';
import { dataUrl } from '../dataset.js';
import { formatDate, formatDuration } from '../components/format.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const CARDS = [
  {
    key: 'fastestByMoves',
    title: 'Victoria más rápida',
    unit: 'en jugadas',
    value: (r) => plural(r.moves, 'jugada', 'jugadas'),
    detail: (r) => `${formatDuration(r.durationSec)} · ${r.roundLabel}`
  },
  {
    key: 'fastestByTime',
    title: 'Victoria más rápida',
    unit: 'en tiempo de juego',
    value: (r) => formatDuration(r.durationSec),
    detail: (r) => `${plural(r.moves, 'jugada', 'jugadas')} · ${r.roundLabel}`
  },
  {
    key: 'fastestAverageByMoves',
    title: 'Gana más rápido de media',
    unit: 'en jugadas',
    value: (r) => `${r.avgMoves.toLocaleString('es-ES')} jugadas`,
    detail: (r) => plural(r.wins, 'victoria', 'victorias')
  },
  {
    key: 'fastestAverageByTime',
    title: 'Gana más rápido de media',
    unit: 'en tiempo de juego',
    value: (r) => formatDuration(r.avgDurationSec),
    detail: (r) => plural(r.wins, 'victoria', 'victorias')
  },
  {
    key: 'mostMaterial',
    title: 'Victoria con más material',
    unit: 'piezas que le quedaban en el tablero',
    value: (r) => plural(r.material, 'punto', 'puntos'),
    detail: (r) => `${plural(r.moves, 'jugada', 'jugadas')} · ${r.roundLabel}`
  },
  {
    key: 'mostCheckmates',
    title: 'Más jaques mate',
    unit: 'en todo el torneo',
    value: (r) => plural(r.checkmates, 'mate', 'mates'),
    detail: () => null
  }
];

function StatCard({ card, rows }) {
  const [leader, ...rest] = rows ?? [];
  return (
    <section className="card stat-card">
      <h2>{card.title}</h2>
      <p className="stat-unit">{card.unit}</p>
      {!leader ? (
        <p className="empty-state">Todavía sin datos.</p>
      ) : (
        <>
          <div className="stat-leader">
            <span className="stat-value">{card.value(leader)}</span>
            <span className="stat-name">{leader.player?.name}</span>
            {card.detail(leader) && <span className="stat-detail">{card.detail(leader)}</span>}
          </div>
          {rest.length > 0 && (
            <ol className="stat-rest" start={2}>
              {rest.map((row, i) => (
                <li key={i}>
                  <span>{row.player?.name}</span>
                  <span className="stat-rest-value">{card.value(row)}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

export function Stats() {
  const { data, error } = useJson(dataUrl('stats.json'));

  return (
    <div className="page wide">
      <Nav current="stats" />
      <h1>Estadísticas</h1>
      <p className="meta-line">
        {data ? `${plural(data.gamesAnalyzed, 'victoria analizada', 'victorias analizadas')}` : 'Cargando...'}
        {data?.updatedAt ? ` · Actualizado ${formatDate(data.updatedAt)}` : ''}
      </p>
      {error && <p className="empty-state">No se pudieron cargar los datos.</p>}
      {data && (
        <>
          <div className="stat-grid">
            {CARDS.map((card) => (
              <StatCard key={card.key} card={card} rows={data[card.key]} />
            ))}
          </div>
          <p className="legend">
            Se actualizan a medida que se juegan las partidas en chess.com. Solo cuentan las victorias en partidas del
            torneo; no cuentan las partidas abandonadas ni las de menos de {data.minMovesForRecords} jugadas, ni los
            resultados decididos a suertes o por incomparecencia. Para las medias hacen falta al menos{' '}
            {data.minWinsForAverage} victorias. Material: peón 1, caballo y alfil 3, torre 5, dama 9.
          </p>
        </>
      )}
    </div>
  );
}
