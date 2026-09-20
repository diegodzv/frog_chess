// Synthetic tournament: fake roster + simulated games, played through the SAME
// lifecycle code as production (tournamentFlow + tournamentEngine). Used by
// dev/simulate-tournament.mjs and by the simulation tests.
//
// Players get a hidden Elo-like strength; every game is drawn from that, so
// the final standings can be compared against "who should have won".

import { createHash } from 'node:crypto';
import {
  applySeriesResult,
  getUnresolvedMatches,
  getRoundInfo,
  getSwissStandings,
  getStandings,
  getLastSwissRound,
  getFinalRound,
  resolveFormat
} from './tournamentEngine.mjs';
import { startTournament, advance } from './tournamentFlow.mjs';
import { scoreSeries, winsNeeded } from './series.mjs';

// ---------------------------------------------------------------------------
// Randomness and fake people
// ---------------------------------------------------------------------------

/** Small seedable PRNG (mulberry32): same seed, same tournament. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const FIRST_NAMES = [
  'Ana', 'Luis', 'Marta', 'Carlos', 'Lucía', 'Javier', 'Elena', 'Pablo', 'Sofía', 'Diego',
  'Laura', 'Álvaro', 'Carmen', 'Sergio', 'Paula', 'Andrés', 'Irene', 'Rubén', 'Nuria', 'Hugo',
  'Claudia', 'Iván', 'Marina', 'Adrián', 'Beatriz', 'Óscar', 'Silvia', 'Raúl', 'Patricia', 'Mario',
  'Alba', 'Tomás', 'Inés', 'Víctor', 'Rocío', 'Gonzalo', 'Cristina', 'Jorge', 'Noelia', 'Fernando'
];
const LAST_NAMES = [
  'García', 'Fernández', 'López', 'Martínez', 'Sánchez', 'Pérez', 'Gómez', 'Ruiz', 'Hernández', 'Díaz',
  'Moreno', 'Muñoz', 'Álvarez', 'Romero', 'Alonso', 'Gutiérrez', 'Navarro', 'Torres', 'Domínguez', 'Vázquez',
  'Ramos', 'Gil', 'Serrano', 'Blanco', 'Molina', 'Morales', 'Suárez', 'Ortega', 'Delgado', 'Castro',
  'Ortiz', 'Rubio', 'Marín', 'Sanz', 'Iglesias', 'Medina', 'Cortés', 'Garrido', 'Castillo', 'Santos'
];

function ascii(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function gauss(rng) {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

/**
 * Fake roster shaped like data/players.json, plus each player's hidden rating
 * (kept apart: the real roster never has one).
 */
export function generateRoster(count, rng, { meanRating = 1350, ratingSd = 220 } = {}) {
  const combos = shuffle(
    FIRST_NAMES.flatMap((first) => LAST_NAMES.map((last) => [first, last])),
    rng
  );
  if (count > combos.length) throw new Error(`Máximo ${combos.length} jugadores simulados.`);

  const players = [];
  const ratings = {};
  combos.slice(0, count).forEach(([first, last], i) => {
    const name = `${first} ${last}`;
    const username = `${ascii(first)}_${ascii(last)}${10 + Math.floor(rng() * 90)}`.replace(/-/g, '');
    const suffix = createHash('sha1').update(username).digest('hex').slice(0, 6);
    const id = `p_${ascii(name)}-${suffix}`;
    players.push({
      id,
      name,
      chesscomUsername: username,
      chesscomPlayerId: 1_000_000 + i,
      status: 'active',
      registeredAt: new Date(Date.UTC(2026, 8, 1, 9, 0, 0) + i * 3_600_000).toISOString()
    });
    ratings[id] = Math.round(Math.min(2200, Math.max(600, meanRating + gauss(rng) * ratingSd)));
  });
  return { players, ratings };
}

// ---------------------------------------------------------------------------
// Games and series
// ---------------------------------------------------------------------------

/** One game from player1's point of view: 'p1' | 'p2' | 'draw'. Elo expectation, with draws rarer the bigger the gap. */
export function playGame(rng, ratingA, ratingB, { baseDrawRate = 0.12 } = {}) {
  const diff = ratingA - ratingB;
  const expected = 1 / (1 + 10 ** (-diff / 400));
  const pDraw = baseDrawRate * Math.exp(-((diff / 350) ** 2));
  const pA = Math.max(0, expected - pDraw / 2);
  const roll = rng();
  if (roll < pA) return 'p1';
  if (roll < pA + pDraw) return 'draw';
  return 'p2';
}

