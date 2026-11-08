// Round 1 paired by self-reported level, and advance-tournament.mjs run as a process (start-tournament with
// --levels / --start-at), so a broken script can't go unnoticed again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { levelFromAnswer, pairByLevel } from '../lib/levelPairing.mjs';
import { startTournament, advance } from '../lib/tournamentFlow.mjs';
import { getUnresolvedMatches, applyResult, loadEngineTournament, saveEngineTournament } from '../lib/tournamentEngine.mjs';
import { makeRng } from '../lib/simulation.mjs';

const config = {
  name: 'Level Cup',
  timeClass: 'rapid',
  timeControl: '420+5',
  rules: 'chess',
  requireRated: false,
  playerCap: { min: 2, max: 200 },
  swissRounds: 6,
  playoffCutoff: { method: 'rank', value: 'auto' },
  series: { swiss: 1, elimination: 3, semifinal: 3, final: 3 },
  phase: 'registration',
  currentRound: 0,
  rounds: []
};

// The registration form's answers: 2 strong, 11 casual, 12 rusty, 5 beginners (30 players).
const COUNTS = { 4: 2, 3: 11, 2: 12, 1: 5 };
function roster(counts = COUNTS) {
  const players = [];
  const levels = {};
  for (const [level, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) {
      const id = `p${level}_${i}`;
      players.push({ id, name: `L${level} ${i}`, chesscomUsername: `u${level}_${i}`, status: 'active' });
      levels[id] = Number(level);
    }
  }
  return { roster: { players }, levels };
}

test('levelFromAnswer reads the four form options, ignoring accents, case and a trailing dot', () => {
  assert.equal(levelFromAnswer('Juego mucho.'), 4);
  assert.equal(levelFromAnswer('Juego de vez en cuando'), 3);
  assert.equal(levelFromAnswer('Hace tiempo que no juego.'), 2);
  assert.equal(levelFromAnswer('Sé como se mueven las piezas, y poco más.'), 1);
  assert.equal(levelFromAnswer('SE COMO SE MUEVEN LAS PIEZAS'), 1);
  assert.equal(levelFromAnswer('otra cosa'), null);
});

test('pairByLevel: same level whenever possible; the odd one out plays the next level down', () => {
  const { levels } = roster();
  const players = Object.entries(levels).map(([id, level]) => ({ id, level }));
  for (let seed = 1; seed <= 20; seed++) {
    const { pairs, bye } = pairByLevel(players, makeRng(seed));
    assert.equal(bye, null);
    assert.equal(pairs.length, 15);
    assert.equal(new Set(pairs.flat()).size, 30);
    const mixed = pairs.filter(([a, b]) => levels[a] !== levels[b]).map(([a, b]) => [levels[a], levels[b]].sort().join('-'));
    // 2 strong pair up; 11 casual leave one for a rusty player; 11 rusty leave one for a beginner.
    assert.deepEqual(mixed.sort(), ['2-3', '1-2'].sort(), `seed ${seed}`);
  }
});

test('pairByLevel with an odd number gives one bye and pairs everybody else', () => {
  const players = [4, 3, 3, 2, 1].map((level, i) => ({ id: `x${i}`, level }));
  const { pairs, bye } = pairByLevel(players, makeRng(3));
  assert.ok(bye);
  assert.equal(pairs.length, 2);
  assert.ok(!pairs.flat().includes(bye));
});

test('startTournament with levels: round 1 by level, later rounds by the library and never a rematch', () => {
  const { roster: r, levels } = roster();
  const { engine, tournament } = startTournament({ tournament: config, roster: r, levels, rng: makeRng(7), now: '2026-11-09T08:00:00.000Z' });
  const round1 = getUnresolvedMatches(engine, 1);
  assert.equal(round1.length, 15);
  const strong = round1.find((m) => levels[m.player1.id] === 4);
  assert.equal(levels[strong.player2.id], 4, 'los dos de «juego mucho» juegan entre sí');
  assert.equal(round1.filter((m) => levels[m.player1.id] !== levels[m.player2.id]).length, 2);

  // Through a save/load (as the workflows do), then play everything out: nobody meets the same rival twice.
  const reloaded = loadEngineTournament(JSON.parse(saveEngineTournament(engine)));
  let t = tournament;
  for (let round = 1; round <= 6; round++) {
    for (const m of getUnresolvedMatches(reloaded, round)) applyResult(reloaded, m.id, 'player1_win');
    if (round < 6) t = advance({ engine: reloaded, tournament: t, overrides: { overrides: [] }, now: '2026-11-16T08:00:00.000Z' }).tournament;
  }
  for (const p of reloaded.getPlayers()) {
    const opponents = p.getMatches().map((m) => m.opponent).filter(Boolean);
    assert.equal(new Set(opponents).size, opponents.length, `${p.getId()} repite rival`);
  }
});

test('advance-tournament.mjs start-tournament --levels --start-at runs as a process and opens round 1 then', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'frog-start-'));
  mkdirSync(path.join(dir, 'public'));
  const { roster: r, levels } = roster({ 4: 2, 3: 3, 2: 3 });
  const write = (f, v) => writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  write('tournament.json', config);
  write('players.json', r);
  write('engine-state.json', 'null');
  write('overrides.json', { overrides: [] });
  const byUser = Object.fromEntries(r.players.map((p) => [p.chesscomUsername.toUpperCase(), levels[p.id]]));
  byUser[r.players[0].chesscomUsername] = 'Juego mucho.';
  write('levels.json', byUser);

  const script = fileURLToPath(new URL('../advance-tournament.mjs', import.meta.url));
  const run = spawnSync(
    process.execPath,
    [script, '--action=start-tournament', `--levels=${path.join(dir, 'levels.json')}`, '--start-at=2026-11-09T09:00:00+01:00'],
    { env: { ...process.env, FROG_DATA_DIR: dir, FROG_SKIP_GIT: '1' }, encoding: 'utf8' }
  );
  assert.equal(run.status, 0, run.stderr);

  const tournament = JSON.parse(readFileSync(path.join(dir, 'tournament.json'), 'utf8'));
  assert.equal(tournament.phase, 'stage-one');
  assert.equal(tournament.rounds[0].startedAt, '2026-11-09T08:00:00.000Z');
  const engine = loadEngineTournament(JSON.parse(readFileSync(path.join(dir, 'engine-state.json'), 'utf8')));
  const strong = getUnresolvedMatches(engine, 1).find((m) => levels[m.player1.id] === 4 || levels[m.player2.id] === 4);
  assert.equal(levels[strong.player1.id], levels[strong.player2.id]);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'public', 'rounds.json'), 'utf8')).rounds[0].pairings.length, 4);
});
