// Integration tests against the real `tournament-organizer` package (not mocked).
// Require `npm install` to have run first. If these fail after install, treat
// it as a signal that an assumption baked into lib/tournamentEngine.mjs or
// scripts/build-public-data.mjs needs revisiting — see dev/spike-tournament-organizer.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEngineTournament,
  loadEngineTournament,
  saveEngineTournament,
  getUnresolvedMatches,
  applyResult,
  advanceRound
} from '../lib/tournamentEngine.mjs';

const config = {
  name: 'Test Cup',
  swissRounds: 2,
  playoffCutoff: { method: 'rank', value: 2 },
  tiebreaks: []
};

const players = [
  { id: 'p1', name: 'Ada', chesscomUsername: 'ada', status: 'active' },
  { id: 'p2', name: 'Bob', chesscomUsername: 'bob', status: 'active' },
  { id: 'p3', name: 'Carl', chesscomUsername: 'carl', status: 'active' },
  { id: 'p4', name: 'Dana', chesscomUsername: 'dana', status: 'active' }
];

test('createEngineTournament registers only active players with their chess.com username in meta', () => {
  const tournament = createEngineTournament(config, [
    ...players,
    { id: 'p5', name: 'Withdrawn', chesscomUsername: 'gone', status: 'withdrawn' }
  ]);
  assert.equal(tournament.players.length, 4);
  assert.equal(tournament.players.find((p) => p.id === 'p1').meta.chesscomUsername, 'ada');
});

test('round 1 has 2 matches for 4 players, and results can be applied', () => {
  const tournament = createEngineTournament(config, players);
  tournament.startTournament();

  const round1 = getUnresolvedMatches(tournament);
  assert.equal(round1.length, 2);

  for (const match of round1) {
    applyResult(tournament, match.id, 'a_win');
  }

  assert.equal(getUnresolvedMatches(tournament).length, 0);
});

test('getValues() -> saveEngineTournament -> loadEngineTournament round-trips losslessly', () => {
  const tournament = createEngineTournament(config, players);
  tournament.startTournament();
  for (const match of getUnresolvedMatches(tournament)) {
    applyResult(tournament, match.id, 'b_win');
  }

  const json = JSON.parse(saveEngineTournament(tournament));
  const reloaded = loadEngineTournament(json);
  assert.deepEqual(reloaded.getValues(), tournament.getValues());
});

test('advanceRound moves to the next round once all matches are resolved', () => {
  const tournament = createEngineTournament(config, players);
  tournament.startTournament();
  const startingRound = tournament.round;

  for (const match of getUnresolvedMatches(tournament)) {
    applyResult(tournament, match.id, 'a_win');
  }
  advanceRound(tournament);

  assert.equal(tournament.round, startingRound + 1);
});
