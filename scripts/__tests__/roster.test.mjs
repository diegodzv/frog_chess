// Registration from a Microsoft Forms export: CSV parsing, merge into players.json, chess.com check,
// and import-players.mjs run as a process against a temporary data directory (chess.com stubbed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCsv, extractRegistrations, normalizeUsername, mergeRegistrations, verifyRoster } from '../lib/roster.mjs';
import { startTournament } from '../lib/tournamentFlow.mjs';

const script = fileURLToPath(new URL('../import-players.mjs', import.meta.url));
const stub = pathToFileURL(fileURLToPath(new URL('./helpers/stub-chesscom.mjs', import.meta.url))).href;

// What "Open in Excel" + "Save as CSV UTF-8" gives with a Spanish Excel: BOM, `;`, CRLF, quoted fields.
const HEADER = 'Id;Hora de inicio;Hora de finalización;Correo electrónico;Nombre;Nombre y apellidos;Usuario de chess.com';
const row = (id, email, account, name, user) => `${id};10/30/26 9:00:00;10/30/26 9:01:00;${email};${account};${name};${user}`;
const CSV =
  '﻿' +
  [
    HEADER,
    row(1, 'ada@empresa.com', 'Ada L.', '"Lovelace, Ada"', 'adalovelace'),
    row(2, 'bob@empresa.com', 'Bob', 'Bob Esponja', 'https://www.chess.com/member/Bob'),
    row(3, 'carl@empresa.com', 'Carl', 'Carl Primero', '@carl'),
    row(4, 'carl@empresa.com', 'Carl', 'Carl Segundo', 'carl'),
    row(5, 'eve@empresa.com', 'Eve', 'Eve', 'no vale!'),
    row(6, 'mallory@empresa.com', 'Mallory', 'Mallory', 'ADALOVELACE')
  ].join('\r\n') +
  '\r\n';

const baseTournament = {
  name: 'Test Cup',
  timeClass: 'blitz',
  rules: 'chess',
  requireRated: false,
  playerCap: { min: 2, max: 200 },
  swissRounds: 'auto',
  playoffCutoff: { method: 'rank', value: 'auto' },
  phase: 'registration',
  currentRound: 0,
  rounds: []
};

test('parseCsv: BOM, `;` delimiter, CRLF and quoted fields with the delimiter inside', () => {
  const rows = parseCsv(CSV);
  assert.equal(rows.length, 7);
  assert.equal(rows[0][0], 'Id');
  assert.equal(rows[1][5], 'Lovelace, Ada');
  assert.deepEqual(parseCsv('a,b\n"x ""y""",z\n'), [['a', 'b'], ['x "y"', 'z']]);
});

test('extractRegistrations finds the question columns (not the Forms account "Nombre")', () => {
  const regs = extractRegistrations(parseCsv(CSV));
  assert.deepEqual(regs[0], { line: 2, name: 'Lovelace, Ada', username: 'adalovelace', email: 'ada@empresa.com' });
  assert.throws(() => extractRegistrations([['Id', 'Pregunta 1']]), /Cabeceras del fichero/);
});

test('normalizeUsername accepts plain names, @names and profile links', () => {
  assert.equal(normalizeUsername(' @Bob '), 'Bob');
  assert.equal(normalizeUsername('https://www.chess.com/member/Hikaru?ref=x'), 'Hikaru');
  assert.equal(normalizeUsername('no vale!'), null);
  assert.equal(normalizeUsername('ab'), null);
});

test('mergeRegistrations: last answer per person, no duplicate usernames, unverified, no e-mails stored', () => {
  const { roster, added, skipped } = mergeRegistrations({ players: [] }, extractRegistrations(parseCsv(CSV)), {
    maxPlayers: 200,
    now: '2026-11-01T00:00:00.000Z'
  });
  assert.deepEqual(added.map((p) => [p.name, p.chesscomUsername]), [
    ['Lovelace, Ada', 'adalovelace'],
    ['Bob Esponja', 'Bob'],
    ['Carl Segundo', 'carl']
  ]);
  assert.ok(added.every((p) => p.chesscomVerified === false && p.status === 'active'));
  assert.deepEqual(skipped.map((s) => s.line).sort(), [4, 6, 7]);
  assert.match(skipped.find((s) => s.line === 7).reason, /ya inscrito por Lovelace, Ada/);
  assert.ok(!JSON.stringify(roster).includes('@empresa.com'));
});

