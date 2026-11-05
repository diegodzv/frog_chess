// Runs sync-results.mjs as the hourly workflow does, against a temporary data directory with a started
// Bo1 swiss tournament and chess.com's archives stubbed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startTournament } from '../lib/tournamentFlow.mjs';
import { saveEngineTournament, loadEngineTournament, getUnresolvedMatches } from '../lib/tournamentEngine.mjs';

const script = fileURLToPath(new URL('../sync-results.mjs', import.meta.url));
const stub = pathToFileURL(fileURLToPath(new URL('./helpers/stub-chesscom-games.mjs', import.meta.url))).href;

const config = {
  name: 'Sync Cup',
  timeClass: 'blitz',
  rules: 'chess',
  requireRated: false,
  playerCap: { min: 8, max: 200 },
  swissRounds: 3,
  playoffCutoff: { method: 'rank', value: 4 },
  series: { swiss: 1, elimination: 3, semifinal: 5, final: 5 },
  phase: 'registration',
  currentRound: 0,
  rounds: []
};
const roster = {
  players: Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}`, chesscomUsername: `j${i + 1}`, status: 'active' }))
};

const PGN = (moves) =>
  `[Event "Live Chess"]\n[TimeControl "360+2"]\n\n` +
  Array.from({ length: moves }, (_, i) => `${i + 1}. a3 {[%clk 0:06:00]} ${i + 1}... a6 {[%clk 0:06:00]}`).join(' ') +
  ' 1-0';

// An open round is searched up to "now", so the fake round started two days ago.
const ROUND_START = Date.now() - 2 * 86_400_000;
let n = 0;
function game(white, black, whiteResult, blackResult, extra = {}) {
  return {
    url: `https://www.chess.com/game/live/${++n}`,
    end_time: Math.floor((ROUND_START + 86_400_000) / 1000) + n * 600,
    time_class: 'blitz',
    rules: 'chess',
    rated: true,
    time_control: '360+2',
    pgn: PGN(20),
    fen: '4k3/8/8/8/8/8/8/R3K2Q w - - 0 40',
    white: { username: white, result: whiteResult },
    black: { username: black, result: blackResult },
    ...extra
  };
}

test('sync resolves a decisive Bo1, keeps a drawn one pending and flags games with the wrong time control', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'frog-sync-'));
  mkdirSync(path.join(dir, 'public'));
  const started = startTournament({ tournament: config, roster, now: new Date(ROUND_START).toISOString() });
  const write = (f, v) => writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  write('tournament.json', started.tournament);
  write('players.json', roster);
  write('engine-state.json', saveEngineTournament(started.engine));
  write('overrides.json', { overrides: [] });
  write('needs-review.json', { items: [] });

  const [m1, m2, m3] = getUnresolvedMatches(started.engine, 1);
  const u = (id) => started.engine.getPlayer(id).getMeta().chesscomUsername;
  // m1: player2 (white) checkmates player1. m2: one draw. m3: played as rapid.
  const games = {
    [u(m1.player1.id)]: [game(u(m1.player2.id), u(m1.player1.id), 'win', 'checkmated')],
    [u(m2.player1.id)]: [game(u(m2.player1.id), u(m2.player2.id), 'agreed', 'agreed')],
    [u(m3.player1.id)]: [game(u(m3.player1.id), u(m3.player2.id), 'win', 'resigned', { time_class: 'rapid' })]
  };
  write('stub-games.json', games);

  const r = spawnSync(process.execPath, ['--import', stub, script], {
    env: { ...process.env, FROG_DATA_DIR: dir, FROG_SKIP_GIT: '1', FROG_STUB_GAMES: path.join(dir, 'stub-games.json') },
    encoding: 'utf8'
  });
  assert.equal(r.status, 0, r.stderr);

  const read = (f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  const engine = loadEngineTournament(read('engine-state.json'));

  const resolved = engine.getMatch(m1.id);
  assert.equal(resolved.active, false);
  assert.deepEqual([resolved.player1.win, resolved.player2.win], [0, 1]);
  assert.equal(resolved.getMeta().source, 'chesscom');
  assert.equal(resolved.getMeta().chesscomGames[0].termination, 'checkmated');

  const drawn = engine.getMatch(m2.id);
  assert.equal(drawn.active, true, 'a drawn Bo1 stays pending');
  assert.deepEqual(drawn.getMeta().games, ['draw']);

  const review = read('needs-review.json').items;
  assert.deepEqual(review.map((i) => [i.matchId, i.reason]), [[m3.id, 'wrong_format']]);

  const stats = read('public/stats.json');
  assert.equal(stats.gamesAnalyzed, 1);
  assert.equal(stats.fastestByMoves[0].player.id, m1.player2.id, 'the winner, never the loser');
  assert.equal(stats.fastestByMoves[0].moves, 20);
  assert.equal(stats.mostMaterial[0].material, 14);
  assert.equal(stats.mostCheckmates[0].checkmates, 1);

  const pending = read('public/rounds.json').rounds[0].pairings.find((p) => p.matchId === m2.id);
  assert.equal(pending.status, 'pending');
  assert.deepEqual(pending.games, ['draw']);
});
