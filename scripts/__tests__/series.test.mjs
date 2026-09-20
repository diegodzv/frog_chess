import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  winsNeeded,
  bestOfFor,
  bracketRoundLabel,
  scoreSeries,
  walkoverScore,
  DEFAULT_SERIES
} from '../lib/series.mjs';

test('winsNeeded: 2 for Bo3, 3 for Bo5', () => {
  assert.equal(winsNeeded(1), 1);
  assert.equal(winsNeeded(3), 2);
  assert.equal(winsNeeded(5), 3);
});

test('bestOfFor: Bo3 in swiss and early rounds, Bo5 in semifinals and final', () => {
  assert.equal(bestOfFor({ phase: 'stage-one' }, DEFAULT_SERIES), 3);
  assert.equal(bestOfFor({ phase: 'stage-two', roundsFromFinal: 3 }, DEFAULT_SERIES), 3);
  assert.equal(bestOfFor({ phase: 'stage-two', roundsFromFinal: 2 }, DEFAULT_SERIES), 3);
  assert.equal(bestOfFor({ phase: 'stage-two', roundsFromFinal: 1 }, DEFAULT_SERIES), 5);
  assert.equal(bestOfFor({ phase: 'stage-two', roundsFromFinal: 0 }, DEFAULT_SERIES), 5);
});

test('bracketRoundLabel names rounds counted back from the final', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(bracketRoundLabel), [
    'Final',
    'Semifinales',
    'Cuartos de final',
    'Octavos de final',
    'Dieciseisavos de final',
    'Ronda de 64'
  ]);
});

test('a Bo3 ends as soon as someone has 2 wins; later games are ignored', () => {
  const s = scoreSeries(['p1', 'p1', 'p2'], 3);
  assert.deepEqual([s.p1Wins, s.p2Wins, s.played, s.status, s.winner], [2, 0, 2, 'complete', 'p1']);
});

test('a Bo3 is in progress after a single game', () => {
  const s = scoreSeries(['p2'], 3);
  assert.deepEqual([s.status, s.winner], ['in_progress', null]);
});

test('a drawn game decides nothing: won-drawn-won by different players is 1-1 and the series goes on', () => {
  // The case that prompted the rule: Pablo wins, tablas, Elena wins.
  const level = scoreSeries(['p2', 'draw', 'p1'], 3);
  assert.deepEqual([level.p1Wins, level.p2Wins, level.draws, level.played, level.status, level.winner], [1, 1, 1, 3, 'in_progress', null]);

  const decided = scoreSeries(['p2', 'draw', 'p1', 'p1'], 3);
  assert.deepEqual([decided.p1Wins, decided.p2Wins, decided.draws, decided.status, decided.winner], [2, 1, 1, 'complete', 'p1']);
});

test('draws are replayed however many there are: a series never ends on games alone', () => {
  assert.equal(scoreSeries(['draw', 'draw', 'draw'], 3).status, 'in_progress');
  assert.equal(scoreSeries(['p1', 'draw', 'draw'], 3).status, 'in_progress');
  const s = scoreSeries(['p1', 'draw', 'draw', 'draw', 'p1'], 3);
  assert.deepEqual([s.p1Wins, s.p2Wins, s.draws, s.played, s.winner], [2, 0, 3, 5, 'p1']);
});

test('a Bo5 needs 3 wins; 2-2 goes on to another game', () => {
  assert.equal(scoreSeries(['p1', 'p1', 'p2', 'p2'], 5).status, 'in_progress');
  assert.equal(scoreSeries(['p1', 'p1', 'p2', 'p2', 'draw'], 5).status, 'in_progress');
  const s = scoreSeries(['p1', 'p1', 'p2', 'p2', 'draw', 'p2'], 5);
  assert.deepEqual([s.p1Wins, s.p2Wins, s.winner], [2, 3, 'p2']);
});

test('every finished series has exactly one winner with exactly winsNeeded wins', () => {
  for (const bestOf of [1, 3, 5]) {
    for (let seed = 1; seed <= 300; seed++) {
      const games = [];
      let x = seed * 2654435761;
      let s = scoreSeries(games, bestOf);
      while (s.status !== 'complete') {
        x = (Math.imul(x, 1103515245) + 12345) >>> 0;
        games.push(['p1', 'p2', 'draw'][(x >>> 8) % 3]);
        s = scoreSeries(games, bestOf);
      }
      const [winner, loser] = s.winner === 'p1' ? [s.p1Wins, s.p2Wins] : [s.p2Wins, s.p1Wins];
      assert.equal(winner, winsNeeded(bestOf), JSON.stringify(games));
      assert.ok(loser < winner, JSON.stringify(games));
    }
  }
});

test('walkoverScore: a straight series win for the winner; a draw is not a possible result', () => {
  assert.deepEqual(walkoverScore('p1', 3), { p1Wins: 2, p2Wins: 0, draws: 0 });
  assert.deepEqual(walkoverScore('p2', 5), { p1Wins: 0, p2Wins: 3, draws: 0 });
  assert.throws(() => walkoverScore('draw', 3), /sin ganador/);
});
