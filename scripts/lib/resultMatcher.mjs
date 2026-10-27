import { getPlayerGamesForMonth, monthsBetween } from './chesscomClient.mjs';
import { scoreSeries } from './series.mjs';
import { describeGame } from './gameStats.mjs';

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
 * Finds the games played between two players within a round's date window and scores them as a best-of-N
 * series (lib/series.mjs): in chronological order, draws count for nobody and games played after the series
 * was decided are ignored. Player A is the pairing's player1.
 *
 * Games between the two that don't match the tournament format (time class, variant, rated) never count;
 * they are only reported, so the organizer can tell "played, but with the wrong settings" from "not played".
 *
 * @returns one of:
 *   { status: 'complete', score: { p1Wins, p2Wins, draws }, winner: 'p1'|'p2', games, ignored }
 *   { status: 'in_progress', score, games }          // e.g. a single drawn game in a Bo1
 *   { status: 'not_found', wrongFormat: [...] }
 *   { status: 'inconsistent', game }                 // sides disagree on win/loss/draw
 * `games` are the counted games (describeGame records); `ignored` counts games after the decision.
 */
export async function findSeriesForPairing({
  usernameA,
  usernameB,
  bestOf,
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
  const wrongFormat = [];
  for (const { year, month } of months) {
    const games = await getPlayerGamesForMonth(usernameA, year, month);
    for (const game of games) {
      const isAB = sameUser(game.white.username, usernameA) && sameUser(game.black.username, usernameB);
      const isBA = sameUser(game.white.username, usernameB) && sameUser(game.black.username, usernameA);
      if (!isAB && !isBA) continue;

      const endTimeMs = new Date(game.endTime).getTime();
      if (endTimeMs < windowStartMs || endTimeMs > windowEndMs) continue;

      if (game.timeClass !== timeClass || game.rules !== rules || (requireRated && !game.rated)) {
        wrongFormat.push({ url: game.url, endTime: game.endTime, timeClass: game.timeClass, rules: game.rules, rated: game.rated });
        continue;
      }
      candidates.push({ game, aIsWhite: isAB });
    }
  }

  if (candidates.length === 0) return { status: 'not_found', wrongFormat };
  candidates.sort((x, y) => new Date(x.game.endTime) - new Date(y.game.endTime));

  const sequence = [];
  for (const { game, aIsWhite } of candidates) {
    const whiteClass = classify(game.white.result);
    const blackClass = classify(game.black.result);
    if (!isConsistent(whiteClass, blackClass)) return { status: 'inconsistent', game };
    const aClass = aIsWhite ? whiteClass : blackClass;
    sequence.push({ game, aIsWhite, result: aClass === 'draw' ? 'draw' : aClass === 'win' ? 'p1' : 'p2' });
  }

  const score = scoreSeries(sequence.map((s) => s.result), bestOf);
  const counted = sequence
    .slice(0, score.played)
    .map(({ game, aIsWhite, result }) => describeGame(game, { result, p1IsWhite: aIsWhite }));
  const { p1Wins, p2Wins, draws } = score;
  if (score.status !== 'complete') return { status: 'in_progress', score: { p1Wins, p2Wins, draws }, games: counted };
  return {
    status: 'complete',
    score: { p1Wins, p2Wins, draws },
    winner: score.winner,
    games: counted,
    ignored: sequence.length - score.played
  };
}
