import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTournament } from '../lib/tournamentFlow.mjs';
import { saveEngineTournament } from '../lib/tournamentEngine.mjs';
import { generateRoster, makeRng } from '../lib/simulation.mjs';

const script = fileURLToPath(new URL('../dev/reset-tournament.mjs', import.meta.url));
const seedData = fileURLToPath(new URL('../../data', import.meta.url));

function startedDataDir({ cutoff = 'auto' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'frog-reset-'));
  cpSync(seedData, dir, { recursive: true });
  const { players } = generateRoster(12, makeRng(3));
  const config = JSON.parse(readFileSync(path.join(dir, 'tournament.json'), 'utf8'));
  config.playoffCutoff = { method: 'rank', value: cutoff };
  const { engine, tournament } = startTournament({ tournament: config, roster: { players } });
  const write = (f, v) => writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  write('players.json', { players });
  write('tournament.json', tournament);
  write('engine-state.json', saveEngineTournament(engine));
  write('overrides.json', { overrides: [{ matchId: 'x', outcome: 'player1_win', applied: true }] });
  return { dir, players, tournament };
}

const run = (dir, ...args) =>
  spawnSync(process.execPath, [script, ...args], { env: { ...process.env, FROG_DATA_DIR: dir, FROG_SKIP_GIT: '1' }, encoding: 'utf8' });
const read = (dir, f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));

test('refuses to run without --yes and touches nothing', () => {
  const { dir, tournament } = startedDataDir();
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--yes/);
  assert.deepEqual(read(dir, 'tournament.json'), tournament);
});

test('--yes --keep-players goes back to registration with the roster intact and the configured format restored', () => {
  const { dir, players, tournament } = startedDataDir({ cutoff: 4 });
  assert.equal(tournament.swissRounds, 4, 'tras iniciar, las rondas suizas son un número concreto');

  const r = run(dir, '--yes', '--keep-players');
  assert.equal(r.status, 0, r.stderr);
  const after = read(dir, 'tournament.json');
  assert.equal(after.phase, 'registration');
  assert.equal(after.currentRound, 0);
  assert.deepEqual(after.rounds, []);
  assert.equal(after.swissRounds, 'auto', 'lo configurado antes de iniciar');
  assert.deepEqual(after.playoffCutoff, { method: 'rank', value: 4 }, 'un corte explícito se conserva');
  assert.equal(after.playerCount, undefined);
  assert.equal(after.configured, undefined);
  assert.deepEqual(after.series, tournament.series);
  assert.equal(readFileSync(path.join(dir, 'engine-state.json'), 'utf8').trim(), 'null');
  assert.deepEqual(read(dir, 'overrides.json'), { overrides: [] });
  assert.equal(read(dir, 'players.json').players.length, players.length);
  assert.equal(read(dir, 'public/meta.json').phase, 'registration');
  assert.equal(read(dir, 'public/meta.json').playerCount, players.length);
  assert.deepEqual(read(dir, 'public/standings.json').rows, []);
});

test('--yes alone also empties the roster', () => {
  const { dir } = startedDataDir();
  assert.equal(run(dir, '--yes').status, 0);
  assert.deepEqual(read(dir, 'players.json'), { players: [] });
  assert.equal(read(dir, 'public/meta.json').playerCount, 0);
});
