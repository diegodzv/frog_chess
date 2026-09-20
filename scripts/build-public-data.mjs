#!/usr/bin/env node
// Pure derivation: data/tournament.json + data/players.json + data/engine-state.json
// -> data/public/*.json. Safe to run standalone (e.g. for local frontend dev)
// since it never talks to chess.com or mutates tournament state.
//
// Everything the frontend shows is computed here from the engine's own
// numbers (standings + tiebreaks come from tournament-organizer, not from
// re-deriving them), so the site can't disagree with how the bracket was seeded.

import { pathToFileURL } from 'node:url';
import { readJson, writePublicJson } from './lib/repoData.mjs';
import {
  loadEngineTournament,
  getSwissStandings,
  getLastSwissRound,
  getFinalRound,
  getRoundInfo,
  resolveFormat
} from './lib/tournamentEngine.mjs';

const isResolved = (m) =>
  !m.active && [m.player1, m.player2].some((p) => p.win + p.loss + p.draw > 0);

function playerRef(engine, id, seeds) {
  if (!id) return null;
  const p = engine.getPlayer(id);
  return { id, name: p.getName(), chesscomUsername: p.getMeta().chesscomUsername ?? null, seed: seeds.get(id) ?? null };
}

/** Series score of a pairing, from the point of view of its player1. */
function pairingScore(m) {
  return { p1: m.player1.win, p2: m.player2.win, draws: m.player1.draw };
}

function pairingWinner(m) {
  if (!isResolved(m)) return null;
  if (m.player1.win > m.player2.win) return 'p1';
  if (m.player2.win > m.player1.win) return 'p2';
  return null;
}

// The library activates a bracket match as soon as both feeders finish, but the
// round only opens when the organizer advances: until then it's 'waiting', not 'pending'.
function buildPairing(engine, m, seeds, currentRound) {
  const resolved = isResolved(m);
  const forfeit = m.meta?.forfeit ?? (m.meta?.source === 'override' ? m.meta.outcome : null);
  return {
    matchId: m.id,
    table: m.match,
    player1: playerRef(engine, m.player1.id, seeds),
    player2: m.bye ? null : playerRef(engine, m.player2.id, seeds),
    bye: Boolean(m.bye),
    status: m.bye ? 'bye' : resolved ? 'complete' : m.active && m.round <= currentRound ? 'pending' : 'waiting',
    score: resolved && !m.bye ? pairingScore(m) : null,
    winner: m.bye ? 'p1' : pairingWinner(m),
    games: m.meta?.games ?? null,
    // 'double' = nobody showed up; an override outcome means the organizer entered the result by hand.
    manual: forfeit ?? null
  };
}

/** Per-player aggregate over the swiss rounds: series record (wins/losses), game record and byes. */
function swissRecords(engine) {
  const lastSwiss = getLastSwissRound(engine);
  const records = new Map();
  const rec = (id) => {
    if (!records.has(id)) records.set(id, { win: 0, loss: 0, gameWin: 0, gameLoss: 0, gameDraw: 0, byes: 0 });
    return records.get(id);
  };
  for (const m of engine.getMatches()) {
    if (m.round > lastSwiss || m.active || !isResolved(m)) continue;
    if (m.bye) {
      rec(m.player1.id).win++;
      rec(m.player1.id).byes++;
      continue;
    }
    for (const [me, other] of [[m.player1, m.player2], [m.player2, m.player1]]) {
      const r = rec(me.id);
      // A pairing always has one winner; a double forfeit has none, and counts as a loss for both.
      if (me.win > me.loss) r.win++;
      else r.loss++;
      r.gameWin += me.win;
      r.gameLoss += me.loss;
      r.gameDraw += me.draw;
    }
  }
  return records;
}

