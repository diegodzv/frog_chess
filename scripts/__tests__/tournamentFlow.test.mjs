// Lifecycle: start -> swiss rounds -> bracket -> complete, as the
// advance-round workflow drives it. Real `tournament-organizer`, no I/O.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTournament, advance, applyPendingOverrides } from '../lib/tournamentFlow.mjs';
import {
  getUnresolvedMatches,
  applyResult,
  getFinalRound
} from '../lib/tournamentEngine.mjs';

const baseConfig = {
  name: 'Flow Cup',
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

function roster(n) {
  return {
    players: Array.from({ length: n }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Player ${i + 1}`,
      chesscomUsername: `player${i + 1}`,
      status: 'active'
    }))
  };
}

const at = (day) => new Date(Date.UTC(2026, 9, day)).toISOString();

function resolveRound(engine, round, outcome = 'player1_win') {
  for (const match of getUnresolvedMatches(engine, round)) applyResult(engine, match.id, outcome);
}

test('startTournament resolves the auto format into tournament.json and opens round 1', () => {
  const { engine, tournament } = startTournament({ tournament: baseConfig, roster: roster(20), now: at(1) });
  assert.equal(tournament.phase, 'stage-one');
  assert.equal(tournament.currentRound, 1);
  assert.equal(tournament.swissRounds, 5);
  assert.deepEqual(tournament.playoffCutoff, { method: 'rank', value: 8 });
  assert.deepEqual(tournament.series, { swiss: 3, elimination: 3, semifinal: 5, final: 5 });
  assert.equal(tournament.playerCount, 20);
  assert.deepEqual(tournament.rounds, [
    { number: 1, phase: 'stage-one', label: 'Ronda 1', bestOf: 3, startedAt: at(1), endedAt: null }
  ]);
  assert.equal(getUnresolvedMatches(engine, 1).length, 10);
  assert.equal(baseConfig.phase, 'registration', 'la config de entrada no se muta');
});

test('startTournament refuses to start twice or with too few players', () => {
  assert.throws(() => startTournament({ tournament: baseConfig, roster: roster(7) }), /mínimo 8/);
  const { tournament } = startTournament({ tournament: baseConfig, roster: roster(8) });
  assert.throws(() => startTournament({ tournament, roster: roster(8) }), /no "registration"/);
});

test('advance refuses while matches are unresolved, and leaves the caller data untouched', () => {
  const { engine, tournament } = startTournament({ tournament: baseConfig, roster: roster(8), now: at(1) });
  const [first, ...rest] = getUnresolvedMatches(engine, 1);
  for (const match of rest) applyResult(engine, match.id, 'player1_win');

  const before = structuredClone({ tournament, overrides: { overrides: [] } });
  assert.throws(() => advance({ engine, tournament, overrides: before.overrides, now: at(15) }), /1 partida\(s\) sin resolver/);
  assert.deepEqual({ tournament, overrides: before.overrides }, before);
  assert.equal(getUnresolvedMatches(engine, 1).length, 1);
  assert.ok(first);
});

test('force-next-round applies pending overrides (walkover and double forfeit) and marks them applied', () => {
  const { engine, tournament } = startTournament({ tournament: baseConfig, roster: roster(8), now: at(1) });
  const [a, b, ...rest] = getUnresolvedMatches(engine, 1);
  for (const match of rest) applyResult(engine, match.id, 'player1_win');
  const overrides = {
    overrides: [
      { matchId: a.id, outcome: 'player2_win', applied: false, reason: 'no se presentó' },
      { matchId: b.id, outcome: 'double_forfeit', applied: false }
    ]
  };

  assert.throws(() => advance({ engine, tournament, overrides, force: false, now: at(15) }), /sin resolver/);
  const result = advance({ engine, tournament, overrides, force: true, now: at(15) });

  assert.deepEqual(result.overrides.overrides.map((o) => o.applied), [true, true]);
  assert.equal(overrides.overrides[0].applied, false, 'el original no se muta');
  assert.equal(result.tournament.currentRound, 2);
  assert.equal(engine.getMatch(a.id).getMeta().source, 'override');
  assert.equal(engine.getMatch(a.id).player2.win, 2, 'walkover = serie 0-2 (Bo3)');
  assert.equal(engine.getMatch(b.id).getMeta().forfeit, 'double');
});

test('an 8-player tournament goes swiss -> semifinals (Bo5) -> final (Bo5) -> complete', () => {
  let { engine, tournament } = startTournament({ tournament: baseConfig, roster: roster(8), now: at(1) });
  let overrides = { overrides: [] };
  assert.equal(tournament.swissRounds, 3);
  assert.equal(tournament.playoffCutoff.value, 4);

  const seen = [];
  let day = 1;
  while (tournament.phase !== 'complete') {
    seen.push(`${tournament.currentRound}:${tournament.phase}`);
    resolveRound(engine, tournament.currentRound);
    day += 14;
    ({ tournament, overrides } = advance({ engine, tournament, overrides, now: at(day) }));
  }

  assert.deepEqual(seen, ['1:stage-one', '2:stage-one', '3:stage-one', '4:stage-two', '5:stage-two']);
  assert.deepEqual(
    tournament.rounds.map((r) => [r.label, r.bestOf]),
    [['Ronda 1', 3], ['Ronda 2', 3], ['Ronda 3', 3], ['Semifinales', 5], ['Final', 5]]
  );
  assert.ok(tournament.rounds.every((r) => r.endedAt), 'todas las rondas quedan cerradas');
  assert.equal(engine.getStatus(), 'complete');
  assert.equal(getFinalRound(engine), 5);
  assert.throws(() => advance({ engine, tournament, overrides }), /fase "complete"/);
});

test('in the bracket the round only opens when the organizer advances, even if the library already activated its matches', () => {
  let { engine, tournament } = startTournament({ tournament: baseConfig, roster: roster(16), now: at(1) });
  let overrides = { overrides: [] };
  while (tournament.phase === 'stage-one') {
    resolveRound(engine, tournament.currentRound);
    ({ tournament, overrides } = advance({ engine, tournament, overrides }));
  }
  assert.equal(tournament.phase, 'stage-two');
  const firstBracketRound = tournament.currentRound;
  assert.equal(getUnresolvedMatches(engine, firstBracketRound).length, 4, 'cuartos de un cuadro de 8');

  // Resolving the quarterfinals makes the library activate the semifinals right away...
  resolveRound(engine, firstBracketRound);
  assert.equal(getUnresolvedMatches(engine, firstBracketRound + 1).length, 2);
  // ...but our current round stays put until advance().
  assert.equal(tournament.currentRound, firstBracketRound);
  ({ tournament } = advance({ engine, tournament, overrides }));
  assert.equal(tournament.currentRound, firstBracketRound + 1);
  assert.equal(tournament.phase, 'stage-two');
});

test('apply-overrides records manual results without advancing, and reports entries it could not apply', () => {
  const { engine, tournament } = startTournament({ tournament: baseConfig, roster: roster(8), now: at(1) });
  const [a, b] = getUnresolvedMatches(engine, 1);
  const overrides = {
    overrides: [
      { matchId: a.id, outcome: 'player1_win', reason: 'ganó 2-0 en chess.com' },
      { matchId: 'no-such-match', outcome: 'player2_win' }
    ]
  };

  const result = applyPendingOverrides({ engine, tournament, overrides });
  assert.equal(result.applied, 1);
  assert.deepEqual(result.overrides.overrides.map((o) => o.applied ?? false), [true, false]);
  assert.deepEqual(result.skipped.map((o) => o.matchId), ['no-such-match']);
  assert.equal(engine.getMatch(a.id).player1.win, 2);
  assert.equal(engine.getMatch(a.id).getMeta().reason, 'ganó 2-0 en chess.com');
  assert.equal(engine.getMatch(b.id).active, true, 'el resto de la ronda sigue pendiente');
  assert.equal(tournament.currentRound, 1, 'no se avanza de ronda');

  // Idempotent: applying again does nothing more.
  assert.equal(applyPendingOverrides({ engine, tournament, overrides: result.overrides }).applied, 0);
});

test('an override with a bad outcome fails naming the match, and nothing is left half applied', () => {
  const { engine, tournament } = startTournament({ tournament: baseConfig, roster: roster(8), now: at(1) });
  const [a] = getUnresolvedMatches(engine, 1);
  const overrides = { overrides: [{ matchId: a.id, outcome: 'draw' }] };
  assert.throws(() => applyPendingOverrides({ engine, tournament, overrides }), new RegExp(`Override de la partida ${a.id}.*tablas`));
  assert.equal(overrides.overrides[0].applied, undefined);
});
