// Tournament lifecycle (start, close round / advance) as pure state transitions:
// no file or git access, so the exact same code runs in production
// (advance-tournament.mjs) and in the simulator.
//
// Two pieces of state move together:
//   - the engine (tournament-organizer): pairings, results, standings;
//   - data/tournament.json: `phase`, `currentRound` and `rounds[]` with the date
//     window of each round, which the library doesn't model.
//
// Round numbering is the library's: swiss rounds are 1..swissRounds and the
// elimination rounds continue after them. Stage two has no library-level
// "next round", so `currentRound` there is ours: it only moves when the
// organizer advances, even though the library activates bracket matches as
// soon as both players are known.

import {
  createEngineTournament,
  getUnresolvedMatches,
  applyResult,
  applyDoubleForfeit,
  advanceRound,
  finishTournament,
  getFinalRound,
  getRoundInfo,
  getSeries
} from './tournamentEngine.mjs';

function roundEntry(engine, number, now) {
  const { phase, label, bestOf } = getRoundInfo(engine, number);
  return { number, phase, label, bestOf, startedAt: now, endedAt: null };
}

function describeMatch(match, engine) {
  const name = (id) => (id ? engine.getPlayer(id).getName() : '—');
  return `${name(match.player1.id)} vs ${name(match.player2.id)} (match ${match.id})`;
}

/**
 * Creates the engine tournament from the roster and opens round 1.
 * Also resolves the "auto" swiss rounds / playoff cutoff into concrete numbers
 * for the registered player count, and records them in tournament.json.
 */
export function startTournament({ tournament, roster, now = new Date().toISOString() }) {
  if (tournament.phase !== 'registration') {
    throw new Error(`No se puede iniciar: fase actual es "${tournament.phase}", no "registration".`);
  }
  const active = roster.players.filter((p) => p.status === 'active');
  if (active.length < tournament.playerCap.min) {
    throw new Error(`Faltan jugadores: ${active.length} registrados, mínimo ${tournament.playerCap.min}.`);
  }

  const engine = createEngineTournament(tournament, roster.players);
  engine.startTournament();

  const next = structuredClone(tournament);
  // Keep what was configured (possibly "auto") so a reset can restore it; swissRounds/playoffCutoff become concrete numbers.
  next.configured = { swissRounds: tournament.swissRounds, playoffCutoff: tournament.playoffCutoff };
  next.phase = 'stage-one';
  next.currentRound = engine.getRoundNumber();
  next.swissRounds = engine.getStageOne().rounds;
  next.playoffCutoff = { method: 'rank', value: engine.getStageTwo().advance.value };
  next.series = getSeries(engine);
  next.playerCount = active.length;
  next.rounds = [roundEntry(engine, next.currentRound, now)];
  return { engine, tournament: next };
}

const lower = (text) => String(text ?? '').trim().toLowerCase();

/** The chess.com username of an engine player (stored in the player's meta when the tournament starts). */
function usernameOf(engine, id) {
  return lower(engine.getPlayer(id).getMeta().chesscomUsername);
}

/**
 * Finds the unresolved match an overrides.json entry refers to. Entries can name the match by id, or by the
 * two chess.com usernames (much easier to write by hand):
 *   { "matchId": "...", "outcome": "player1_win" | "player2_win" | "double_forfeit" }
 *   { "winner": "adalovelace", "loser": "bob" }                      -> series win for the winner
 *   { "players": ["adalovelace", "bob"], "outcome": "double_forfeit" }
 * Returns { match, outcome } or null when nothing pending matches.
 */
function resolveOverride(ov, unresolved, engine) {
  if (ov.matchId) {
    const match = unresolved.find((m) => m.id === ov.matchId);
    return match && ov.outcome ? { match, outcome: ov.outcome } : null;
  }

  const names = (ov.winner ? [ov.winner, ov.loser] : (ov.players ?? [])).map(lower);
  if (names.length !== 2 || !names[0] || !names[1] || names[0] === names[1]) return null;
  const key = [...names].sort().join('|');
  const match = unresolved.find(
    (m) => !m.bye && [usernameOf(engine, m.player1.id), usernameOf(engine, m.player2.id)].sort().join('|') === key
  );
  if (!match) return null;
  if (ov.outcome) return { match, outcome: ov.outcome };
  if (!ov.winner) return null;
  return { match, outcome: usernameOf(engine, match.player1.id) === names[0] ? 'player1_win' : 'player2_win' };
}