/** Plays a best-of-N series game by game until the rules of series.mjs say it's decided. */
export function simulateSeries(rng, ratingA, ratingB, bestOf, { baseDrawRate } = {}) {
  const games = [];
  let score = scoreSeries(games, bestOf);
  while (score.status !== 'complete') {
    if (games.length > 50) throw new Error('Serie sin resolver tras 50 partidas (¿reglas inconsistentes?).');
    games.push(playGame(rng, ratingA, ratingB, { baseDrawRate }));
    score = scoreSeries(games, bestOf);
  }
  return { games, score };
}

// ---------------------------------------------------------------------------
// Running a whole tournament
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/**
 * Plays a full tournament (registration closed -> swiss -> bracket -> champion).
 *
 * @param config  contents of data/tournament.json (phase 'registration')
 * @param options.noShowRate      chance a swiss/bracket pairing is never played (organizer enters an override)
 * @param options.doubleForfeitShare  share of swiss no-shows where NEITHER player shows up
 * @param options.roundDays       length of every round's window (for the fake calendar)
 * @param options.stopAt          { round, resolvedShare }: stop inside that round with only that share of its
 *                                pairings resolved, to get a mid-tournament snapshot (no verification possible)
 */
function playTournament({
  config,
  playerCount,
  seed = 1,
  noShowRate = 0.02,
  doubleForfeitShare = 0.15,
  baseDrawRate = 0.12,
  roundDays = 14,
  startDate = '2026-10-05T09:00:00.000Z',
  stopAt = null
}) {
  const rng = makeRng(seed);
  const { players, ratings } = generateRoster(playerCount, rng);
  const roster = { players };

  let clock = new Date(startDate).getTime();
  const at = () => new Date(clock).toISOString();

  const started = startTournament({ tournament: config, roster, now: at() });
  const engine = started.engine;
  let tournament = started.tournament;
  let overrides = { overrides: [] };
  const rounds = [];

  while (tournament.phase !== 'complete') {
    const round = tournament.currentRound;
    const info = getRoundInfo(engine, round);
    const stats = { number: round, label: info.label, bestOf: info.bestOf, matches: 0, games: 0, forfeits: 0, maxGamesPerPlayer: 0 };
    const gamesByPlayer = new Map();
    let needForce = false;

    const pendingMatches = getUnresolvedMatches(engine, round);
    const stopHere = stopAt?.round === round;
    const playable = stopHere ? Math.floor(pendingMatches.length * stopAt.resolvedShare) : pendingMatches.length;

    for (const match of pendingMatches.slice(0, playable)) {
      stats.matches++;
      if (rng() < noShowRate) {
        const isSwiss = info.phase === 'stage-one';
        const outcome =
          isSwiss && rng() < doubleForfeitShare ? 'double_forfeit' : rng() < 0.5 ? 'player1_win' : 'player2_win';
        overrides.overrides.push({ matchId: match.id, outcome, applied: false, reason: 'simulated no-show' });
        needForce = true;
        stats.forfeits++;
        continue;
      }

      const { games, score } = simulateSeries(rng, ratings[match.player1.id], ratings[match.player2.id], info.bestOf, {
        baseDrawRate
      });
      applySeriesResult(engine, match.id, score, { games, meta: { source: 'simulated' } });
      stats.games += games.length;
      for (const id of [match.player1.id, match.player2.id]) gamesByPlayer.set(id, (gamesByPlayer.get(id) ?? 0) + games.length);
    }

    stats.maxGamesPerPlayer = Math.max(0, ...gamesByPlayer.values());
    rounds.push(stats);
    if (stopHere) break;

    clock += roundDays * DAY_MS;
    ({ tournament, overrides } = advance({ engine, tournament, overrides, force: needForce, now: at() }));
  }

  return { roster, ratings, engine, tournament, overrides, rounds, complete: tournament.phase === 'complete' };
}

/**
 * tournament-pairings shuffles the players with Math.random before every swiss
 * round (a fair draw in production, but it makes runs irreproducible), so
 * Math.random is seeded for the duration of a simulation. Match ids stay random
 * UUIDs; nothing depends on them.
 */
