import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { findSeriesForPairing } from '../lib/resultMatcher.mjs';
import { _resetCache } from '../lib/chesscomClient.mjs';

const originalFetch = globalThis.fetch;
const toEpochSeconds = (iso) => Math.floor(new Date(iso).getTime() / 1000);

beforeEach(() => {
  _resetCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockGames(games) {
  globalThis.fetch = async () => Response.json({ games });
}

const CODES = {
  win: ['win', 'checkmated'],
  loss: ['resigned', 'win'],
  draw: ['agreed', 'agreed']
};

let nextId = 1;
/** A game in chess.com's archive format. `outcome` is from WHITE's point of view: 'win' | 'loss' | 'draw'. */
function game(white, black, outcome, endIso, extra = {}) {
  const [w, b] = CODES[outcome];
  return {
    url: `https://www.chess.com/game/live/${nextId++}`,
    end_time: toEpochSeconds(endIso),
    time_class: 'blitz',
    rules: 'chess',
    rated: true,
    white: { username: white, result: w },
    black: { username: black, result: b },
    ...extra
  };
}

const baseArgs = {
  usernameA: 'adalovelace',
  usernameB: 'carlbot',
  bestOf: 1,
  timeClass: 'blitz',
  rules: 'chess',
  windowStart: '2026-11-09T07:00:00Z',
  windowEnd: '2026-11-15T22:59:59Z'
};

test('Bo1: a win for A (white) completes the pairing', async () => {
  mockGames([game('adalovelace', 'carlbot', 'win', '2026-11-10T18:00:00Z')]);
  const r = await findSeriesForPairing(baseArgs);
  assert.equal(r.status, 'complete');
  assert.equal(r.winner, 'p1');
  assert.deepEqual(r.score, { p1Wins: 1, p2Wins: 0, draws: 0 });
  assert.equal(r.games.length, 1);
  assert.equal(r.games[0].result, 'p1');
  assert.equal(r.games[0].p1Color, 'white');
  assert.equal(r.games[0].termination, 'checkmated', 'the loser result code');
});

test('Bo1: a win for B when B played white', async () => {
  mockGames([game('carlbot', 'adalovelace', 'win', '2026-11-10T18:00:00Z')]);
  const r = await findSeriesForPairing(baseArgs);
  assert.equal(r.status, 'complete');
  assert.equal(r.winner, 'p2');
  assert.deepEqual(r.score, { p1Wins: 0, p2Wins: 1, draws: 0 });
  assert.equal(r.games[0].p1Color, 'black');
});

test('Bo1: a single draw leaves the pairing in progress (replay or coin toss)', async () => {
  mockGames([game('adalovelace', 'carlbot', 'draw', '2026-11-10T18:00:00Z')]);
  const r = await findSeriesForPairing(baseArgs);
  assert.equal(r.status, 'in_progress');
  assert.deepEqual(r.games.map((g) => g.result), ['draw']);
});

test('Bo1: a draw and then a win completes it with the draw recorded', async () => {
  mockGames([
    game('carlbot', 'adalovelace', 'loss', '2026-11-10T18:20:00Z'),
    game('adalovelace', 'carlbot', 'draw', '2026-11-10T18:00:00Z')
  ]);
  const r = await findSeriesForPairing(baseArgs);
  assert.equal(r.status, 'complete');
  assert.deepEqual(r.score, { p1Wins: 1, p2Wins: 0, draws: 1 });
  assert.deepEqual(r.games.map((g) => g.result), ['draw', 'p1'], 'chronological, whatever the archive order');
});

test('Bo3: games after the series is decided are ignored', async () => {
  mockGames([
    game('adalovelace', 'carlbot', 'win', '2026-11-10T18:00:00Z'),
    game('carlbot', 'adalovelace', 'win', '2026-11-10T18:15:00Z'),
    game('adalovelace', 'carlbot', 'win', '2026-11-10T18:30:00Z'),
    game('carlbot', 'adalovelace', 'win', '2026-11-10T18:45:00Z')
  ]);
  const r = await findSeriesForPairing({ ...baseArgs, bestOf: 3 });
  assert.equal(r.status, 'complete');
  assert.deepEqual(r.score, { p1Wins: 2, p2Wins: 1, draws: 0 });
  assert.equal(r.games.length, 3);
  assert.equal(r.ignored, 1);
});

test('Bo3: one win each is still in progress', async () => {
  mockGames([
    game('adalovelace', 'carlbot', 'win', '2026-11-10T18:00:00Z'),
    game('adalovelace', 'carlbot', 'loss', '2026-11-10T18:15:00Z')
  ]);
  const r = await findSeriesForPairing({ ...baseArgs, bestOf: 3 });
  assert.equal(r.status, 'in_progress');
  assert.deepEqual(r.score, { p1Wins: 1, p2Wins: 1, draws: 0 });
});

test('no games between the two inside the window -> not_found', async () => {
  mockGames([
    game('adalovelace', 'carlbot', 'win', '2026-11-08T18:00:00Z'), // before the round
    game('adalovelace', 'someoneelse', 'win', '2026-11-10T18:00:00Z')
  ]);
  const r = await findSeriesForPairing(baseArgs);
  assert.equal(r.status, 'not_found');
  assert.deepEqual(r.wrongFormat, []);
});

test('games with the wrong time class, variant or unrated (when rated is required) never count, but are reported', async () => {
  mockGames([
    game('adalovelace', 'carlbot', 'win', '2026-11-10T18:00:00Z', { time_class: 'rapid' }),
    game('adalovelace', 'carlbot', 'win', '2026-11-10T18:10:00Z', { rules: 'chess960' }),
    game('adalovelace', 'carlbot', 'win', '2026-11-10T18:20:00Z', { rated: false })
  ]);
  const r = await findSeriesForPairing({ ...baseArgs, requireRated: true });
  assert.equal(r.status, 'not_found');
  assert.deepEqual(r.wrongFormat.map((g) => g.timeClass), ['rapid', 'blitz', 'blitz']);
});

test('usernames match case-insensitively', async () => {
  mockGames([game('AdaLovelace', 'CarlBot', 'win', '2026-11-10T18:00:00Z')]);
  const r = await findSeriesForPairing(baseArgs);
  assert.equal(r.status, 'complete');
});

test('inconsistent result codes -> inconsistent (needs review)', async () => {
  const g = game('adalovelace', 'carlbot', 'win', '2026-11-10T18:00:00Z');
  g.black.result = 'win';
  mockGames([g]);
  const r = await findSeriesForPairing(baseArgs);
  assert.equal(r.status, 'inconsistent');
});

test('the counted games carry the stats details from the PGN and FEN', async () => {
  mockGames([
    game('adalovelace', 'carlbot', 'win', '2026-11-10T18:00:00Z', {
      time_control: '360+2',
      pgn: '[Event "Live Chess"]\n\n1. e4 {[%clk 0:06:01.5]} 1... e5 {[%clk 0:06:00.9]} 2. Qh5 {[%clk 0:05:55]} 2... Ke7 {[%clk 0:05:50]} 3. Qxe5# {[%clk 0:05:52]} 1-0',
      fen: 'rnbq1bnr/ppppkppp/8/4Q3/4P3/8/PPPP1PPP/RNB1KBNR b KQ - 0 3'
    })
  ]);
  const r = await findSeriesForPairing(baseArgs);
  const [g] = r.games;
  assert.equal(g.moves, 3);
  assert.equal(g.durationSec, (360 + 6 - 352) + (360 + 4 - 350));
  assert.deepEqual(g.material, { white: 39, black: 38 });
});
