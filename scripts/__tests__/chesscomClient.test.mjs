import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthsBetween,
  getPlayerProfile,
  getPlayerGamesForMonth,
  _resetCache
} from '../lib/chesscomClient.mjs';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  _resetCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('monthsBetween returns the single month when start and end fall in it', () => {
  const months = monthsBetween('2026-06-05T00:00:00Z', '2026-06-20T00:00:00Z');
  assert.deepEqual(months, [{ year: 2026, month: 6 }]);
});

test('monthsBetween spans multiple months inclusively', () => {
  const months = monthsBetween('2026-06-15T00:00:00Z', '2026-08-02T00:00:00Z');
  assert.deepEqual(months, [
    { year: 2026, month: 6 },
    { year: 2026, month: 7 },
    { year: 2026, month: 8 }
  ]);
});

test('getPlayerProfile returns null on 404 without throwing', async () => {
  globalThis.fetch = async () => new Response(null, { status: 404 });
  const profile = await getPlayerProfile('nobody-1234567890');
  assert.equal(profile, null);
});

test('getPlayerGamesForMonth trims fields and converts end_time to ISO', async () => {
  globalThis.fetch = async () =>
    Response.json({
      games: [
        {
          url: 'https://www.chess.com/game/live/1',
          end_time: 1749600000,
          time_class: 'rapid',
          rules: 'chess',
          rated: true,
          white: { username: 'ada', result: 'win' },
          black: { username: 'carl', result: 'checkmated' },
          pgn: 'this should be dropped'
        }
      ]
    });

  const games = await getPlayerGamesForMonth('ada', 2026, 6);
  assert.equal(games.length, 1);
  assert.equal(games[0].pgn, undefined);
  assert.equal(games[0].white.username, 'ada');
  assert.equal(games[0].endTime, new Date(1749600000 * 1000).toISOString());
});

test('responses are memoized within a run (fetch called once for repeat requests)', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ games: [] });
  };

  await getPlayerGamesForMonth('ada', 2026, 6);
  await getPlayerGamesForMonth('ada', 2026, 6);
  assert.equal(calls, 1);
});

test('retries on 429 and eventually succeeds', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls < 2) return new Response(null, { status: 429 });
    return Response.json({ games: [] });
  };

  const games = await getPlayerGamesForMonth('ada', 2026, 6);
  assert.deepEqual(games, []);
  assert.equal(calls, 2);
});
