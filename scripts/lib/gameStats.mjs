// Per-game facts taken from chess.com's PGN/FEN (moves, playing time, material
// left) and the public leaderboards built from them. Pure functions, no I/O.
//
// The leaderboards only ever name the WINNER of a game: they are meant to be
// fun, not to point at whoever lost.

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Wins shorter than this (arranged results, misclicks) or by abandonment don't enter the speed/material records. */
export const MIN_MOVES_FOR_RECORDS = 5;
/** Wins needed before a player appears in the "fastest on average" ranking. */
export const MIN_WINS_FOR_AVERAGE = 2;
const TOP = 5;

export function parsePgnTags(pgn) {
  const tags = {};
  for (const m of String(pgn ?? '').matchAll(/^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm)) tags[m[1]] = m[2];
  return tags;
}

/** Half-moves played, from the PGN movetext (comments, clocks, move numbers and the result stripped). */
export function countPlies(pgn) {
  const movetext = String(pgn ?? '')
    .replace(/^\[.*\]\s*$/gm, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\$\d+/g, ' ');
  return movetext
    .split(/\s+/)
    .map((t) => t.replace(/^\d+\.+/, ''))
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)).length;
}

/** Remaining clock (seconds) after each half-move, from chess.com's `{[%clk h:mm:ss.s]}` comments. */
export function clockTimes(pgn) {
  return [...String(pgn ?? '').matchAll(/\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/g)].map(
    ([, h, m, s]) => Number(h) * 3600 + Number(m) * 60 + Number(s)
  );
}

function parseTimeControl(timeControl) {
  const m = /^(\d+)(?:\+(\d+))?$/.exec(String(timeControl ?? ''));
  return m ? { base: Number(m[1]), increment: Number(m[2] ?? 0) } : null; // daily games ("1/86400") have no clock
}

