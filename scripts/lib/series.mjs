// Match-series rules (best-of-N) shared by the engine wrapper, the simulator
// and, eventually, the chess.com result matcher. Pure functions, no I/O.
//
// A "pairing" is a series of chess.com games between the same two players.
// Rules encoded here:
//   - The series ends as soon as one player reaches `winsNeeded(bestOf)` wins
//     (2 in a "Bo3", 3 in a "Bo5"). There are no drawn pairings, ever.
//   - A drawn game scores for nobody: another game is played. So a "Bo3" can
//     take more than 3 games when there are draws; only wins are counted.

export const DEFAULT_SERIES = Object.freeze({ swiss: 3, elimination: 3, semifinal: 5, final: 5 });

/** Wins required to take a best-of-N series (2 for Bo3, 3 for Bo5). */
export function winsNeeded(bestOf) {
  return Math.ceil(bestOf / 2);
}

/**
 * Series length for a pairing. `roundsFromFinal` only matters in elimination:
 * 0 = final, 1 = semifinals, anything else = earlier rounds.
 */
export function bestOfFor({ phase, roundsFromFinal }, series = DEFAULT_SERIES) {
  if (phase !== 'stage-two') return series.swiss;
  if (roundsFromFinal === 0) return series.final;
  if (roundsFromFinal === 1) return series.semifinal;
  return series.elimination;
}

/** Spanish label of an elimination round, counted back from the final. */
export function bracketRoundLabel(roundsFromFinal) {
  switch (roundsFromFinal) {
    case 0:
      return 'Final';
    case 1:
      return 'Semifinales';
    case 2:
      return 'Cuartos de final';
    case 3:
      return 'Octavos de final';
    case 4:
      return 'Dieciseisavos de final';
    default:
      return `Ronda de ${2 ** (roundsFromFinal + 1)}`;
  }
}

/**
 * Scores a sequence of games. Each game is 'p1' | 'p2' | 'draw' (from the
 * point of view of the pairing's player1). Games played after the series was
 * already decided are ignored.
 *
 * @returns {{ p1Wins, p2Wins, draws, played, status, winner }}
 *   status: 'in_progress' | 'complete'
 *   winner: 'p1' | 'p2' once complete, otherwise null
 */
export function scoreSeries(games, bestOf) {
  const need = winsNeeded(bestOf);
  let p1Wins = 0;
  let p2Wins = 0;
  let draws = 0;
  let played = 0;

  for (const game of games) {
    if (p1Wins >= need || p2Wins >= need) break;
    played++;
    if (game === 'p1') p1Wins++;
    else if (game === 'p2') p2Wins++;
    else draws++;
  }

  const complete = p1Wins >= need || p2Wins >= need;
  return {
    p1Wins,
    p2Wins,
    draws,
    played,
    status: complete ? 'complete' : 'in_progress',
    winner: complete ? (p1Wins > p2Wins ? 'p1' : 'p2') : null
  };
}

/** Series score used when an organizer records a result without individual games (forfeit, walkover). */
export function walkoverScore(winner, bestOf) {
  const need = winsNeeded(bestOf);
  if (winner === 'p1') return { p1Wins: need, p2Wins: 0, draws: 0 };
  if (winner === 'p2') return { p1Wins: 0, p2Wins: need, draws: 0 };
  throw new Error(`Un encuentro no puede acabar sin ganador (recibido: ${winner}).`);
}