/** How far each qualified player got in the bracket: 'Campeón', 'Finalista', 'Semifinales', ... */
function bracketOutcomes(engine, finalRound, lastSwiss) {
  const outcomes = new Map();
  for (const m of engine.getMatches()) {
    if (m.round <= lastSwiss || !isResolved(m)) continue;
    const { label } = getRoundInfo(engine, m.round);
    const winnerId = pairingWinner(m) === 'p1' ? m.player1.id : m.player2.id;
    const loserId = winnerId === m.player1.id ? m.player2.id : m.player1.id;
    outcomes.set(loserId, m.round === finalRound ? 'Finalista' : `Eliminado en ${label.toLowerCase()}`);
    if (m.round === finalRound) outcomes.set(winnerId, 'Campeón');
  }
  return outcomes;
}

function buildStandings({ tournament, engine, seeds, now }) {
  const cutoff = tournament.playoffCutoff?.value ?? null;
  const emptyResult = { updatedAt: now, phase: tournament.phase, round: tournament.currentRound, cutoff, rows: [] };
  if (!engine) return emptyResult;

  const records = swissRecords(engine);
  const lastSwiss = getLastSwissRound(engine);
  const finalRound = engine.getStatus() === 'stage-one' ? null : getFinalRound(engine);
  const outcomes = finalRound ? bracketOutcomes(engine, finalRound, lastSwiss) : new Map();
  const bracketStarted = engine.getStatus() !== 'stage-one';

  const rows = getSwissStandings(engine).map((s, i) => {
    const id = s.player.getId();
    const r = records.get(id) ?? { win: 0, loss: 0, gameWin: 0, gameLoss: 0, gameDraw: 0, byes: 0 };
    const qualified = cutoff != null && i < cutoff;
    return {
      rank: i + 1,
      playerId: id,
      name: s.player.getName(),
      chesscomUsername: s.player.getMeta().chesscomUsername ?? null,
      points: s.matchPoints,
      record: { win: r.win, loss: r.loss },
      games: { win: r.gameWin, loss: r.gameLoss, draw: r.gameDraw },
      byes: r.byes,
      buchholz: s.tiebreaks.medianBuchholz,
      sonnebornBerger: s.tiebreaks.sonnebornBerger,
      gameDiff: s.tiebreaks.gameWinDifferential,
      qualified,
      // Once the bracket exists: how far they got. Before that, `qualified` is only provisional.
      outcome: bracketStarted ? (outcomes.get(id) ?? (qualified ? 'En juego' : 'Eliminado en fase suiza')) : null
    };
  });

  return { ...emptyResult, rows };
}

function buildRounds({ tournament, engine, seeds, now }) {
  if (!engine) return { updatedAt: now, phase: tournament.phase, currentRound: tournament.currentRound, rounds: [] };
  const lastSwiss = getLastSwissRound(engine);

  const rounds = tournament.rounds.map((info) => {
    const matches = engine
      .getMatches()
      .filter((m) => m.round === info.number)
      .filter((m) => info.number <= lastSwiss || (m.player1.id && m.player2.id))
      .sort((a, b) => a.match - b.match);
    return {
      number: info.number,
      phase: info.phase,
      label: info.label ?? getRoundInfo(engine, info.number).label,
      bestOf: info.bestOf ?? getRoundInfo(engine, info.number).bestOf,
      startedAt: info.startedAt,
      endedAt: info.endedAt,
      current: info.number === tournament.currentRound && tournament.phase !== 'complete',
      pairings: matches.map((m) => buildPairing(engine, m, seeds, tournament.currentRound))
    };
  });

  return { updatedAt: now, phase: tournament.phase, currentRound: tournament.currentRound, rounds };
}

