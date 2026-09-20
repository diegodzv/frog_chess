// Wraps the `tournament-organizer` npm package (swiss + single-elimination engine).
// Every call into the library goes through this file so a future swap to a
// different pairing engine only touches this one module.
//
// Behaviour of tournament-organizer 4.1.1 that this module relies on (verified
// by reading its source and by dev/spike-tournament-organizer.mjs):
//   - `Manager` is the package's default export.
//   - `nextRound()` only works in stage one. When the last swiss round is
//     closed it moves the top `advance.value` players (by standings) into a
//     single-elimination bracket, creating ALL bracket matches up front. Their
//     `round` numbers continue after the swiss ones (swissRounds + 1 ...).
//   - In stage two there is no `nextRound()`: `enterResult()` fills the next
//     bracket match by itself. `tournament.round` stays at the first bracket
//     round, and the status never becomes 'complete' unless `endTournament()`
//     is called. Round-by-round control in stage two is therefore ours (see
//     tournamentFlow.mjs).
//   - `scoring.bestOf` is a single, mutable, tournament-wide setting that
//     `enterResult()` validates against (max wins = round(bestOf / 2)). To play
//     Bo3 early and Bo5 in the semis/final we set it per match before entering
//     each result.

import Manager from 'tournament-organizer';
import { DEFAULT_SERIES, bestOfFor, bracketRoundLabel, winsNeeded, walkoverScore } from './series.mjs';

// Chess.com results give no rating tie-break of their own, so break points ties
// with opponents' strength (median Buchholz), then who beat the stronger
// opponents, then the game-level differential inside the series.
export const DEFAULT_TIEBREAKS = ['median buchholz', 'sonneborn berger', 'game win differential'];

const MIN_PLAYOFF_SIZE = 4; // we always want semifinals and a final
const MAX_PLAYOFF_SIZE = 16;

/** Swiss rounds needed to (mostly) separate `playerCount` players: ceil(log2(n)). */
export function autoSwissRounds(playerCount) {
  return Math.max(1, Math.ceil(Math.log2(playerCount)));
}

/** Largest power of two <= n/2, clamped to [4, 16] and never above the player count. */
export function autoPlayoffCutoff(playerCount) {
  let size = MIN_PLAYOFF_SIZE;
  while (size * 2 <= playerCount / 2 && size * 2 <= MAX_PLAYOFF_SIZE) size *= 2;
  return Math.min(size, playerCount);
}

function isPowerOfTwo(n) {
  return Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;
}

/**
 * Resolves the "auto" values of data/tournament.json for a concrete number of
 * players. Explicit numbers in the config win over the automatic ones.
 */
export function resolveFormat(config, playerCount) {
  const swissRounds =
    typeof config.swissRounds === 'number' ? config.swissRounds : autoSwissRounds(playerCount);
  const cutoffValue = config.playoffCutoff?.value;
  const playoffCutoff = typeof cutoffValue === 'number' ? cutoffValue : autoPlayoffCutoff(playerCount);

  if (!isPowerOfTwo(playoffCutoff)) {
    throw new Error(`El corte de playoffs debe ser potencia de 2 (recibido: ${playoffCutoff}).`);
  }
  if (playoffCutoff > playerCount) {
    throw new Error(`El corte de playoffs (${playoffCutoff}) supera el número de jugadores (${playerCount}).`);
  }
  return { swissRounds, playoffCutoff };
}

/** Builds the settings object tournament-organizer expects from our data/tournament.json config. */
function buildSettings(config, format, series) {
  return {
    seating: false,
    sorting: 'none',
    scoring: {
      bestOf: series.swiss,
      win: 1,
      draw: 0.5,
      loss: 0,
      bye: 1,
      tiebreaks: config.tiebreaks ?? DEFAULT_TIEBREAKS
    },
    stageOne: {
      format: 'swiss',
      rounds: format.swissRounds,
      initialRound: 1,
      maxPlayers: 0
    },
    stageTwo: {
      format: 'single-elimination',
      consolation: false,
      advance: {
        value: format.playoffCutoff,
        method: 'rank'
      }
    },
    meta: { series }
  };
}

/** Creates a brand-new tournament and registers all active players. `players` is the data/players.json array. */
export function createEngineTournament(config, players) {
  const active = players.filter((p) => p.status === 'active');
  const format = resolveFormat(config, active.length);
  const series = { ...DEFAULT_SERIES, ...config.series };

  const manager = new Manager();
  const tournament = manager.createTournament(config.name, buildSettings(config, format, series), config.name);
  for (const player of active) {
    const created = tournament.createPlayer(player.name, player.id);
    created.meta = { ...created.meta, chesscomUsername: player.chesscomUsername };
  }
  return tournament;
}

/** Rehydrates a Tournament instance from a previously-saved data/engine-state.json. */
export function loadEngineTournament(json) {
  const manager = new Manager();
  return manager.loadTournament(json);
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeysDeep(value[key])])
    );
  }
  return value;
}

