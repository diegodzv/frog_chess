// Manual results (data/overrides.json): entries that name the players by chess.com username.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTournament, applyPendingOverrides } from '../lib/tournamentFlow.mjs';
import { getUnresolvedMatches } from '../lib/tournamentEngine.mjs';

const baseConfig = {
  name: 'Overrides Cup',
  timeClass: 'rapid',
  rules: 'chess',
  requireRated: false,
  playerCap: { min: 8, max: 64 },
  swissRounds: 'auto',
  playoffCutoff: { method: 'rank', value: 'auto' },
  phase: 'registration',
  currentRound: 0,
  rounds: []
};

const roster = {
  players: Array.from({ length: 8 }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    chesscomUsername: `Player_${i + 1}`,
    status: 'active'
  }))
};

const started = () => startTournament({ tournament: baseConfig, roster, now: '2026-10-01T00:00:00.000Z' });

test('overrides can name the players by chess.com username instead of the match id', () => {
  const { engine, tournament } = started();
  const [a, b, c] = getUnresolvedMatches(engine, 1);
  const user = (id) => engine.getPlayer(id).getMeta().chesscomUsername;

  const overrides = {
    overrides: [
      // The winner is player2 of match a, written in another case and with spaces around it.
      { winner: `  ${user(a.player2.id).toUpperCase()} `, loser: user(a.player1.id), reason: '2-1' },
      { players: [user(b.player2.id), user(b.player1.id)], outcome: 'double_forfeit' },
      { winner: user(c.player1.id), loser: 'nadie' },
      { winner: user(c.player1.id) }
    ]
  };
  const result = applyPendingOverrides({ engine, tournament, overrides });

  assert.equal(result.applied, 2);
  assert.deepEqual([engine.getMatch(a.id).player1.win, engine.getMatch(a.id).player2.win], [0, 2]);
  assert.equal(engine.getMatch(a.id).getMeta().reason, '2-1');
  assert.equal(engine.getMatch(b.id).getMeta().forfeit, 'double');
  assert.equal(engine.getMatch(c.id).active, true, 'un rival que no existe no resuelve nada');
  assert.equal(result.skipped.length, 2);
});

test('a username override only matches an unresolved match of the current round', () => {
  const { engine, tournament } = started();
  const first = getUnresolvedMatches(engine, 1)[0];
  const user = (id) => engine.getPlayer(id).getMeta().chesscomUsername;
  const winner = user(first.player1.id);
  const loser = user(first.player2.id);

  const once = applyPendingOverrides({ engine, tournament, overrides: { overrides: [{ winner, loser }] } });
  assert.equal(once.applied, 1);

  // The same pair again (already resolved) is skipped instead of overwriting the result.
  const twice = applyPendingOverrides({ engine, tournament, overrides: { overrides: [{ winner: loser, loser: winner }] } });
  assert.equal(twice.applied, 0);
  assert.equal(engine.getMatch(first.id).player1.win, 2);
});

test('two entries for the same pair: the first one wins, the second is reported as skipped', () => {
  const { engine, tournament } = started();
  const first = getUnresolvedMatches(engine, 1)[0];
  const user = (id) => engine.getPlayer(id).getMeta().chesscomUsername;
  const overrides = {
    overrides: [
      { winner: user(first.player1.id), loser: user(first.player2.id) },
      { winner: user(first.player2.id), loser: user(first.player1.id) }
    ]
  };
  const result = applyPendingOverrides({ engine, tournament, overrides });
  assert.equal(result.applied, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(engine.getMatch(first.id).player1.win, 2);
});
