// Withdrawals ({ "drop": "username" } in data/overrides.json): pending matches are lost, the player is not
// paired again, odd numbers get a bye each round, and a dropped player never takes a bracket place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTournament, applyPendingOverrides, advance } from '../lib/tournamentFlow.mjs';
import { getUnresolvedMatches, applyResult, getLastSwissRound, loadEngineTournament, saveEngineTournament } from '../lib/tournamentEngine.mjs';
import { derivePublicData } from '../build-public-data.mjs';

const config = {
  name: 'Drop Cup',
  timeClass: 'blitz',
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

const rosterOf = (n) => ({
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}`, chesscomUsername: `j${i + 1}`, status: 'active' }))
});

function setup(n) {
  const roster = rosterOf(n);
  const started = startTournament({ tournament: config, roster, now: '2026-11-09T08:00:00.000Z' });
  return { roster, ...started };
}

const user = (engine, id) => engine.getPlayer(id).getMeta().chesscomUsername;
const drop = (engine, tournament, username) =>
  applyPendingOverrides({ engine, tournament, overrides: { overrides: [{ drop: username, reason: 'se va' }] } });

/** Resolves the current round (player1 always wins) and advances. */
function playRound(engine, tournament) {
  for (const m of getUnresolvedMatches(engine, tournament.currentRound)) applyResult(engine, m.id, 'player1_win');
  return advance({ engine, tournament, overrides: { overrides: [] }, now: '2026-11-16T08:00:00.000Z' }).tournament;
}

const playersIn = (engine, round) => engine.getMatches().filter((m) => m.round === round).flatMap((m) => [m.player1.id, m.player2.id]).filter(Boolean);

test('swiss drop with a pending match: the opponent wins it, and the player is never paired again', () => {
  let { engine, tournament } = setup(8);
  const [m] = getUnresolvedMatches(engine, 1);
  const leaver = m.player1.id;
  const opponent = m.player2.id;

  assert.equal(drop(engine, tournament, user(engine, leaver).toUpperCase()).applied, 1);
  const done = engine.getMatch(m.id);
  assert.equal(done.active, false);
  assert.deepEqual([done.player1.win, done.player2.win], [0, 1], 'derrota para quien se retira');
  assert.equal(done.getMeta().forfeit, 'drop');

  tournament = playRound(engine, tournament);
  // 7 players left: one bye per round from now on, never the same player twice, never the leaver.
  const byes = [];
  for (let round = 2; round <= getLastSwissRound(engine); round++) {
    assert.ok(!playersIn(engine, round).includes(leaver), `ronda ${round}: no se empareja a quien se retiró`);
    const bye = engine.getMatches().filter((x) => x.round === round && x.bye);
    assert.equal(bye.length, 1, `ronda ${round}: un bye con 7 jugadores`);
    byes.push(bye[0].player1.id);
    if (round < getLastSwissRound(engine)) tournament = playRound(engine, tournament);
  }
  assert.equal(new Set(byes).size, byes.length, 'nadie repite bye');
  assert.ok(engine.getPlayer(opponent).getMatches().some((x) => x.id === m.id && x.win === 1));
});

test('a drop that leaves an even number removes the bye', () => {
  let { engine, tournament } = setup(9);
  assert.equal(engine.getMatches().filter((m) => m.round === 1 && m.bye).length, 1);
  tournament = playRound(engine, tournament);
  const someone = getUnresolvedMatches(engine, 2)[0].player1.id;
  drop(engine, tournament, user(engine, someone));
  tournament = playRound(engine, tournament);
  assert.equal(engine.getMatches().filter((m) => m.round === 3 && m.bye).length, 0);
  assert.equal(playersIn(engine, 3).length, 8);
});

test('a dropped player high in the standings never takes a bracket place, and the cut is restored', () => {
  let { engine, tournament, roster } = setup(8);
  for (let round = 1; round < getLastSwissRound(engine); round++) tournament = playRound(engine, tournament);
  for (const m of getUnresolvedMatches(engine, tournament.currentRound)) applyResult(engine, m.id, 'player1_win');

  const leader = engine.getStandings()[0].player.getId();
  drop(engine, tournament, user(engine, leader));
  tournament = advance({ engine, tournament, overrides: { overrides: [] }, now: '2026-12-07T08:00:00.000Z' }).tournament;

  assert.equal(tournament.phase, 'stage-two');
  const bracket = playersIn(engine, getLastSwissRound(engine) + 1);
  assert.equal(bracket.length, 4, 'cuadro completo de 4');
  assert.ok(!bracket.includes(leader));
  assert.equal(engine.getStageTwo().advance.value, 4, 'el corte configurado se conserva');

  const files = derivePublicData({ tournament, roster, engineState: JSON.parse(saveEngineTournament(engine)), now: '2026-12-07T08:00:00.000Z' });
  const row = files['standings.json'].rows.find((r) => r.playerId === leader);
  assert.equal(row.outcome, 'Retirado');
  assert.equal(row.qualified, false);
  assert.equal(files['standings.json'].rows.filter((r) => r.qualified).length, 4);
  assert.equal(files['standings.json'].final.rows.find((r) => r.playerId === leader).outcome, 'Retirado');
});

test('bracket drop: the opponent goes through as if the leaver had lost', () => {
  let { engine, tournament } = setup(8);
  for (let round = 1; round <= getLastSwissRound(engine); round++) tournament = playRound(engine, tournament);
  const [semi] = getUnresolvedMatches(engine, tournament.currentRound);
  const leaver = semi.player2.id;

  drop(engine, tournament, user(engine, leaver));
  const done = engine.getMatch(semi.id);
  assert.equal(done.active, false);
  assert.deepEqual([done.player1.win, done.player2.win], [2, 0], 'serie al mejor de 3 perdida por la retirada');
  assert.equal(engine.getPlayer(leaver).getMeta().dropped.round, tournament.currentRound);

  const reloaded = loadEngineTournament(JSON.parse(saveEngineTournament(engine)));
  const final = reloaded.getMatches().find((m) => m.round === getLastSwissRound(reloaded) + 2);
  assert.ok([final.player1.id, final.player2.id].includes(semi.player1.id), 'el rival pasa a la final');
});

test('dropping twice fails; an unknown username is left unapplied', () => {
  const { engine, tournament } = setup(8);
  drop(engine, tournament, 'j1');
  assert.throws(() => drop(engine, tournament, 'j1'), /ya se había retirado/);
  const result = drop(engine, tournament, 'nadie');
  assert.equal(result.applied, 0);
  assert.equal(result.skipped.length, 1);
});
