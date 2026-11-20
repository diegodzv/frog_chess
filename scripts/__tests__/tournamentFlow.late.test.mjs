// Late joiners: two players who join during the swiss stage play each other once for every round already
// opened, and are paired normally from the next round on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTournament, applyPendingOverrides, advance } from '../lib/tournamentFlow.mjs';
import {
  getUnresolvedMatches,
  getPendingMatches,
  applyResult,
  addLatePair,
  loadEngineTournament,
  saveEngineTournament
} from '../lib/tournamentEngine.mjs';
import { derivePublicData } from '../build-public-data.mjs';

const config = {
  name: 'Late Cup',
  timeClass: 'rapid',
  timeControl: '600',
  rules: 'chess',
  requireRated: false,
  playerCap: { min: 4, max: 200 },
  swissRounds: 4,
  playoffCutoff: { method: 'rank', value: 4 },
  series: { swiss: 1, elimination: 3, semifinal: 3, final: 3 },
  phase: 'registration',
  currentRound: 0,
  rounds: []
};
const roster = { players: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, chesscomUsername: `u${i}`, status: 'active' })) };
const late = [
  { id: 'late_a', name: 'Lara', chesscomUsername: 'Laradona2' },
  { id: 'late_b', name: 'Miguel', chesscomUsername: 'ISacMyQueen' }
];

function inRound2() {
  let { engine, tournament } = startTournament({ tournament: config, roster, now: '2026-11-09T08:00:00.000Z' });
  for (const m of getUnresolvedMatches(engine, 1)) applyResult(engine, m.id, 'player1_win');
  ({ tournament } = advance({ engine, tournament, overrides: { overrides: [] }, now: '2026-11-16T08:00:00.000Z' }));
  addLatePair(engine, late, [1, 2], '2026-11-16T08:00:00.000Z');
  // As the workflows do: through a save/load.
  return { engine: loadEngineTournament(JSON.parse(saveEngineTournament(engine))), tournament };
}

test('a late pair gets one match in each round already opened, against each other, pending until played', () => {
  const { engine } = inRound2();
  for (const round of [1, 2]) {
    const m = engine.getMatches().find((x) => x.round === round && x.player1.id === 'late_a');
    assert.ok(m, `ronda ${round}`);
    assert.equal(m.player2.id, 'late_b');
    assert.equal(m.active, true);
    assert.equal(m.match, 5, 'mesa siguiente a las 4 de la ronda');
    assert.ok(m.getMeta().lateEntry);
  }
  assert.deepEqual(getPendingMatches(engine, 2).filter((m) => m.meta.lateEntry).map((m) => m.round), [1, 2]);
});

test('round 3 cannot open until the late games are resolved; then they count and are paired normally, no rematch', () => {
  const { engine, tournament } = inRound2();
  for (const m of getUnresolvedMatches(engine, 2)) if (!m.meta?.lateEntry) applyResult(engine, m.id, 'player1_win');
  assert.throws(() => advance({ engine, tournament, overrides: { overrides: [] }, now: '2026-11-23T08:00:00.000Z' }), /sin resolver/);

  // Usernames in overrides.json: the first entry takes the round-1 game, the second the round-2 one.
  const { applied } = applyPendingOverrides({
    engine,
    tournament,
    overrides: { overrides: [{ winner: 'laradona2', loser: 'isacmyqueen' }, { winner: 'ISacMyQueen', loser: 'Laradona2' }] }
  });
  assert.equal(applied, 2);
  const won = (round, id) => {
    const m = engine.getMatches().find((x) => x.round === round && x.player1.id === 'late_a');
    return (m.player1.id === id ? m.player1.win : m.player2.win) === 1;
  };
  assert.ok(won(1, 'late_a') && won(2, 'late_b'));

  const next = advance({ engine, tournament, overrides: { overrides: [] }, now: '2026-11-23T08:00:00.000Z' });
  assert.equal(next.tournament.currentRound, 3);
  const r3 = engine.getMatches().filter((m) => m.round === 3);
  assert.equal(r3.length, 5, '10 jugadores, 5 mesas, sin bye');
  assert.ok(!r3.some((m) => [m.player1.id, m.player2.id].sort().join() === 'late_a,late_b'), 'no vuelven a jugar entre ellos');
  for (const p of engine.getPlayers()) {
    const opp = p.getMatches().map((m) => m.opponent).filter(Boolean);
    const others = opp.filter((o) => !(p.getId().startsWith('late_') && o.startsWith('late_')));
    assert.equal(new Set(others).size, others.length, `${p.getId()} repite rival`);
  }

  const players = { players: [...roster.players, ...late.map((p) => ({ ...p, status: 'active' }))] };
  const { rows } = derivePublicData({ tournament: next.tournament, roster: players, engineState: JSON.parse(saveEngineTournament(engine)), now: '2026-11-23T08:00:00.000Z' })['standings.json'];
  for (const id of ['late_a', 'late_b']) {
    const row = rows.find((r) => r.playerId === id);
    assert.equal(row.record.win + row.record.loss, 2, 'dos partidas en su récord');
    assert.equal(row.points, 1);
  }
});
