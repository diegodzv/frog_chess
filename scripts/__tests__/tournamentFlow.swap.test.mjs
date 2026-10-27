// Mid-week re-pairing: two players whose opponents never answered play each other, and the
// opponents play each other ({ "swap": ["j1", "j3"] } in data/overrides.json).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTournament, applyPendingOverrides, advance } from '../lib/tournamentFlow.mjs';
import { getUnresolvedMatches, applyResult, loadEngineTournament, saveEngineTournament } from '../lib/tournamentEngine.mjs';

const config = {
  name: 'Swap Cup',
  timeClass: 'blitz',
  rules: 'chess',
  requireRated: false,
  playerCap: { min: 8, max: 200 },
  swissRounds: 4,
  playoffCutoff: { method: 'rank', value: 4 },
  series: { swiss: 1, elimination: 3, semifinal: 5, final: 5 },
  phase: 'registration',
  currentRound: 0,
  rounds: []
};

const roster = {
  players: Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}`, chesscomUsername: `j${i + 1}`, status: 'active' }))
};

function setup() {
  const { engine, tournament } = startTournament({ tournament: config, roster, now: '2026-11-09T07:00:00.000Z' });
  const user = (id) => engine.getPlayer(id).getMeta().chesscomUsername;
  const [m1, m2, m3] = getUnresolvedMatches(engine, 1);
  return { engine, tournament, user, m1, m2, m3 };
}

const pairsOf = (engine, round) =>
  getUnresolvedMatches(engine, round)
    .map((m) => [m.player1.id, m.player2.id].sort().join('-'))
    .sort();

test('a swap pairs the two players and their former opponents, keeping the round otherwise intact', () => {
  const { engine, tournament, user, m1, m2 } = setup();
  const a = m1.player1.id;
  const b = m1.player2.id;
  const c = m2.player2.id;
  const d = m2.player1.id;

  const result = applyPendingOverrides({ engine, tournament, overrides: { overrides: [{ swap: [user(a), user(c).toUpperCase()] }] } });
  assert.equal(result.applied, 1);
  assert.equal(result.overrides.overrides[0].applied, true);

  const pairs = pairsOf(engine, 1);
  assert.ok(pairs.includes([a, c].sort().join('-')));
  assert.ok(pairs.includes([b, d].sort().join('-')));
  assert.equal(pairs.length, 4, 'still four pending pairings');
  assert.deepEqual(engine.getMatch(m1.id).getMeta().repairedFrom, [a, b]);

  // The players' own records point at their new opponents (the next rounds rely on them to avoid rematches).
  assert.deepEqual(engine.getPlayer(a).getMatches().map((m) => m.opponent), [c]);
  assert.deepEqual(engine.getPlayer(b).getMatches().map((m) => m.opponent), [d]);
});

test('after a swap the round is played and advanced normally, and survives a save/load', () => {
  const { engine: original, tournament, user, m1, m2 } = setup();
  const swap = { swap: [user(m1.player1.id), user(m2.player1.id)] };
  applyPendingOverrides({ engine: original, tournament, overrides: { overrides: [swap] } });
  const engine = loadEngineTournament(JSON.parse(saveEngineTournament(original)));

  for (const m of getUnresolvedMatches(engine, 1)) applyResult(engine, m.id, 'player1_win');
  const next = advance({ engine, tournament, overrides: { overrides: [] }, now: '2026-11-16T07:00:00.000Z' });
  assert.equal(next.tournament.currentRound, 2);

  for (const player of engine.getPlayers()) {
    const opponents = player.getMatches().map((m) => m.opponent).filter(Boolean);
    assert.equal(new Set(opponents).size, opponents.length, `${player.getId()} repite rival`);
  }
});

test('a swap between players that already met is refused and changes nothing', () => {
  const { engine, tournament, user } = setup();
  for (const m of getUnresolvedMatches(engine, 1)) applyResult(engine, m.id, 'player1_win');
  const { tournament: t2 } = advance({ engine, tournament, overrides: { overrides: [] }, now: '2026-11-16T07:00:00.000Z' });

  // Two round-2 players (different matches) who played each other in round 1, if any; otherwise their opponents met.
  const round1 = engine.getMatches().filter((m) => m.round === 1);
  const pending = getUnresolvedMatches(engine, 2);
  const matchOf = (id) => pending.find((m) => m.player1.id === id || m.player2.id === id);
  const met = round1.find((m) => matchOf(m.player1.id) && matchOf(m.player2.id) && matchOf(m.player1.id) !== matchOf(m.player2.id));
  assert.ok(met, 'with 8 players some round-1 pair is in different round-2 matches');

  const before = pairsOf(engine, 2);
  assert.throws(
    () => applyPendingOverrides({ engine, tournament: t2, overrides: { overrides: [{ swap: [user(met.player1.id), user(met.player2.id)] }] } }),
    /ya se enfrentaron/
  );
  assert.deepEqual(pairsOf(engine, 2), before);
});

test('a swap with a player of the same match, an unknown username or a resolved match is not applied', () => {
  const { engine, tournament, user, m1, m2, m3 } = setup();
  applyResult(engine, m3.id, 'player1_win');
  assert.throws(
    () => applyPendingOverrides({ engine, tournament, overrides: { overrides: [{ swap: [user(m1.player1.id), user(m1.player2.id)] }] } }),
    /ya se enfrentan en esta ronda/
  );
  assert.throws(
    () => applyPendingOverrides({ engine, tournament, overrides: { overrides: [{ swap: [user(m1.player1.id), user(m3.player1.id)] }] } }),
    /no tiene ninguna partida pendiente/
  );
  const result = applyPendingOverrides({ engine, tournament, overrides: { overrides: [{ swap: [user(m2.player1.id), 'nadie'] }] } });
  assert.equal(result.applied, 0);
  assert.equal(result.skipped.length, 1);
});
