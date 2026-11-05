// The tournament simulator doubles as an integration test of the whole
// lifecycle (swiss pairing, Bo3/Bo5, bracket, forfeits) against the real library.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateTournament, verifyTournament, playGame, makeRng } from '../lib/simulation.mjs';
import { getRoundInfo, getSwissStandings } from '../lib/tournamentEngine.mjs';

const config = {
  name: 'Sim Cup',
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

function run(playerCount, opts = {}) {
  const sim = simulateTournament({ config, playerCount, ...opts });
  return { ...sim, ...verifyTournament({ ...sim, config }) };
}

test('20, 40 and 60 players: valid tournaments with the expected formats', () => {
  const expected = { 20: [5, 8, 8], 40: [6, 16, 10], 60: [6, 16, 10] }; // swiss rounds, cutoff, total rounds
  for (const [n, [swissRounds, cutoff, totalRounds]] of Object.entries(expected)) {
    const { issues, metrics, tournament } = run(Number(n), { seed: 3 });
    assert.deepEqual(issues, [], `n=${n}`);
    assert.equal(metrics.swissRounds, swissRounds);
    assert.equal(metrics.playoffCutoff, cutoff);
    assert.equal(metrics.totalRounds, totalRounds);
    assert.equal(tournament.phase, 'complete');
  }
});

test('the last two rounds are Bo5 and every earlier round is Bo3', () => {
  const { engine, tournament } = run(40, { seed: 5 });
  const bestOfs = tournament.rounds.map((r) => r.bestOf);
  assert.deepEqual(bestOfs, [3, 3, 3, 3, 3, 3, 3, 3, 5, 5]);
  assert.equal(getRoundInfo(engine, tournament.rounds.at(-1).number).label, 'Final');
});

test('odd rosters and frequent no-shows still produce valid tournaments', () => {
  for (const n of [9, 21, 33]) {
    for (let seed = 1; seed <= 15; seed++) {
      const { issues } = run(n, { seed, noShowRate: 0.1 });
      assert.deepEqual(issues, [], `n=${n} seed=${seed}`);
    }
  }
});

test('the same seed gives the same tournament; another seed gives another one', () => {
  const summary = (seed) => {
    const sim = simulateTournament({ config, playerCount: 20, seed });
    return JSON.stringify({
      swiss: getSwissStandings(sim.engine).map((s) => [s.player.getName(), s.matchPoints]),
      metrics: verifyTournament({ ...sim, config }).metrics
    });
  };
  assert.equal(summary(11), summary(11));
  assert.notEqual(summary(11), summary(12));
});

test('game model: stronger players win more, and draws are rarer when the gap is large', () => {
  const rng = makeRng(1);
  const count = (a, b) => {
    const tally = { p1: 0, p2: 0, draw: 0 };
    for (let i = 0; i < 5000; i++) tally[playGame(rng, a, b)]++;
    return tally;
  };
  const even = count(1400, 1400);
  const gap = count(1800, 1200);
  assert.ok(gap.p1 > 0.85 * 5000, 'con 600 puntos de diferencia gana casi siempre el fuerte');
  assert.ok(Math.abs(even.p1 - even.p2) < 300, 'igualados: reparto parejo');
  assert.ok(gap.draw < even.draw, 'menos tablas cuanto mayor la diferencia');
});

test('stopAt yields a mid-round snapshot that is not complete', () => {
  const sim = simulateTournament({ config, playerCount: 20, seed: 2, noShowRate: 0, stopAt: { round: 3, resolvedShare: 0.5 } });
  assert.equal(sim.complete, false);
  assert.equal(sim.tournament.phase, 'stage-one');
  assert.equal(sim.tournament.currentRound, 3);
  assert.equal(sim.engine.getActiveMatches().length, 5, 'la mitad de los 10 cruces sigue pendiente');
});

// The verifier is only worth something if it fails when the tournament is wrong.
test('verifyTournament flags a series with more wins than a Bo3 allows', () => {
  const sim = simulateTournament({ config, playerCount: 20, seed: 4 });
  const match = sim.engine.getMatchesByRound(1).find((m) => !m.bye && !m.meta?.forfeit);
  match.player1.win = 3;
  const { issues } = verifyTournament({ ...sim, config });
  assert.ok(issues.some((i) => /más victorias/.test(i)), issues.join('\n'));
});

test('verifyTournament flags a rematch between the same two players', () => {
  const sim = simulateTournament({ config, playerCount: 20, seed: 4, noShowRate: 0 });
  const [r1] = sim.engine.getMatchesByRound(1);
  const r2 = sim.engine.getMatchesByRound(2).find((m) => !m.bye);
  r2.player1.id = r1.player1.id;
  r2.player2.id = r1.player2.id;
  const { issues } = verifyTournament({ ...sim, config });
  assert.ok(issues.some((i) => /repetición de emparejamiento/.test(i)), issues.join('\n'));
});

test('verifyTournament flags a bracket match without a winner', () => {
  const sim = simulateTournament({ config, playerCount: 20, seed: 4, noShowRate: 0 });
  const semi = sim.engine.getMatchesByRound(sim.engine.getStageOne().rounds + 2)[0];
  semi.player2.win = semi.player1.win;
  const { issues } = verifyTournament({ ...sim, config });
  assert.ok(issues.some((i) => /sin ganador/.test(i)), issues.join('\n'));
});

test('no simulated pairing ends level: drawn games are replayed until someone wins the series', () => {
  let longSeries = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const sim = simulateTournament({ config, playerCount: 40, seed, noShowRate: 0, baseDrawRate: 0.3 });
    assert.deepEqual(verifyTournament({ ...sim, config }).issues, [], `seed=${seed}`);
    for (const m of sim.engine.getMatches().filter((x) => !x.bye)) {
      assert.notEqual(m.player1.win, m.player2.win, 'encuentro empatado');
      const { bestOf } = getRoundInfo(sim.engine, m.round);
      if (m.meta.games.length > bestOf) longSeries++;
    }
  }
  assert.ok(longSeries > 50, `con muchas tablas hay series que duran más partidas que su "mejor de" (${longSeries})`);
});

