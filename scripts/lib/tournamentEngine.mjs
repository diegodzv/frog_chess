// Wraps the `tournament-organizer` npm package (swiss + single-elimination engine).
// Every call into the library goes through this file so a future swap to a
// different pairing engine only touches this one module.
//
// NOTE: the exact stage-one -> stage-two transition trigger and the valid
// `tiebreaks` name strings are not fully documented upstream. Both are
// verified by scripts/dev/spike-tournament-organizer.mjs before this module
// is trusted in production (see Fase 1/2 of the plan). Until that spike has
// run, treat `advanceRound`'s stage-two behavior as unconfirmed.

import { Manager } from 'tournament-organizer';

/** Builds the settings object tournament-organizer expects from our data/tournament.json config. */
function buildSettings(config) {
  return {
    seating: false,
    sorting: 'none',
    scoring: {
      bestOf: 1,
      win: 1,
      draw: 0.5,
      loss: 0,
      bye: 1,
      tiebreaks: config.tiebreaks ?? []
    },
    stageOne: {
      format: 'swiss',
      rounds: config.swissRounds,
      initialRound: 1,
      maxPlayers: 0
    },
    stageTwo: {
      format: 'single-elimination',
      advance: {
        value: config.playoffCutoff.value,
        method: config.playoffCutoff.method
      }
    }
  };
}

/** Creates a brand-new tournament and registers all active players. `players` is the data/players.json array. */
export function createEngineTournament(config, players) {
  const manager = new Manager();
  const tournament = manager.createTournament(config.name, buildSettings(config), config.name);
  for (const player of players.filter((p) => p.status === 'active')) {
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

/** Matches still needing a result in the current round. */
export function getUnresolvedMatches(tournament) {
  return tournament.getActiveMatches();
}

const OUTCOME_TO_SCORE = {
  a_win: [1, 0, 0],
  b_win: [0, 1, 0],
  draw: [0, 0, 1],
  player1_win: [1, 0, 0],
  player2_win: [0, 1, 0]
};

/**
 * Applies a resolved result to a match. `outcome` is either a resultMatcher
 * outcome ('a_win'|'b_win'|'draw', where 'a' is the match's player1) or an
 * overrides.json outcome ('player1_win'|'player2_win'|'draw').
 */
export function applyResult(tournament, matchId, outcome) {
  const score = OUTCOME_TO_SCORE[outcome];
  if (!score) throw new Error(`Unknown match outcome: ${outcome}`);
  const [p1Wins, p2Wins, draws] = score;
  tournament.enterResult(matchId, p1Wins, p2Wins, draws);
}

/** Applies a double forfeit: both players get a loss for the round, no winner advances. */
export function applyDoubleForfeit(tournament, match) {
  tournament.assignLoss(match.player1.id, match.round);
  tournament.assignLoss(match.player2.id, match.round);
}

/** Advances to the next swiss round, or triggers the stage-two (elimination) bracket once swiss rounds are exhausted. */
export function advanceRound(tournament) {
  return tournament.nextRound();
}

export function getStandings(tournament) {
  return tournament.status === 'stage-one' ? tournament.getStageOneStandings() : tournament.getStandings();
}
