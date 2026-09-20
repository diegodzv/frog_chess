import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePublicData } from '../build-public-data.mjs';
import { simulateTournament } from '../lib/simulation.mjs';
import { saveEngineTournament } from '../lib/tournamentEngine.mjs';

const config = {
  name: 'Public Cup',
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

const NOW = '2026-11-01T10:00:00.000Z';

function derive(sim) {
  return derivePublicData({
    tournament: sim.tournament,
    roster: sim.roster,
    engineState: JSON.parse(saveEngineTournament(sim.engine)),
    now: NOW
  });
}

test('before the tournament starts everything is empty but well-formed', () => {
  const roster = { players: [{ id: 'p1', name: 'Ada', chesscomUsername: 'ada', status: 'active' }] };
  const files = derivePublicData({ tournament: { ...config, playerCap: config.playerCap }, roster, engineState: null, now: NOW });
  assert.deepEqual(Object.keys(files).sort(), ['bracket.json', 'meta.json', 'players.json', 'rounds.json', 'standings.json']);
  assert.deepEqual(files['standings.json'].rows, []);
  assert.deepEqual(files['rounds.json'].rounds, []);
  assert.deepEqual(files['bracket.json'].rounds, []);
  assert.equal(files['meta.json'].playerCount, 1);
});

test('finished 20-player tournament: standings, rounds, bracket and champion are consistent', () => {
  const sim = simulateTournament({ config, playerCount: 20, seed: 6 });
  const files = derive(sim);
  const { rows, cutoff } = files['standings.json'];

  assert.equal(rows.length, 20);
  assert.equal(cutoff, 8);
  assert.deepEqual(rows.map((r) => r.rank), Array.from({ length: 20 }, (_, i) => i + 1));
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].points >= rows[i].points, 'ordenado por puntos');
  assert.equal(rows.filter((r) => r.qualified).length, 8);

  // Points come from match results (bye = 1), not from the engine's `value` seed field (always 0).
  assert.ok(rows[0].points > 0);
  for (const r of rows) {
    assert.ok(r.record.win + r.record.loss <= 5, 'como mucho una serie por ronda suiza');
    assert.equal(r.points, r.record.win, 'un punto por serie ganada (bye incluido), sin medios puntos');
    assert.equal(r.record.draw, undefined, 'no existen encuentros empatados');
  }

  const { champion } = files['bracket.json'];
  assert.ok(champion);
  assert.equal(files['meta.json'].champion.id, champion.id);
  assert.equal(rows.find((r) => r.playerId === champion.id).outcome, 'Campeón');
  assert.equal(rows.filter((r) => r.outcome === 'Finalista').length, 1);
  assert.equal(rows.filter((r) => r.outcome === 'Eliminado en fase suiza').length, 12);

  const labels = files['bracket.json'].rounds.map((r) => [r.label, r.bestOf, r.matches.length]);
  assert.deepEqual(labels, [['Cuartos de final', 3, 4], ['Semifinales', 5, 2], ['Final', 5, 1]]);
  assert.equal(files['bracket.json'].size, 8);
  assert.equal(files['rounds.json'].rounds.length, 8);
  assert.equal(files['rounds.json'].rounds.filter((r) => r.current).length, 0, 'ninguna ronda en curso al terminar');
});

test('every resolved pairing carries a series score consistent with its winner', () => {
  const sim = simulateTournament({ config, playerCount: 20, seed: 7 });
  const { rounds } = derive(sim)['rounds.json'];
  for (const round of rounds) {
    for (const p of round.pairings.filter((x) => !x.bye)) {
      assert.equal(p.status, 'complete');
      const { p1, p2 } = p.score;
      assert.equal(p.winner, p1 > p2 ? 'p1' : p2 > p1 ? 'p2' : null);
      assert.ok(Math.max(p1, p2) <= (round.bestOf === 3 ? 2 : 3));
    }
  }
});

test('odd roster: the bye shows up as a bye pairing and counts as a win', () => {
  const sim = simulateTournament({ config, playerCount: 21, seed: 3, noShowRate: 0 });
  const files = derive(sim);
  const byes = files['rounds.json'].rounds.flatMap((r) => r.pairings.filter((p) => p.bye));
  assert.equal(byes.length, 5, 'un bye por ronda suiza');
  const byeRow = files['standings.json'].rows.find((r) => r.byes > 0);
  assert.ok(byeRow.record.win >= byeRow.byes);
});

