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
  addLatePlayer,
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

// A single late joiner: no catch-up games, a record decided by the organizers.

function inRound2WithLatePlayer() {
  let { engine, tournament } = startTournament({ tournament: config, roster, now: '2026-11-09T08:00:00.000Z' });
  for (const m of getUnresolvedMatches(engine, 1)) applyResult(engine, m.id, 'player1_win');
  ({ tournament } = advance({ engine, tournament, overrides: { overrides: [] }, now: '2026-11-16T08:00:00.000Z' }));
  addLatePlayer(engine, { id: 'late_j', name: 'Jorge', chesscomUsername: 'pendiente-jorge', chesscomPending: true }, { 1: 'win', 2: 'loss' });
  return { engine: loadEngineTournament(JSON.parse(saveEngineTournament(engine))), tournament };
}

test('a single late player gets a finished win and loss without opponent, and nothing pending', () => {
  const { engine } = inRound2WithLatePlayer();
  const mine = engine.getMatches().filter((m) => m.player1.id === 'late_j');
  assert.deepEqual(mine.map((m) => [m.round, m.getMeta().assigned, m.active, m.player2.id]).sort(), [[1, 'win', false, null], [2, 'loss', false, null]]);
  assert.equal(getPendingMatches(engine, 2).length, 4, 'solo las 4 mesas normales de la ronda 2');
  assert.equal(engine.getPlayer('late_j').getMeta().chesscomPending, true);
});

test('the late player counts as 1-1 with 1 point, takes no bye and is paired normally in round 3', () => {
  const { engine, tournament } = inRound2WithLatePlayer();
  for (const m of getUnresolvedMatches(engine, 2)) applyResult(engine, m.id, 'player1_win');
  const next = advance({ engine, tournament, overrides: { overrides: [] }, now: '2026-11-23T08:00:00.000Z' });
  const r3 = engine.getMatches().filter((m) => m.round === 3);
  const bye = r3.find((m) => m.bye);
  assert.equal(r3.length, 5, '9 jugadores: 4 mesas y un bye');
  assert.ok(bye && bye.player1.id !== 'late_j', 'descansa alguien con 0-2, no el recién llegado');
  assert.ok(r3.some((m) => !m.bye && [m.player1.id, m.player2.id].includes('late_j')));

  const players = { players: [...roster.players, { id: 'late_j', name: 'Jorge', chesscomUsername: 'pendiente-jorge', chesscomVerified: false, status: 'active' }] };
  const data = derivePublicData({ tournament: next.tournament, roster: players, engineState: JSON.parse(saveEngineTournament(engine)), now: '2026-11-23T08:00:00.000Z' });
  const row = data['standings.json'].rows.find((r) => r.playerId === 'late_j');
  assert.deepEqual(row.record, { win: 1, loss: 1 });
  assert.equal(row.points, 1);
  assert.equal(row.byes, 0);
  const assigned = data['rounds.json'].rounds.flatMap((r) => r.pairings.filter((p) => p.assigned).map((p) => [r.number, p.assigned, p.player1.id, p.player2, p.score]));
  assert.deepEqual(assigned, [[1, 'win', 'late_j', null, null], [2, 'loss', 'late_j', null, null]]);
});

test('addLatePlayer rejects results for rounds not opened yet or unknown outcomes', () => {
  const { engine } = inRound2WithLatePlayer();
  assert.throws(() => addLatePlayer(engine, { id: 'x', name: 'X', chesscomUsername: 'x' }, { 3: 'win' }), /no válidos/);
  assert.throws(() => addLatePlayer(engine, { id: 'y', name: 'Y', chesscomUsername: 'y' }, { 1: 'draw' }), /no válidos/);
  assert.equal(engine.getPlayers().some((p) => ['x', 'y'].includes(p.getId())), false, 'no se crea el jugador');
});