function parsePgnDate(date, time) {
  if (!date || !time) return null;
  const ms = Date.parse(`${date.replaceAll('.', '-')}T${time}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Seconds both players spent on the game. Preferably from the clocks (time used = base + increments - what
 * was left, per side), otherwise from the StartTime/EndTime tags.
 */
export function gameDuration(pgn, timeControl) {
  const tc = parseTimeControl(timeControl);
  const clocks = clockTimes(pgn);
  if (tc && clocks.length > 0) {
    let used = 0;
    for (const side of [0, 1]) {
      const own = clocks.filter((_, i) => i % 2 === side);
      if (own.length > 0) used += tc.base + tc.increment * own.length - own[own.length - 1];
    }
    return Math.max(0, Math.round(used));
  }
  const tags = parsePgnTags(pgn);
  const start = parsePgnDate(tags.UTCDate ?? tags.Date, tags.UTCTime ?? tags.StartTime);
  const end = parsePgnDate(tags.EndDate ?? tags.UTCDate ?? tags.Date, tags.EndTime);
  return start != null && end != null && end >= start ? Math.round((end - start) / 1000) : null;
}

/** Material on the board per side (pawn 1, knight/bishop 3, rook 5, queen 9), from a FEN. */
export function materialFromFen(fen) {
  const placement = String(fen ?? '').split(' ')[0];
  if (!placement) return null;
  const material = { white: 0, black: 0 };
  for (const ch of placement) {
    const value = PIECE_VALUES[ch.toLowerCase()];
    if (value === undefined) continue;
    material[ch === ch.toUpperCase() ? 'white' : 'black'] += value;
  }
  return material;
}

/**
 * What we keep of a chess.com game (stored in the match meta, so stats survive without re-querying chess.com).
 * `result` is 'p1' | 'p2' | 'draw' from the pairing's player1 point of view.
 */
export function describeGame(game, { result, p1IsWhite }) {
  const plies = game.pgn ? countPlies(game.pgn) : null;
  const loser = result === 'draw' ? game.white : (result === 'p1') === p1IsWhite ? game.black : game.white;
  return {
    url: game.url,
    endTime: game.endTime,
    result,
    p1Color: p1IsWhite ? 'white' : 'black',
    moves: plies == null ? null : Math.ceil(plies / 2),
    durationSec: game.pgn ? gameDuration(game.pgn, game.timeControl) : null,
    material: materialFromFen(game.fen),
    termination: loser.result
  };
}

/** Decisive games of the given matches (engine matches or plain objects with round, player1/2 and meta). */
export function winsFromMatches(matches) {
  const wins = [];
  for (const match of matches) {
    for (const g of match.meta?.chesscomGames ?? []) {
      if (g.result !== 'p1' && g.result !== 'p2') continue;
      const p1Won = g.result === 'p1';
      const winnerColor = p1Won === (g.p1Color === 'white') ? 'white' : 'black';
      wins.push({
        winnerId: p1Won ? match.player1.id : match.player2.id,
        round: match.round,
        endTime: g.endTime,
        moves: g.moves,
        durationSec: g.durationSec,
        material: g.material?.[winnerColor] ?? null,
        termination: g.termination
      });
    }
  }
  return wins;
}

const byEndTime = (a, b) => String(a.endTime).localeCompare(String(b.endTime));

/**
 * Public leaderboards. `player(id)` returns the public player reference, `roundLabel(n)` the round's name.
 * Records list games (winner only); rankings list players.
 */
export function buildStats(wins, { player, roundLabel }) {
  const eligible = wins.filter((w) => w.termination !== 'abandoned' && w.moves != null && w.moves >= MIN_MOVES_FOR_RECORDS);
  const record = (w) => ({
    player: player(w.winnerId),
    round: w.round,
    roundLabel: roundLabel(w.round),
    moves: w.moves,
    durationSec: w.durationSec,
    material: w.material
  });

  const fastestByMoves = [...eligible]
    .sort((a, b) => a.moves - b.moves || (a.durationSec ?? Infinity) - (b.durationSec ?? Infinity) || byEndTime(a, b))
    .slice(0, TOP)
    .map(record);
  const fastestByTime = eligible
    .filter((w) => w.durationSec != null)
    .sort((a, b) => a.durationSec - b.durationSec || a.moves - b.moves || byEndTime(a, b))
    .slice(0, TOP)
    .map(record);
  const mostMaterial = eligible
    .filter((w) => w.material != null)
    .sort((a, b) => b.material - a.material || a.moves - b.moves || byEndTime(a, b))
    .slice(0, TOP)
    .map(record);

  const perPlayer = new Map();
  for (const w of eligible) {
    if (!perPlayer.has(w.winnerId)) perPlayer.set(w.winnerId, []);
    perPlayer.get(w.winnerId).push(w);
  }
  const average = (list, key) => {
    const values = list.map((w) => w[key]).filter((v) => v != null);
    return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
  };
  const averages = [...perPlayer.entries()]
    .filter(([, list]) => list.length >= MIN_WINS_FOR_AVERAGE)
    .map(([id, list]) => ({
      player: player(id),
      wins: list.length,
      avgMoves: Math.round(average(list, 'moves') * 10) / 10,
      avgDurationSec: average(list, 'durationSec') == null ? null : Math.round(average(list, 'durationSec'))
    }));
  const fastestAverageByMoves = [...averages].sort((a, b) => a.avgMoves - b.avgMoves || b.wins - a.wins).slice(0, TOP);
  const fastestAverageByTime = averages
    .filter((a) => a.avgDurationSec != null)
    .sort((a, b) => a.avgDurationSec - b.avgDurationSec || b.wins - a.wins)
    .slice(0, TOP);

  const mates = new Map();
  for (const w of wins) if (w.termination === 'checkmated') mates.set(w.winnerId, (mates.get(w.winnerId) ?? 0) + 1);
  const mostCheckmates = [...mates.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP)
    .map(([id, checkmates]) => ({ player: player(id), checkmates }));

  return {
    gamesAnalyzed: wins.length,
    minMovesForRecords: MIN_MOVES_FOR_RECORDS,
    minWinsForAverage: MIN_WINS_FOR_AVERAGE,
    fastestByMoves,
    fastestByTime,
    fastestAverageByMoves,
    fastestAverageByTime,
    mostMaterial,
    mostCheckmates
  };
}