/**
 * Applies the organizer's not-yet-applied overrides.json entries to the unresolved matches of the current
 * round, without advancing anything. Entries that match nothing pending (typo in a username or id, already
 * resolved, other round...) are left untouched, still `applied: false`, and reported in `skipped`.
 *
 * @returns {{ overrides, applied: number, skipped: object[] }} a new overrides object; `engine` is mutated in place.
 */
export function applyPendingOverrides({ engine, tournament, overrides }) {
  const next = structuredClone(overrides ?? { overrides: [] });
  let unresolved = getUnresolvedMatches(engine, tournament.currentRound);
  let applied = 0;

  for (const ov of next.overrides) {
    if (ov.applied) continue;
    const found = resolveOverride(ov, unresolved, engine);
    if (!found) continue;

    const { match, outcome } = found;
    const meta = { source: 'override', outcome, ...(ov.reason ? { reason: ov.reason } : {}) };
    try {
      if (outcome === 'double_forfeit') applyDoubleForfeit(engine, match, { meta });
      else applyResult(engine, match.id, outcome, { meta });
    } catch (err) {
      throw new Error(`Override de la partida ${match.id} (${describeMatch(match, engine)}): ${err.message}`);
    }
    ov.applied = true;
    applied++;
    unresolved = unresolved.filter((m) => m.id !== match.id);
  }
  return { overrides: next, applied, skipped: next.overrides.filter((o) => !o.applied) };
}

/**
 * Closes the current round and opens the next one (or finishes the tournament).
 *
 * With `force`, first applies any not-yet-applied entry of `overrides` to the
 * unresolved matches of the current round. Throws, leaving the caller's data
 * untouched, if some match is still unresolved afterwards.
 *
 * @returns {{ tournament, overrides, finished: boolean }} new copies; `engine` is mutated in place.
 */
export function advance({ engine, tournament, overrides, force = false, now = new Date().toISOString() }) {
  if (tournament.phase !== 'stage-one' && tournament.phase !== 'stage-two') {
    throw new Error(`No hay ronda que avanzar en fase "${tournament.phase}".`);
  }
  const nextTournament = structuredClone(tournament);
  let nextOverrides = structuredClone(overrides ?? { overrides: [] });
  const round = nextTournament.currentRound;

  if (force) ({ overrides: nextOverrides } = applyPendingOverrides({ engine, tournament: nextTournament, overrides: nextOverrides }));
  const unresolved = getUnresolvedMatches(engine, round);

  if (unresolved.length > 0) {
    const list = unresolved.map((m) => describeMatch(m, engine)).join('\n  - ');
    const hint = force
      ? 'Añade una entrada en data/overrides.json para cada partida pendiente (por usuarios de chess.com o por matchId) y vuelve a intentarlo.'
      : 'Espera a que se resuelvan vía sync-results, o repite con action=force-next-round tras añadir overrides.';
    throw new Error(`Hay ${unresolved.length} partida(s) sin resolver:\n  - ${list}\n${hint}`);
  }

  const closing = nextTournament.rounds.find((r) => r.number === round);
  if (closing) closing.endedAt = now;

  let finished = false;
  if (nextTournament.phase === 'stage-one') {
    advanceRound(engine); // pairs the next swiss round, or builds the bracket after the last one
    nextTournament.phase = engine.getStatus();
    nextTournament.currentRound = engine.getRoundNumber();
  } else if (round === getFinalRound(engine)) {
    finishTournament(engine);
    nextTournament.phase = 'complete';
    finished = true;
  } else {
    nextTournament.currentRound = round + 1;
  }

  if (!finished) nextTournament.rounds.push(roundEntry(engine, nextTournament.currentRound, now));
  return { tournament: nextTournament, overrides: nextOverrides, finished };
}
