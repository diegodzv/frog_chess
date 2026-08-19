import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { findGameForPairing } from '../lib/resultMatcher.mjs';
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

const baseArgs = {
  usernameA: 'adalovelace',
  usernameB: 'carlbot',
  timeClass: 'rapid',
  rules: 'chess',
  windowStart: '2026-06-01T00:00:00Z',
  windowEnd: '2026-06-30T00:00:00Z'
};

test('resolves a clean win for player A (white)', async () => {
  mockGames([
    {
      url: 'https://www.chess.com/game/live/1',
      end_time: toEpochSeconds('2026-06-10T18:00:00Z'),
      time_class: 'rapid',
      rules: 'chess',
      rated: true,
      white: { username: 'adalovelace', result: 'win' },
      black: { username: 'carlbot', result: 'checkmated' }
    }
  ]);

  const result = await findGameForPairing(baseArgs);
  assert.equal(result.status, 'resolved');
  assert.equal(result.outcome, 'a_win');
});

test('resolves a win for player B when B played white', async () => {
  mockGames([
    {
      url: 'https://www.chess.com/game/live/2',
      end_time: toEpochSeconds('2026-06-10T18:00:00Z'),
      time_class: 'rapid',
      rules: 'chess',
      rated: true,
      white: { username: 'carlbot', result: 'win' },
      black: { username: 'adalovelace', result: 'resigned' }
    }
  ]);

  const result = await findGameForPairing(baseArgs);
  assert.equal(result.status, 'resolved');
  assert.equal(result.outcome, 'b_win');
});

test('resolves a draw', async () => {
  mockGames([
    {
      url: 'https://www.chess.com/game/live/3',
      end_time: toEpochSeconds('2026-06-10T18:00:00Z'),
      time_class: 'rapid',
      rules: 'chess',
      rated: true,
      white: { username: 'adalovelace', result: 'agreed' },
      black: { username: 'carlbot', result: 'agreed' }
    }
  ]);

  const result = await findGameForPairing(baseArgs);
  assert.equal(result.status, 'resolved');
  assert.equal(result.outcome, 'draw');
});

test('returns not_found when no candidate game exists', async () => {
  mockGames([]);
  const result = await findGameForPairing(baseArgs);
  assert.equal(result.status, 'not_found');
});

test('ignores a game just outside the round window', async () => {
  mockGames([
    {
      url: 'https://www.chess.com/game/live/4',
      end_time: toEpochSeconds('2026-07-01T00:00:01Z'), // 1s after windowEnd
      time_class: 'rapid',
      rules: 'chess',
      rated: true,
      white: { username: 'adalovelace', result: 'win' },
      black: { username: 'carlbot', result: 'resigned' }
    }
  ]);

  const result = await findGameForPairing(baseArgs);
  assert.equal(result.status, 'not_found');
});

test('flags multiple candidate games as ambiguous instead of guessing', async () => {
  mockGames([
    {
      url: 'https://www.chess.com/game/live/5',
      end_time: toEpochSeconds('2026-06-10T10:00:00Z'),
      time_class: 'rapid',
      rules: 'chess',
      rated: true,
      white: { username: 'adalovelace', result: 'win' },
      black: { username: 'carlbot', result: 'resigned' }
    },
    {
      url: 'https://www.chess.com/game/live/6',
      end_time: toEpochSeconds('2026-06-10T14:00:00Z'),
      time_class: 'rapid',
      rules: 'chess',
      rated: true,
      white: { username: 'carlbot', result: 'win' },
      black: { username: 'adalovelace', result: 'resigned' }
    }
  ]);

  const result = await findGameForPairing(baseArgs);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.candidates.length, 2);
});

test('flags inconsistent result codes instead of guessing a winner', async () => {
  mockGames([
    {
      url: 'https://www.chess.com/game/live/7',
      end_time: toEpochSeconds('2026-06-10T10:00:00Z'),
      time_class: 'rapid',
      rules: 'chess',
      rated: true,
      white: { username: 'adalovelace', result: 'win' },
      black: { username: 'carlbot', result: 'win' } // both claim a win: inconsistent
    }
  ]);

  const result = await findGameForPairing(baseArgs);
  assert.equal(result.status, 'inconsistent');
});

test('filters out games of the wrong time class', async () => {
  mockGames([
    {
      url: 'https://www.chess.com/game/live/8',
      end_time: toEpochSeconds('2026-06-10T10:00:00Z'),
      time_class: 'blitz',
      rules: 'chess',
      rated: true,
      white: { username: 'adalovelace', result: 'win' },
      black: { username: 'carlbot', result: 'resigned' }
    }
  ]);

  const result = await findGameForPairing(baseArgs);
  assert.equal(result.status, 'not_found');
});

test('requireRated excludes unrated games', async () => {
  mockGames([
    {
      url: 'https://www.chess.com/game/live/9',
      end_time: toEpochSeconds('2026-06-10T10:00:00Z'),
      time_class: 'rapid',
      rules: 'chess',
      rated: false,
      white: { username: 'adalovelace', result: 'win' },
      black: { username: 'carlbot', result: 'resigned' }
    }
  ]);

  const result = await findGameForPairing({ ...baseArgs, requireRated: true });
  assert.equal(result.status, 'not_found');
});
