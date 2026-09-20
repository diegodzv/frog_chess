// Runs register-player.mjs as the GitHub workflow does (env vars, issue-form markdown,
// $GITHUB_OUTPUT) against a temporary data directory, with chess.com stubbed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(new URL('../register-player.mjs', import.meta.url));
const stub = pathToFileURL(fileURLToPath(new URL('./helpers/stub-chesscom.mjs', import.meta.url))).href;

const baseTournament = {
  name: 'Test Cup',
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

function issueBody(name, username) {
  return [
    '### Nombre completo',
    '',
    name,
    '',
    '### Usuario de chess.com',
    '',
    username,
    '',
    '### Consentimiento',
    '',
    '- [X] Acepto que mi nombre y usuario de chess.com sean visibles públicamente en este repositorio mientras dure el torneo.'
  ].join('\n');
}

function setup({ tournament = {}, players = [] } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'frog-register-'));
  mkdirSync(path.join(dir, 'public'));
  const write = (file, value) =>
    writeFileSync(path.join(dir, file), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  write('tournament.json', { ...baseTournament, ...tournament });
  write('players.json', { players });
  write('engine-state.json', 'null');
  return dir;
}

function register(dir, { name, username, issue = 1 }) {
  const out = path.join(dir, 'github-output.txt');
  writeFileSync(out, '');
  const result = spawnSync(process.execPath, ['--import', stub, script], {
    env: {
      ...process.env,
      FROG_DATA_DIR: dir,
      FROG_SKIP_GIT: '1',
      ISSUE_BODY: issueBody(name, username),
      ISSUE_NUMBER: String(issue),
      GITHUB_OUTPUT: out
    },
    encoding: 'utf8'
  });
  const outputs = Object.fromEntries(
    readFileSync(out, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
  );
  const players = JSON.parse(readFileSync(path.join(dir, 'players.json'), 'utf8')).players;
  return { status: result.status, stderr: result.stderr, outputs, players };
}

test('a valid registration is accepted, stored with the canonical chess.com username and shown publicly', () => {
  const dir = setup();
  const r = register(dir, { name: 'Ada Lovelace', username: '@adalovelace', issue: 7 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.outputs.result, 'accepted');
  assert.equal(r.outputs.player_name, 'Ada Lovelace');
  assert.equal(r.outputs.player_username, 'AdaLovelace');
  assert.equal(r.players.length, 1);
  assert.deepEqual(
    {
      name: r.players[0].name,
      user: r.players[0].chesscomUsername,
      id: r.players[0].chesscomPlayerId,
      issue: r.players[0].issueNumber,
      status: r.players[0].status
    },
    { name: 'Ada Lovelace', user: 'AdaLovelace', id: 101, issue: 7, status: 'active' }
  );
  const publicPlayers = JSON.parse(readFileSync(path.join(dir, 'public', 'players.json'), 'utf8'));
  assert.equal(publicPlayers.players[0].name, 'Ada Lovelace');
  const meta = JSON.parse(readFileSync(path.join(dir, 'public', 'meta.json'), 'utf8'));
  assert.equal(meta.playerCount, 1);
});

test('editing an already registered issue changes nothing and does not post an error', () => {
  const dir = setup();
  register(dir, { name: 'Ada Lovelace', username: 'adalovelace', issue: 7 });
  const again = register(dir, { name: 'Ada Lovelace', username: 'adalovelace', issue: 7 });
  assert.equal(again.outputs.result, 'unchanged');
  assert.equal(again.players.length, 1);
});

test('editing a registered issue to a different username is rejected, not registered twice', () => {
  const dir = setup();
  register(dir, { name: 'Ada Lovelace', username: 'adalovelace', issue: 7 });
  const r = register(dir, { name: 'Ada Lovelace', username: 'bob', issue: 7 });
  assert.equal(r.outputs.result, 'rejected');
  assert.match(r.outputs.reason, /ya está registrado con el usuario "AdaLovelace"/);
  assert.equal(r.players.length, 1);
});

test('the same chess.com account cannot register twice from different issues (case-insensitive)', () => {
  const dir = setup();
  register(dir, { name: 'Ada Lovelace', username: 'adalovelace', issue: 7 });
  const r = register(dir, { name: 'Otra Persona', username: 'ADALOVELACE', issue: 8 });
  assert.equal(r.outputs.result, 'rejected');
  assert.match(r.outputs.reason, /ya está registrado/);
  assert.equal(r.players.length, 1);
});

test('a username that does not exist on chess.com is rejected with a clear reason', () => {
  const r = register(setup(), { name: 'Nadie', username: 'nobody-here', issue: 3 });
  assert.equal(r.outputs.result, 'rejected');
  assert.match(r.outputs.reason, /No existe ningún usuario de chess\.com llamado "nobody-here"/);
  assert.equal(r.players.length, 0);
});

test('when chess.com fails or blocks the runner the player gets a retry message instead of a crashed workflow', () => {
  const r = register(setup(), { name: 'Boom', username: 'boom', issue: 4 });
  assert.equal(r.status, 0);
  assert.equal(r.outputs.result, 'rejected');
  assert.match(r.outputs.reason, /No se pudo consultar chess\.com/);
});

test('registration is closed once the tournament has started', () => {
  const r = register(setup({ tournament: { phase: 'stage-one', currentRound: 1 } }), {
    name: 'Tarde',
    username: 'bob',
    issue: 5
  });
  assert.equal(r.outputs.result, 'rejected');
  assert.match(r.outputs.reason, /registro está cerrado/);
  assert.equal(r.players.length, 0);
});

test('the player cap is enforced', () => {
  const full = [{ id: 'p_x', name: 'X', chesscomUsername: 'x', status: 'active', issueNumber: 1 }];
  const r = register(setup({ tournament: { playerCap: { min: 8, max: 1 } }, players: full }), {
    name: 'Bob',
    username: 'bob',
    issue: 2
  });
  assert.equal(r.outputs.result, 'rejected');
  assert.match(r.outputs.reason, /aforo máximo/);
});

test('empty and oversized names are rejected', () => {
  const dir = setup();
  assert.match(register(dir, { name: '   ', username: 'bob', issue: 1 }).outputs.reason, /Falta el nombre/);
  assert.match(register(dir, { name: 'A'.repeat(61), username: 'bob', issue: 1 }).outputs.reason, /demasiado largo/);
  assert.equal(register(dir, { name: 'Bob', username: '', issue: 1 }).outputs.reason, 'Falta el usuario de chess.com.');
});

test('a withdrawn player frees the username for a new registration', () => {
  const dir = setup({
    players: [{ id: 'p_old', name: 'Old Ada', chesscomUsername: 'AdaLovelace', status: 'withdrawn', issueNumber: 1 }]
  });
  const r = register(dir, { name: 'Ada Lovelace', username: 'adalovelace', issue: 9 });
  assert.equal(r.outputs.result, 'accepted');
  assert.equal(r.players.filter((p) => p.status === 'active').length, 1);
});