test('mergeRegistrations is idempotent and respects the player cap', () => {
  const regs = extractRegistrations(parseCsv(CSV));
  const first = mergeRegistrations({ players: [] }, regs, { maxPlayers: 200 });
  const again = mergeRegistrations(first.roster, regs, { maxPlayers: 200 });
  assert.equal(again.added.length, 0);
  assert.equal(again.roster.players.length, 3);

  const capped = mergeRegistrations({ players: [] }, regs, { maxPlayers: 2 });
  assert.equal(capped.added.length, 2);
  assert.ok(capped.skipped.some((s) => /aforo completo/.test(s.reason)));
});

test('verifyRoster fixes the casing, marks verified and reports missing accounts', async () => {
  const roster = {
    players: [
      { id: 'a', name: 'Ada', chesscomUsername: 'adalovelace', status: 'active', chesscomVerified: false },
      { id: 'x', name: 'Ghost', chesscomUsername: 'ghost', status: 'active', chesscomVerified: false },
      { id: 'b', name: 'Bob', chesscomUsername: 'bob', status: 'active', chesscomVerified: true }
    ]
  };
  const profiles = { adalovelace: { username: 'AdaLovelace', player_id: 1 } };
  const asked = [];
  const result = await verifyRoster(roster, async (u) => (asked.push(u), profiles[u] ?? null));
  assert.deepEqual(asked, ['adalovelace', 'ghost'], 'already verified players are not asked again');
  assert.equal(result.roster.players[0].chesscomUsername, 'AdaLovelace');
  assert.equal(result.roster.players[0].chesscomVerified, true);
  assert.deepEqual(result.invalid.map((p) => p.id), ['x']);
  assert.equal(roster.players[0].chesscomVerified, false, 'the input is not mutated');
});

test('the tournament cannot start while some imported username is unverified', () => {
  const players = ['adalovelace', 'bob', 'carl'].map((u, i) => ({ id: `p${i}`, name: u, chesscomUsername: u, status: 'active' }));
  players[2].chesscomVerified = false;
  assert.throws(() => startTournament({ tournament: baseTournament, roster: { players } }), /sin comprobar \(carl\).*check-players/);
});

function dataDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'frog-import-'));
  mkdirSync(path.join(dir, 'public'));
  writeFileSync(path.join(dir, 'tournament.json'), JSON.stringify(baseTournament));
  writeFileSync(path.join(dir, 'players.json'), JSON.stringify({ players: [] }));
  writeFileSync(path.join(dir, 'engine-state.json'), 'null');
  writeFileSync(path.join(dir, 'export.csv'), CSV);
  return dir;
}

const runImport = (dir, ...args) =>
  spawnSync(process.execPath, ['--import', stub, script, path.join(dir, 'export.csv'), ...args], {
    env: { ...process.env, FROG_DATA_DIR: dir, FROG_SKIP_GIT: '1' },
    encoding: 'utf8'
  });
const players = (dir) => JSON.parse(readFileSync(path.join(dir, 'players.json'), 'utf8')).players;

test('import-players.mjs --check imports and verifies against chess.com, and rebuilds the public data', () => {
  const dir = dataDir();
  const r = runImport(dir, '--check');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(players(dir).map((p) => [p.chesscomUsername, p.chesscomVerified]), [
    ['AdaLovelace', true],
    ['bob', true],
    ['Carl', true]
  ]);
  const pub = JSON.parse(readFileSync(path.join(dir, 'public', 'players.json'), 'utf8'));
  assert.equal(pub.players.length, 3);
  assert.ok(!readFileSync(path.join(dir, 'players.json'), 'utf8').includes('@empresa.com'));
});

test('import-players.mjs --dry-run writes nothing; without --check players stay unverified', () => {
  const dir = dataDir();
  const dry = runImport(dir, '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Nuevos: 3/);
  assert.deepEqual(players(dir), []);

  const r = runImport(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(players(dir).every((p) => p.chesscomVerified === false));
});

test('import-players.mjs refuses once registration is closed', () => {
  const dir = dataDir();
  writeFileSync(path.join(dir, 'tournament.json'), JSON.stringify({ ...baseTournament, phase: 'stage-one' }));
  const r = runImport(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cerrada/);
});
