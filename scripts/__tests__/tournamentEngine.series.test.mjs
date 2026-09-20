// Bo3/Bo5 behaviour of the engine wrapper: automatic format, series scores,
// forfeits. Runs against the real `tournament-organizer` package.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEngineTournament,
  getUnresolvedMatches,
  applyResult,
  applySeriesResult,
  applyDoubleForfeit,
  advanceRound,
  getRoundInfo,
  getSwissStandings,
  resolveFormat,
  autoSwissRounds,
  autoPlayoffCutoff
} from '../lib/tournamentEngine.mjs';

const autoConfig = { name: 'Auto Cup', swissRounds: 'auto', playoffCutoff: { method: 'rank', value: 'auto' } };

function roster(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    chesscomUsername: `player${i + 1}`,
    status: 'active'
  }));
}

function started(n = 8) {
  const tournament = createEngineTournament(autoConfig, roster(n));
  tournament.startTournament();
  return tournament;
}

test('auto format: swiss rounds = ceil(log2 n); cutoff = largest power of two <= n/2, between 4 and 16', () => {
  const cases = [
    [8, 3, 4],
    [16, 4, 8],
    [20, 5, 8],
    [21, 5, 8],
    [40, 6, 16],
    [60, 6, 16],
    [64, 6, 16]
  ];
  for (const [n, rounds, cutoff] of cases) {
    assert.deepEqual(resolveFormat(autoConfig, n), { swissRounds: rounds, playoffCutoff: cutoff }, `n=${n}`);
  }
  assert.equal(autoSwissRounds(20), 5);
  assert.equal(autoPlayoffCutoff(60), 16);
});

test('explicit numbers in the config win over auto; a non-power-of-two cutoff is rejected', () => {
  assert.deepEqual(resolveFormat({ swissRounds: 4, playoffCutoff: { value: 4 } }, 40), { swissRounds: 4, playoffCutoff: 4 });
  assert.throws(() => resolveFormat({ swissRounds: 4, playoffCutoff: { value: 6 } }, 40), /potencia de 2/);
  assert.throws(() => resolveFormat({ swissRounds: 4, playoffCutoff: { value: 16 } }, 8), /supera/);
});

test('swiss pairings are Bo3: two wins is the most a player can take, three is rejected by the engine', () => {
  const tournament = started();
  const [match] = getUnresolvedMatches(tournament);
  assert.equal(getRoundInfo(tournament, 1).bestOf, 3);
  assert.throws(() => applySeriesResult(tournament, match.id, { p1Wins: 3, p2Wins: 0 }), /se gana con 2 victorias/);
  applySeriesResult(tournament, match.id, { p1Wins: 2, p2Wins: 1 }, { games: ['p1', 'p2', 'p1'] });
  assert.deepEqual(tournament.getMatch(match.id).getMeta().games, ['p1', 'p2', 'p1']);
});

test('applyResult records a walkover as a full series win', () => {
  const tournament = started();
  const [match] = getUnresolvedMatches(tournament);
  applyResult(tournament, match.id, 'player2_win');
  const m = tournament.getMatch(match.id);
  assert.deepEqual([m.player1.win, m.player2.win], [0, 2]);
});

test('no pairing can end level or short: the winner needs exactly winsNeeded wins (drawn games are just recorded)', () => {
  const tournament = started();
  const [a, b, c] = getUnresolvedMatches(tournament);
  assert.throws(() => applySeriesResult(tournament, a.id, { p1Wins: 1, p2Wins: 1, draws: 1 }), /no admite empate/);
  assert.throws(() => applySeriesResult(tournament, a.id, { p1Wins: 1, p2Wins: 0 }), /se gana con 2 victorias/);
  assert.throws(() => applyResult(tournament, a.id, 'draw'), /tablas/);
  assert.equal(getUnresolvedMatches(tournament).length, 4, 'nada quedó registrado a medias');

  applySeriesResult(tournament, b.id, { p1Wins: 2, p2Wins: 1, draws: 3 });
  const m = tournament.getMatch(b.id);
  assert.deepEqual([m.player1.win, m.player2.win, m.player1.draw], [2, 1, 3]);
  const winner = getSwissStandings(tournament).find((s) => s.player.getId() === b.player1.id);
  const loser = getSwissStandings(tournament).find((s) => s.player.getId() === b.player2.id);
  assert.deepEqual([winner.matchPoints, loser.matchPoints], [1, 0], 'victoria = 1 punto, derrota = 0; las tablas no puntúan');
  assert.ok(c);
});

test('double forfeit: both players get 0 points, the match closes, the round can advance', () => {
  const tournament = started();
  const [first, ...rest] = getUnresolvedMatches(tournament);
  const pair = [first.player1.id, first.player2.id];
  applyDoubleForfeit(tournament, first);
  for (const match of rest) applyResult(tournament, match.id, 'player1_win');

  for (const id of pair) {
    assert.equal(getSwissStandings(tournament).find((s) => s.player.getId() === id).matchPoints, 0);
  }
  assert.equal(tournament.getMatch(first.id).getMeta().forfeit, 'double');

  advanceRound(tournament);
  assert.equal(tournament.getRoundNumber(), 2);
  const rematch = tournament.getMatchesByRound(2).some((m) => [m.player1.id, m.player2.id].sort().join() === pair.slice().sort().join());
  assert.equal(rematch, false, 'los dos ausentes no deben volver a emparejarse');
});