export function simulateTournament(options) {
  const original = Math.random;
  Math.random = makeRng(((options.seed ?? 1) ^ 0x9e3779b9) >>> 0);
  try {
    return playTournament(options);
  } finally {
    Math.random = original;
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

function spearman(xs, ys) {
  const rank = (values) => {
    const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(values.length);
    order.forEach(([, i], pos) => (ranks[i] = pos));
    return ranks;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const d2 = rx.reduce((sum, r, i) => sum + (r - ry[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

/**
 * Checks structural invariants of a finished tournament and computes quality
 * metrics of the format. `issues` must be empty for the run to count as valid.
 */
export function verifyTournament({ engine, tournament, roster, ratings, config, rounds }) {
  const issues = [];
  const check = (condition, message) => {
    if (!condition) issues.push(message);
  };

  const n = roster.players.length;
  const format = resolveFormat(config, n);
  const lastSwiss = getLastSwissRound(engine);
  const finalRound = getFinalRound(engine);

  check(engine.getStatus() === 'complete' && tournament.phase === 'complete', 'el torneo no terminó en estado complete');
  check(lastSwiss === format.swissRounds, `rondas suizas: ${lastSwiss}, esperadas ${format.swissRounds}`);
  check(tournament.swissRounds === format.swissRounds, 'tournament.swissRounds no coincide con el motor');
  check(
    tournament.rounds.length === lastSwiss + Math.log2(format.playoffCutoff),
    `rondas registradas: ${tournament.rounds.length}, esperadas ${lastSwiss + Math.log2(format.playoffCutoff)}`
  );

  // --- Swiss: everyone plays once per round, no rematches, byes handled ---
  const seenPairs = new Set();
  const byes = new Map();
  const pointsBefore = new Map(roster.players.map((p) => [p.id, 0]));
  for (let r = 1; r <= lastSwiss; r++) {
    const seen = new Set();
    let byeMatches = 0;
    for (const m of engine.getMatchesByRound(r)) {
      const ids = m.bye ? [m.player1.id] : [m.player1.id, m.player2.id];
      for (const id of ids) {
        check(!seen.has(id), `ronda ${r}: ${id} aparece dos veces`);
        seen.add(id);
      }
      if (m.bye) {
        byeMatches++;
        // Play! Pokémon rule: from round 2 on the bye goes to the worst record among players who haven't had one.
        if (r > 1) {
          const worst = Math.min(...roster.players.filter((p) => !byes.has(p.id)).map((p) => pointsBefore.get(p.id)));
          check(
            !byes.has(m.player1.id) && pointsBefore.get(m.player1.id) === worst,
            `ronda ${r}: el bye fue a alguien con ${pointsBefore.get(m.player1.id)} puntos, pero el peor récord sin bye tenía ${worst}`
          );
        }
        byes.set(m.player1.id, (byes.get(m.player1.id) ?? 0) + 1);
      } else {
        const key = ids.slice().sort().join('|');
        check(!seenPairs.has(key), `ronda ${r}: repetición de emparejamiento ${key}`);
        seenPairs.add(key);
      }
    }
    check(seen.size === n, `ronda ${r}: juegan ${seen.size} de ${n} jugadores`);
    check(byeMatches === n % 2, `ronda ${r}: ${byeMatches} byes, esperados ${n % 2}`);

    for (const m of engine.getMatchesByRound(r)) {
      if (m.bye) pointsBefore.set(m.player1.id, pointsBefore.get(m.player1.id) + 1);
      else if (m.player1.win !== m.player2.win) {
        const winner = m.player1.win > m.player2.win ? m.player1.id : m.player2.id;
        pointsBefore.set(winner, pointsBefore.get(winner) + 1);
      }
    }
  }
  for (const [id, count] of byes) check(count <= 1, `${id} recibió ${count} byes`);

  // --- Every recorded series is consistent with its rules ---
  for (const m of engine.getMatches()) {
    if (m.bye || m.active) continue;
    const info = getRoundInfo(engine, m.round);
    const need = winsNeeded(info.bestOf);
    if (!m.player1.id || !m.player2.id) continue;
    if (m.meta?.forfeit === 'double') {
      check(m.player1.win === 0 && m.player2.win === 0, `partida ${m.id}: un doble forfeit no puede tener victorias`);
      continue;
    }
    // Drawn games are replayed: every pairing has exactly one winner, who has exactly `need` wins.
    check(m.player1.win <= need && m.player2.win <= need, `partida ${m.id}: más victorias que las necesarias en un Bo${info.bestOf}`);
    check(m.player1.win !== m.player2.win, `partida ${m.id} (${info.label}) sin ganador: ${m.player1.win}-${m.player2.win}`);
    check(Math.max(m.player1.win, m.player2.win) === need, `partida ${m.id}: el ganador no tiene las ${need} victorias de un Bo${info.bestOf}`);
    if (m.meta?.games) {
      const s = scoreSeries(m.meta.games, info.bestOf);
      check(
        s.status === 'complete' && s.p1Wins === m.player1.win && s.p2Wins === m.player2.win && s.draws === m.player1.draw,
        `partida ${m.id}: el marcador no coincide con las partidas jugadas`
      );
    }
  }

  // --- Stage two: right qualifiers, standard seeding, right series lengths, one champion ---
  const swiss = getSwissStandings(engine);
  const seed = new Map(swiss.map((s, i) => [s.player.getId(), i + 1]));
  const qualifiers = new Set(swiss.slice(0, format.playoffCutoff).map((s) => s.player.getId()));

  const firstBracketRound = engine.getMatchesByRound(lastSwiss + 1);
  check(firstBracketRound.length === format.playoffCutoff / 2, `bracket: ${firstBracketRound.length} cruces en la primera ronda`);
  for (const m of firstBracketRound) {
    check(qualifiers.has(m.player1.id) && qualifiers.has(m.player2.id), 'bracket: entra un jugador que no estaba en el corte');
    check(
      seed.get(m.player1.id) + seed.get(m.player2.id) === format.playoffCutoff + 1,
      `bracket: cruce ${seed.get(m.player1.id)}-${seed.get(m.player2.id)} no respeta la siembra (1 vs ${format.playoffCutoff})`
    );
  }
  for (let r = lastSwiss + 1; r <= finalRound; r++) {
    const info = getRoundInfo(engine, r);
    const expected = info.roundsFromFinal <= 1 ? 5 : 3;
    check(info.bestOf === expected, `${info.label}: Bo${info.bestOf}, esperado Bo${expected}`);
    check(engine.getMatchesByRound(r).length === 2 ** info.roundsFromFinal, `${info.label}: número de cruces incorrecto`);
  }

  const finalMatch = engine.getMatchesByRound(finalRound)[0];
  const championId = finalMatch.player1.win > finalMatch.player2.win ? finalMatch.player1.id : finalMatch.player2.id;
  const ranking = getStandings(engine);
  check(ranking[0].player.getId() === championId, 'el primero de la clasificación final no es el ganador de la final');

  // --- Format quality metrics ---
  const ids = roster.players.map((p) => p.id);
  const eloOrder = ids.slice().sort((a, b) => ratings[b] - ratings[a]);
  const eloRank = new Map(eloOrder.map((id, i) => [id, i + 1]));
  const swissRank = ids.map((id) => seed.get(id));
  const points = swiss.map((s) => s.matchPoints);
  const cutoff = format.playoffCutoff;
  const tiedAtCutoff = points[cutoff - 1] === points[cutoff];

  const metrics = {
    players: n,
    swissRounds: lastSwiss,
    playoffCutoff: cutoff,
    totalRounds: tournament.rounds.length,
    champion: {
      name: engine.getPlayer(championId).getName(),
      rating: ratings[championId],
      ratingRank: eloRank.get(championId),
      swissSeed: seed.get(championId)
    },
    ratingVsSwissRankSpearman: Number(spearman(ids.map((id) => -ratings[id]), swissRank).toFixed(3)),
    topEloQualified: eloOrder.slice(0, cutoff).filter((id) => qualifiers.has(id)).length,
    undefeatedAfterSwiss: swiss.filter((s) => s.matchPoints === lastSwiss).length,
    tiedAtCutoffOnPoints: tiedAtCutoff,
    playersTiedWithCutoffLine: points.filter((p) => p === points[cutoff - 1]).length,
    pointsAtCutoff: points[cutoff - 1],
    forfeits: rounds.reduce((sum, r) => sum + r.forfeits, 0),
    totalGames: rounds.reduce((sum, r) => sum + r.games, 0),
    maxGamesPerPlayerInARound: Math.max(...rounds.map((r) => r.maxGamesPerPlayer)),
    gamesPerRound: rounds.map((r) => ({ round: r.label, bestOf: r.bestOf, matches: r.matches, games: r.games }))
  };

  return { issues, metrics };
}
