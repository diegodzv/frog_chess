import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countPlies,
  clockTimes,
  gameDuration,
  materialFromFen,
  describeGame,
  winsFromMatches,
  buildStats,
  MIN_MOVES_FOR_RECORDS,
  MIN_WINS_FOR_AVERAGE
} from '../lib/gameStats.mjs';

// Scholar's mate as chess.com publishes it (tags + clock comments).
const PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.11.10"]
[White "adalovelace"]
[Black "carlbot"]
[Result "1-0"]
[TimeControl "360+2"]
[StartTime "18:00:00"]
[EndDate "2026.11.10"]
[EndTime "18:02:10"]

1. e4 {[%clk 0:06:01.5]} 1... e5 {[%clk 0:06:00.9]} 2. Bc4 {[%clk 0:05:58]} 2... Nc6 {[%clk 0:05:55]} 3. Qh5 {[%clk 0:05:55]} 3... Nf6 {[%clk 0:05:40]} 4. Qxf7# {[%clk 0:05:50]} 1-0`;
const FEN = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';

test('countPlies ignores tags, clocks, move numbers and the result', () => {
  assert.equal(countPlies(PGN), 7);
  assert.equal(countPlies('1.e4 e5 2.Nf3 Nc6 1/2-1/2'), 4);
});

test('clockTimes reads every %clk in seconds', () => {
  assert.deepEqual(clockTimes(PGN), [361.5, 360.9, 358, 355, 355, 340, 350]);
});

test('gameDuration: from the clocks (base + increments - time left, per side)', () => {
  // White: 4 moves, 360 + 8 - 350 = 18 s. Black: 3 moves, 360 + 6 - 340 = 26 s.
  assert.equal(gameDuration(PGN, '360+2'), 44);
});

test('gameDuration: falls back to the StartTime/EndTime tags without clocks', () => {
  const noClocks = PGN.replace(/\{[^}]*\}/g, '');
  assert.equal(gameDuration(noClocks, '360+2'), 130);
  assert.equal(gameDuration('1. e4 e5 *', '360+2'), null);
});

test('materialFromFen counts pawn 1, minor 3, rook 5, queen 9 per side', () => {
  assert.deepEqual(materialFromFen(FEN), { white: 39, black: 38 });
  assert.deepEqual(materialFromFen('8/8/8/8/8/8/8/K6k w - - 0 1'), { white: 0, black: 0 });
});

test('describeGame keeps what the stats need, with the loser result as the termination', () => {
  const g = describeGame(
    {
      url: 'u',
      endTime: '2026-11-10T18:02:10.000Z',
      timeControl: '360+2',
      pgn: PGN,
      fen: FEN,
      white: { username: 'carlbot', result: 'checkmated' },
      black: { username: 'adalovelace', result: 'win' }
    },
    { result: 'p1', p1IsWhite: false }
  );
  assert.deepEqual(g, {
    url: 'u',
    endTime: '2026-11-10T18:02:10.000Z',
    result: 'p1',
    p1Color: 'black',
    moves: 4,
    durationSec: 44,
    material: { white: 39, black: 38 },
    termination: 'checkmated'
  });
});

test('winsFromMatches attributes each decisive game to its winner, with the winner material', () => {
  const match = {
    round: 2,
    player1: { id: 'A' },
    player2: { id: 'B' },
    meta: {
      chesscomGames: [
        { result: 'draw', p1Color: 'white', moves: 30, durationSec: 300, material: { white: 10, black: 10 }, termination: 'agreed' },
        { result: 'p2', p1Color: 'white', moves: 20, durationSec: 200, material: { white: 5, black: 25 }, termination: 'resigned' }
      ]
    }
  };
  assert.deepEqual(winsFromMatches([match]), [
    { winnerId: 'B', round: 2, endTime: undefined, moves: 20, durationSec: 200, material: 25, termination: 'resigned' }
  ]);
});

const ref = (id) => ({ id, name: `Jugador ${id}` });
const label = (n) => `Ronda ${n}`;
const win = (winnerId, moves, durationSec, material, termination = 'resigned', round = 1) => ({
  winnerId,
  round,
  endTime: `2026-11-1${round}T18:00:00Z`,
  moves,
  durationSec,
  material,
  termination
});

test('buildStats: records name only the winner and skip abandoned or too-short games', () => {
  const stats = buildStats(
    [
      win('A', 22, 400, 30),
      win('B', 18, 500, 20),
      win('C', 3, 30, 39), // arranged / misclick: too short
      win('D', 10, 60, 39, 'abandoned')
    ],
    { player: ref, roundLabel: label }
  );
  assert.equal(stats.fastestByMoves[0].player.id, 'B');
  assert.equal(stats.fastestByMoves[0].moves, 18);
  assert.equal(stats.fastestByTime[0].player.id, 'A');
  assert.equal(stats.mostMaterial[0].player.id, 'A');
  assert.equal(stats.mostMaterial[0].roundLabel, 'Ronda 1');
  assert.ok(stats.fastestByMoves.every((r) => r.player.id !== 'C' && r.player.id !== 'D'));
  assert.ok(MIN_MOVES_FOR_RECORDS > 3);
  assert.ok(!JSON.stringify(stats).includes('loser'));
});

test('buildStats: averages need a minimum number of wins and rank by mean moves / time', () => {
  const stats = buildStats(
    [win('A', 20, 300, 10), win('A', 30, 500, 10), win('B', 15, 200, 10), win('C', 40, 100, 10), win('C', 40, 100, 10)],
    { player: ref, roundLabel: label }
  );
  assert.equal(MIN_WINS_FOR_AVERAGE, 2);
  assert.deepEqual(stats.fastestAverageByMoves.map((r) => [r.player.id, r.avgMoves, r.wins]), [['A', 25, 2], ['C', 40, 2]]);
  assert.deepEqual(stats.fastestAverageByTime.map((r) => [r.player.id, r.avgDurationSec]), [['C', 100], ['A', 400]]);
});

test('buildStats: most checkmates counts mates per winner', () => {
  const stats = buildStats(
    [win('A', 20, 300, 10, 'checkmated'), win('A', 25, 300, 10, 'checkmated'), win('B', 20, 300, 10, 'checkmated'), win('B', 20, 300, 10)],
    { player: ref, roundLabel: label }
  );
  assert.deepEqual(stats.mostCheckmates.map((r) => [r.player.id, r.checkmates]), [['A', 2], ['B', 1]]);
});

test('buildStats with no games is empty but well-formed', () => {
  const stats = buildStats([], { player: ref, roundLabel: label });
  for (const key of ['fastestByMoves', 'fastestByTime', 'fastestAverageByMoves', 'fastestAverageByTime', 'mostMaterial', 'mostCheckmates']) {
    assert.deepEqual(stats[key], [], key);
  }
  assert.equal(stats.gamesAnalyzed, 0);
});