/** Serializes a Tournament to a stable, git-diff-friendly JSON string (keys sorted at every depth). */
export function saveEngineTournament(tournament) {
  return `${JSON.stringify(sortKeysDeep(tournament.getValues()), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Round / series structure
// ---------------------------------------------------------------------------

export function getSeries(tournament) {
  return tournament.getValues().meta.series ?? DEFAULT_SERIES;
}

/** Last swiss round number (bracket rounds are numbered after it). */
export function getLastSwissRound(tournament) {
  const { rounds, initialRound } = tournament.getStageOne();
  return rounds + initialRound - 1;
}

/** Round number of the final. Only meaningful once the bracket exists (all its matches are created up front). */
export function getFinalRound(tournament) {
  return Math.max(...tournament.getMatches().map((m) => m.round));
}

/** Phase ('stage-one' | 'stage-two'), label and series length of a given round number. */
export function getRoundInfo(tournament, round) {
  const series = getSeries(tournament);
  if (round <= getLastSwissRound(tournament)) {
    return { phase: 'stage-one', label: `Ronda ${round}`, bestOf: series.swiss, roundsFromFinal: null };
  }
  const roundsFromFinal = getFinalRound(tournament) - round;
  return {
    phase: 'stage-two',
    label: bracketRoundLabel(roundsFromFinal),
    bestOf: bestOfFor({ phase: 'stage-two', roundsFromFinal }, series),
    roundsFromFinal
  };
}

/** Matches still needing a result. Pass `round` to restrict to one round (stage two can have several active at once). */
export function getUnresolvedMatches(tournament, round) {
  const active = tournament.getActiveMatches();
  return round == null ? active : active.filter((m) => m.round === round);
}

// ---------------------------------------------------------------------------
// Recording results
// ---------------------------------------------------------------------------

/**
 * Records the outcome of a pairing as a series score (`p1Wins`/`p2Wins`/`draws`
 * are GAME counts, from the point of view of the pairing's player1). Sets the
 * tournament-wide bestOf to this match's series length first, because the
 * library validates the score against it. `games` (optional) is stored in the
 * match meta so the UI can show the game-by-game sequence.
 */
export function applySeriesResult(tournament, matchId, { p1Wins, p2Wins, draws = 0 }, { games, meta } = {}) {
  const match = tournament.getMatch(matchId);
  const { bestOf } = getRoundInfo(tournament, match.round);
  const need = winsNeeded(bestOf);
  // Drawn games never count and are replayed, so every pairing has exactly one winner with `need` wins.
  if (Math.max(p1Wins, p2Wins) !== need || p1Wins === p2Wins) {
    throw new Error(`Una serie al mejor de ${bestOf} se gana con ${need} victorias y no admite empate (recibido ${p1Wins}-${p2Wins}).`);
  }
  tournament.set({ scoring: { bestOf } });
  tournament.enterResult(matchId, p1Wins, p2Wins, draws);
  const extra = { ...meta, ...(games ? { games } : {}) };
  if (Object.keys(extra).length > 0) match.set({ meta: extra });
}

const OUTCOME_TO_WINNER = {
  a_win: 'p1',
  b_win: 'p2',
  player1_win: 'p1',
  player2_win: 'p2'
};

/**
 * Applies a resolved result without game detail. `outcome` is either a
 * resultMatcher outcome ('a_win'|'b_win', where 'a' is the match's player1) or
 * an overrides.json outcome ('player1_win'|'player2_win'), recorded as a
 * straight series win (e.g. 2-0 in a Bo3). There is no draw outcome: a drawn
 * game is replayed.
 */
export function applyResult(tournament, matchId, outcome, opts) {
  if (outcome === 'draw') {
    throw new Error('Un encuentro no puede acabar en tablas: las tablas se repiten hasta que alguien gane la serie.');
  }
  const winner = OUTCOME_TO_WINNER[outcome];
  if (!winner) throw new Error(`Unknown match outcome: ${outcome}`);
  const match = tournament.getMatch(matchId);
  const { bestOf } = getRoundInfo(tournament, match.round);
  applySeriesResult(tournament, matchId, walkoverScore(winner, bestOf), opts);
}

/**
 * Applies a double forfeit to a swiss pairing: both players are recorded with a
 * lost series (0 points each). tournament-organizer's own `assignLoss()` can't
 * do this for both players of the same match (it throws "No player found with
 * ID null" on the second call), so the loss is written directly.
 */
export function applyDoubleForfeit(tournament, match, opts = {}) {
  const { bestOf, phase } = getRoundInfo(tournament, match.round);
  if (phase !== 'stage-one') {
    throw new Error('El doble forfeit solo existe en la fase suiza; en eliminatorias alguien tiene que avanzar.');
  }
  const lost = { win: 0, loss: winsNeeded(bestOf), draw: 0 };
  match.set({ active: false, player1: lost, player2: lost, meta: { forfeit: 'double', ...opts.meta } });
  tournament.getPlayer(match.player1.id).updateMatch(match.id, lost);
  tournament.getPlayer(match.player2.id).updateMatch(match.id, lost);
}

// ---------------------------------------------------------------------------
// Advancing
// ---------------------------------------------------------------------------

/**
 * Closes the current swiss round: pairs the next one or, after the last swiss
 * round, builds the elimination bracket. Throws if matches are still active.
 * Not applicable to stage two (bracket matches advance by themselves).
 */
export function advanceRound(tournament) {
  if (tournament.getStatus() !== 'stage-one') {
    throw new Error('advanceRound solo aplica a la fase suiza; en eliminatorias los cruces avanzan al registrar resultados.');
  }
  tournament.nextRound();
}

/** Marks the tournament as finished (the library never does it by itself). */
export function finishTournament(tournament) {
  tournament.endTournament();
}

/** Full standings. In stage two / complete this is the elimination ranking (champion, finalist, ...) then the rest. */
export function getStandings(tournament) {
  return tournament.getStatus() === 'stage-one' ? tournament.getStageOneStandings() : tournament.getStandings();
}

/** Swiss-only standings (frozen at the end of stage one, live while it is running). */
export function getSwissStandings(tournament) {
  return tournament.getStageOneStandings();
}
