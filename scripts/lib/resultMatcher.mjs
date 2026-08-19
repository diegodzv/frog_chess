import { getPlayerGamesForMonth, monthsBetween } from './chesscomClient.mjs';

const WIN_CODES = new Set(['win']);
const LOSS_CODES = new Set([
  'checkmated',
  'resigned',
  'timeout',
  'abandoned',
  'lose',
  'kingofthehill',
  'threecheck'
]);
const DRAW_CODES = new Set([
  'agreed',
  'repetition',
  'stalemate',
  'insufficient',
  '50move',
  'timevsinsufficient'
]);

function classify(resultCode) {
  if (WIN_CODES.has(resultCode)) return 'win';
  if (LOSS_CODES.has(resultCode)) return 'loss';
  if (DRAW_CODES.has(resultCode)) return 'draw';
  return 'unknown';
}

/** True if the two sides' result codes describe one consistent outcome. */
function isConsistent(whiteClass, blackClass) {
  if (whiteClass === 'draw' && blackClass === 'draw') return true;
  if (whiteClass === 'win' && blackClass === 'loss') return true;
  if (whiteClass === 'loss' && blackClass === 'win') return true;
  return false;
}

function sameUser(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

/**
 * Finds the chess.com game played between two players within a round's date window.
 *
 * @returns one of:
 *   { status: 'resolved', outcome: 'a_win'|'b_win'|'draw', game }
 *   { status: 'not_found' }
 *   { status: 'ambiguous', candidates: [...] }
 *   { status: 'inconsistent', game }   // sides disagree on win/loss/draw class
 */
export async function findGameForPairing({
  usernameA,
  usernameB,
  timeClass,
  rules,
  requireRated = false,
  windowStart,
  windowEnd
}) {
  const months = monthsBetween(windowStart, windowEnd ?? new Date());
  const windowStartMs = new Date(windowStart).getTime();
  const windowEndMs = windowEnd ? new Date(windowEnd).getTime() : Date.now();

  const candidates = [];
  for (const { year, month } of months) {
    const games = await getPlayerGamesForMonth(usernameA, year, month);
    for (const game of games) {
      if (game.timeClass !== timeClass) continue;
      if (game.rules !== rules) continue;
      if (requireRated && !game.rated) continue;

      const isAB = sameUser(game.white.username, usernameA) && sameUser(game.black.username, usernameB);
      const isBA = sameUser(game.white.username, usernameB) && sameUser(game.black.username, usernameA);
      if (!isAB && !isBA) continue;

      const endTimeMs = new Date(game.endTime).getTime();
      if (endTimeMs < windowStartMs || endTimeMs > windowEndMs) continue;

      candidates.push({ game, aIsWhite: isAB });
    }
  }

  if (candidates.length === 0) return { status: 'not_found' };
  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      candidates: candidates.map((c) => ({ url: c.game.url, endTime: c.game.endTime }))
    };
  }

  const { game, aIsWhite } = candidates[0];
  const whiteClass = classify(game.white.result);
  const blackClass = classify(game.black.result);
  if (!isConsistent(whiteClass, blackClass)) {
    return { status: 'inconsistent', game };
  }

  const aClass = aIsWhite ? whiteClass : blackClass;
  const outcome = aClass === 'draw' ? 'draw' : aClass === 'win' ? 'a_win' : 'b_win';
  return { status: 'resolved', outcome, game };
}