test('mid-swiss snapshot: current round is marked, unplayed pairings are pending', () => {
  const sim = simulateTournament({ config, playerCount: 40, seed: 2, noShowRate: 0, stopAt: { round: 4, resolvedShare: 0.6 } });
  const files = derive(sim);
  const rounds = files['rounds.json'].rounds;

  assert.equal(rounds.length, 4);
  assert.deepEqual(rounds.map((r) => r.current), [false, false, false, true]);
  const current = rounds[3];
  assert.equal(current.pairings.filter((p) => p.status === 'pending').length, 8);
  assert.equal(current.pairings.filter((p) => p.status === 'complete').length, 12);
  assert.equal(files['standings.json'].phase, 'stage-one');
  assert.equal(files['bracket.json'].rounds.length, 0);
  assert.equal(files['meta.json'].currentRoundLabel, 'Ronda 4');
});

test('mid-bracket snapshot: a semifinal the library already activated is "waiting", not "pending", until the round opens', () => {
  const sim = simulateTournament({ config, playerCount: 40, seed: 2, noShowRate: 0, stopAt: { round: 8, resolvedShare: 0.5 } });
  const bracket = derive(sim)['bracket.json'];

  const byLabel = Object.fromEntries(bracket.rounds.map((r) => [r.label, r]));
  assert.equal(byLabel['Cuartos de final'].current, true);
  assert.equal(byLabel['Cuartos de final'].matches.filter((m) => m.status === 'complete').length, 2);
  assert.equal(byLabel['Cuartos de final'].matches.filter((m) => m.status === 'pending').length, 2);
  assert.ok(byLabel['Semifinales'].matches.every((m) => m.status === 'waiting'));
  assert.ok(byLabel['Final'].matches.every((m) => m.status === 'waiting' && m.player1 === null));
  assert.equal(bracket.champion, null);
});

test('updatedAt is the timestamp passed in, so builds are deterministic', () => {
  const sim = simulateTournament({ config, playerCount: 20, seed: 6 });
  const files = derive(sim);
  for (const [name, content] of Object.entries(files)) assert.equal(content.updatedAt, NOW, name);
});

test('while registration is open, meta shows the format the current roster would get', () => {
  const players = (n) => ({ players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, chesscomUsername: `u${i}`, status: 'active' })) });
  const meta = (n) => derivePublicData({ tournament: config, roster: players(n), engineState: null, now: NOW })['meta.json'];

  assert.deepEqual(meta(20).expectedFormat, { swissRounds: 5, playoffCutoff: 8 });
  assert.deepEqual(meta(60).expectedFormat, { swissRounds: 6, playoffCutoff: 16 });
  assert.equal(meta(1).expectedFormat, null, 'con 1 jugador no hay formato posible');
  assert.equal(meta(20).swissRounds, null, 'el "auto" del fichero de config no se filtra a la web');
});

test('every pairing has a winner, except a double forfeit which counts as a loss for both', () => {
  const sim = simulateTournament({ config, playerCount: 20, seed: 9, noShowRate: 0.3, doubleForfeitShare: 1 });
  const files = derive(sim);
  const pairings = files['rounds.json'].rounds.flatMap((r) => r.pairings.filter((p) => !p.bye));
  const doubles = pairings.filter((p) => p.manual === 'double');
  assert.ok(doubles.length > 0, 'la semilla debería generar dobles forfeits');
  for (const p of pairings) {
    if (p.manual === 'double') assert.equal(p.winner, null);
    else assert.ok(p.winner === 'p1' || p.winner === 'p2', 'todo encuentro tiene un ganador');
  }
  const lostByForfeit = new Map();
  for (const d of doubles) for (const id of [d.player1.id, d.player2.id]) lostByForfeit.set(id, (lostByForfeit.get(id) ?? 0) + 1);
  for (const [id, count] of lostByForfeit) {
    const row = files['standings.json'].rows.find((r) => r.playerId === id);
    assert.ok(row.record.loss >= count, 'el doble forfeit cuenta como derrota en el récord');
  }
});
