#!/usr/bin/env node
// Run by .github/workflows/advance-round.yml, triggered manually by an
// organizer via workflow_dispatch. Actions: check-players | start-tournament | apply-overrides | rebuild-public-data | next-round | force-next-round.
// The tournament logic lives in lib/tournamentFlow.mjs; this script only does I/O.

import { loadEngineTournament, saveEngineTournament } from './lib/tournamentEngine.mjs';
import { startTournament, advance, applyPendingOverrides } from './lib/tournamentFlow.mjs';
import { readJson, writeJson } from './lib/repoData.mjs';
import { commitAndPush } from './lib/commitAndPush.mjs';
import { readFile } from 'node:fs/promises';
import { verifyRoster } from './lib/roster.mjs';
import { levelFromAnswer } from './lib/levelPairing.mjs';
import { getPlayerProfile } from './lib/chesscomClient.mjs';
import { buildPublicData } from './build-public-data.mjs';

function getFlag(name) {
  const flag = process.argv.find((a) => a.startsWith(`--${name}=`));
  return flag ? flag.slice(name.length + 3) : null;
}

function getAction() {
  return getFlag('action') ?? process.env.ACTION;
}

/**
 * --levels=<file.json>: { "chesscomUsername": 1-4 | "form answer" } -> { playerId: level }. Kept outside the
 * repo (self-reported levels are not published); only used to pair round 1 by level.
 */
async function readLevels(roster) {
  const file = getFlag('levels');
  if (!file) return null;
  const byUser = JSON.parse(await readFile(file, 'utf8'));
  const levels = {};
  for (const [username, value] of Object.entries(byUser)) {
    const player = roster.players.find((p) => p.status === 'active' && p.chesscomUsername.toLowerCase() === username.toLowerCase());
    const level = typeof value === 'number' ? value : levelFromAnswer(value);
    if (!player) throw new Error(`--levels: "${username}" no es ningún jugador inscrito.`);
    if (level == null) throw new Error(`--levels: nivel no reconocido para ${username}: "${value}".`);
    levels[player.id] = level;
  }
  const missing = roster.players.filter((p) => p.status === 'active' && levels[p.id] == null);
  if (missing.length) console.warn(`Sin nivel (se emparejan como el nivel más bajo): ${missing.map((p) => p.chesscomUsername).join(', ')}`);
  return levels;
}

/**
 * Checks the players imported from Microsoft Forms against chess.com (canonical casing, the account exists).
 * Saves what could be verified even if some usernames are wrong, then fails listing them.
 */
async function checkPlayers() {
  const { roster, verified, invalid } = await verifyRoster(await readJson('players.json'), getPlayerProfile);
  if (verified.length > 0) {
    await writeJson('players.json', roster);
    await buildPublicData();
    commitAndPush(`inscripción: ${verified.length} usuario(s) de chess.com comprobado(s)`);
  }
  console.log(`Comprobados: ${verified.length}${verified.length ? ` (${verified.map((p) => p.chesscomUsername).join(', ')})` : ''}.`);
  if (invalid.length > 0) {
    const list = invalid.map((p) => `${p.name} (${p.chesscomUsername}): ${p.reason}`).join('\n  - ');
    throw new Error(`${invalid.length} usuario(s) sin validar:
  - ${list}
Corrige su usuario en data/players.json (o pon "status": "withdrawn") y repite check-players.`);
  }
}

async function start() {
  const roster = await readJson('players.json');
  const { engine, tournament } = startTournament({
    tournament: await readJson('tournament.json'),
    roster,
    levels: await readLevels(roster),
    // --start-at=<ISO date>: when round 1 opens (games before it don't count). Default: now.
    now: getFlag('start-at') ? new Date(getFlag('start-at')).toISOString() : undefined
  });

  await writeJson('engine-state.json', saveEngineTournament(engine));
  await writeJson('tournament.json', tournament);

  await buildPublicData();
  commitAndPush(
    `torneo: inicio, ronda 1 (${tournament.playerCount} jugadores, ${tournament.swissRounds} rondas suizas, corte a ${tournament.playoffCutoff.value})`
  );
  console.log(
    `Tournament started with ${tournament.playerCount} players: ${tournament.swissRounds} swiss rounds, top ${tournament.playoffCutoff.value} advance.`
  );
}

/** Records the organizer's manual results (data/overrides.json) in the current round without advancing it. */
async function applyOverrides() {
  const engine = loadEngineTournament(await readJson('engine-state.json'));
  const tournament = await readJson('tournament.json');
  const { overrides, applied, skipped } = applyPendingOverrides({ engine, tournament, overrides: await readJson('overrides.json') });
  for (const ov of skipped) {
    console.warn(`::warning::Override sin aplicar (${JSON.stringify(ov)}): no coincide con ninguna partida pendiente de la ronda actual. ¿Usuario mal escrito, id incorrecto o partida ya resuelta?`);
  }
  if (applied === 0) {
    console.log('No hay overrides pendientes que apliquen a partidas sin resolver de la ronda actual.');
    return;
  }

  await writeJson('engine-state.json', saveEngineTournament(engine));
  await writeJson('overrides.json', overrides);
  await buildPublicData();
  commitAndPush(`torneo: ${applied} resultado(s) manual(es) en la ronda ${tournament.currentRound}`);
  console.log(`Applied ${applied} override(s) to round ${tournament.currentRound}.`);
}

/** Regenerates data/public/*.json (e.g. after editing players.json by hand) and commits it. */
async function rebuildPublicData() {
  await buildPublicData();
  const committed = commitAndPush('datos públicos: reconstruidos a mano');
  console.log(committed ? 'Public data rebuilt and committed.' : 'Public data already up to date.');
}

async function next(force) {
  const engine = loadEngineTournament(await readJson('engine-state.json'));
  const result = advance({
    engine,
    tournament: await readJson('tournament.json'),
    overrides: await readJson('overrides.json'),
    force
  });

  // Nothing is written before `advance` succeeds, so a failed advance never
  // leaves overrides marked as applied without the engine having received them.
  await writeJson('engine-state.json', saveEngineTournament(engine));
  await writeJson('overrides.json', result.overrides);
  await writeJson('tournament.json', result.tournament);

  await buildPublicData();
  const label = result.finished ? 'torneo finalizado' : `avance a ronda ${result.tournament.currentRound} (${result.tournament.phase})`;
  commitAndPush(`torneo: ${label}`);
  console.log(result.finished ? 'Tournament finished.' : `Advanced to round ${result.tournament.currentRound}, phase ${result.tournament.phase}.`);
}

async function main() {
  const action = getAction();
  if (action === 'check-players') return checkPlayers();
  if (action === 'start-tournament') return start();
  if (action === 'apply-overrides') return applyOverrides();
  if (action === 'rebuild-public-data') return rebuildPublicData();
  if (action === 'next-round') return next(false);
  if (action === 'force-next-round') return next(true);
  throw new Error(`Acción desconocida: "${action}". Usa check-players | start-tournament | apply-overrides | rebuild-public-data | next-round | force-next-round.`);
}

await main();