test('verifyTournament flags a level swiss pairing', () => {
  const sim = simulateTournament({ config, playerCount: 20, seed: 4, noShowRate: 0 });
  const match = sim.engine.getMatchesByRound(1).find((m) => !m.bye);
  match.player2.win = match.player1.win;
  const { issues } = verifyTournament({ ...sim, config });
  assert.ok(issues.some((i) => /sin ganador/.test(i)), issues.join(', '));
});

test('bye rule (Play! Pokémon): random in round 1, then the worst record without a previous bye; nobody gets two', () => {
  for (const n of [9, 21, 29]) {
    for (let seed = 1; seed <= 40; seed++) {
      const { issues } = run(n, { seed, noShowRate: 0.05 });
      assert.deepEqual(issues, [], `n=${n} seed=${seed}`);
    }
  }
});

test('verifyTournament flags a bye given to someone who was not in the worst bracket', () => {
  const sim = simulateTournament({ config, playerCount: 21, seed: 8, noShowRate: 0 });
  // Swap the round-3 bye with a player who has a better record: give the bye to the round-3 bye's best-placed opponent.
  const bye = sim.engine.getMatchesByRound(3).find((m) => m.bye);
  const top = getSwissStandings(sim.engine)[0].player.getId();
  const topMatch = sim.engine.getMatchesByRound(3).find((m) => !m.bye && (m.player1.id === top || m.player2.id === top));
  const originalBye = bye.player1.id;
  // Exchange positions: the leader now "has the bye", the former bye player takes the leader's seat.
  if (topMatch.player1.id === top) topMatch.player1.id = originalBye; else topMatch.player2.id = originalBye;
  bye.player1.id = top;
  const { issues } = verifyTournament({ ...sim, config });
  assert.ok(issues.some((i) => /el bye fue a alguien/.test(i)), issues.join(', '));
});