function buildBracket({ tournament, engine, seeds, now }) {
  const base = { updatedAt: now, phase: tournament.phase, size: null, champion: null, rounds: [] };
  if (!engine || (tournament.phase !== 'stage-two' && tournament.phase !== 'complete')) return base;

  const lastSwiss = getLastSwissRound(engine);
  const finalRound = getFinalRound(engine);
  const byRound = new Map();
  for (const m of engine.getMatches().filter((x) => x.round > lastSwiss)) {
    if (!byRound.has(m.round)) byRound.set(m.round, []);
    byRound.get(m.round).push(m);
  }

  const rounds = [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, matches]) => {
      const info = getRoundInfo(engine, number);
      return {
        round: number - lastSwiss,
        number,
        label: info.label,
        bestOf: info.bestOf,
        current: number === tournament.currentRound && tournament.phase !== 'complete',
        matches: matches
          .sort((a, b) => a.match - b.match)
          .map((m) => {
            const pairing = buildPairing(engine, m, seeds, tournament.currentRound);
            return { ...pairing, status: m.player1.id && m.player2.id ? pairing.status : 'waiting' };
          })
      };
    });

  const finalMatch = engine.getMatches().find((m) => m.round === finalRound);
  const winner = finalMatch && pairingWinner(finalMatch);
  const championId = winner === 'p1' ? finalMatch.player1.id : winner === 'p2' ? finalMatch.player2.id : null;

  return {
    ...base,
    size: (byRound.get(lastSwiss + 1) ?? []).length * 2,
    champion: championId ? playerRef(engine, championId, seeds) : null,
    rounds
  };
}

function buildPlayers(roster, now) {
  return {
    updatedAt: now,
    players: roster.players.map((p) => ({
      id: p.id,
      name: p.name,
      chesscomUsername: p.chesscomUsername,
      status: p.status
    }))
  };
}

/** Format the tournament would get with the players registered right now (swiss rounds and playoff size depend on it). */
function expectedFormat(tournament, playerCount) {
  try {
    return resolveFormat(tournament, playerCount);
  } catch {
    return null; // too few players to form a bracket yet
  }
}

function buildMeta({ tournament, roster, bracket, now }) {
  const playerCount = roster.players.filter((p) => p.status === 'active').length;
  const label = tournament.rounds.find((r) => r.number === tournament.currentRound)?.label ?? null;
  return {
    name: tournament.name,
    phase: tournament.phase,
    currentRound: tournament.currentRound,
    currentRoundLabel: label,
    swissRounds: typeof tournament.swissRounds === 'number' ? tournament.swissRounds : null,
    playoffCutoff: typeof tournament.playoffCutoff?.value === 'number' ? tournament.playoffCutoff.value : null,
    series: tournament.series ?? null,
    playerCount,
    expectedFormat: tournament.phase === 'registration' ? expectedFormat(tournament, playerCount) : null,
    playerCap: tournament.playerCap,
    champion: bracket.champion,
    updatedAt: now
  };
}

/**
 * Derives every public JSON file from the tournament state.
 * @returns {Record<string, object>} file name -> content
 */
export function derivePublicData({ tournament, roster, engineState, now = new Date().toISOString() }) {
  const engine = engineState ? loadEngineTournament(engineState) : null;

  // Seed = position in the swiss standings (what the bracket was drawn from).
  const seeds = new Map();
  if (engine && engine.getStatus() !== 'setup') {
    getSwissStandings(engine).forEach((s, i) => seeds.set(s.player.getId(), i + 1));
  }

  const ctx = { tournament, engine, seeds, now };
  const bracket = buildBracket(ctx);
  return {
    'meta.json': buildMeta({ tournament, roster, bracket, now }),
    'standings.json': buildStandings(ctx),
    'rounds.json': buildRounds(ctx),
    'bracket.json': bracket,
    'players.json': buildPlayers(roster, now)
  };
}

// `updatedAt` should only move when the content does; otherwise the hourly
// sync would commit (and redeploy the site) every hour even with nothing new.
function withStableTimestamp(next, previous) {
  if (!previous) return next;
  const strip = ({ updatedAt, ...rest }) => JSON.stringify(rest);
  return strip(previous) === strip(next) ? { ...next, updatedAt: previous.updatedAt } : next;
}

export async function buildPublicData() {
  const tournament = await readJson('tournament.json');
  const roster = await readJson('players.json');
  const engineState = await readJson('engine-state.json');

  const files = derivePublicData({ tournament, roster, engineState });
  for (const [name, content] of Object.entries(files)) {
    let previous = null;
    try {
      previous = await readJson(`public/${name}`);
    } catch {
      // first build: nothing to compare against
    }
    await writePublicJson(name, withStableTimestamp(content, previous));
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await buildPublicData();
}
