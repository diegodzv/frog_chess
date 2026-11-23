#!/usr/bin/env node
// Run by .github/workflows/advance-round.yml, triggered manually by an
// organizer via workflow_dispatch. Actions: check-players | start-tournament | apply-overrides | rebuild-public-data | add-late-pair | next-round | force-next-round.
// The tournament logic lives in lib/tournamentFlow.mjs; this script only does I/O.

import { loadEngineTournament, saveEngineTournament, setPlayoffCutoff, setPlayerUsername, addLatePair } from './lib/tournamentEngine.mjs';
import { startTournament, advance, applyPendingOverrides } from './lib/tournamentFlow.mjs';
import { readJson, writeJson } from './lib/repoData.mjs';
import { commitAndPush } from './lib/commitAndPush.mjs';
import { readFile } from 'node:fs/promises';
import { verifyRoster, changeUsername, slugify, canonicalUsername } from './lib/roster.mjs';
import { levelFromAnswer } from './lib/levelPairing.mjs';
import { makeRng } from './lib/simulation.mjs';
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
    // --seed=<n>: reproducible round-1 draw (same roster + levels + seed = same pairings, e.g. a preview).
    rng: getFlag('seed') ? makeRng(Number(getFlag('seed'))) : undefined,
    // --allow-unverified: start even if some usernames are unconfirmed (hidden on the site, not synced until fixed).
    allowUnverified: process.argv.includes('--allow-unverified'),
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

/**
 * set-cutoff --value=<n>: how many players go through to the bracket (power of two), decided during the swiss
 * stage. Also recorded as the configured value, so a reset keeps the organizers' decision.
 */
async function setCutoff() {
  const value = Number(getFlag('value') ?? process.env.CUTOFF);
  const engine = loadEngineTournament(await readJson('engine-state.json'));
  setPlayoffCutoff(engine, value);
  const tournament = await readJson('tournament.json');
  tournament.playoffCutoff = { method: 'rank', value };
  if (tournament.configured) tournament.configured.playoffCutoff = { method: 'rank', value };
  await writeJson('engine-state.json', saveEngineTournament(engine));
  await writeJson('tournament.json', tournament);
  await buildPublicData();
  commitAndPush(`torneo: pasan a eliminatorias los ${value} primeros`);
  console.log(`Playoff cutoff set to ${value}.`);
}

/**
 * set-username --player=<current username> --to=<new username>: corrects a player's chess.com account (checked on
 * chess.com) in players.json and, once the tournament has started, in the engine, so their games are synced.
 */
async function setUsername() {
  const from = getFlag('player') ?? process.env.PLAYER;
  const to = getFlag('to') ?? process.env.TO;
  if (!from || !to) throw new Error('Uso: --action=set-username --player=<usuario actual> --to=<usuario nuevo>');
  const profile = await getPlayerProfile(to);
  if (!profile) throw new Error(`No existe ningún usuario de chess.com llamado "${to}".`);
  const { roster, player } = changeUsername(await readJson('players.json'), from, profile);
  await writeJson('players.json', roster);
  const engineState = await readJson('engine-state.json');
  if (engineState) {
    const engine = loadEngineTournament(engineState);
    setPlayerUsername(engine, player.id, player.chesscomUsername);
    await writeJson('engine-state.json', saveEngineTournament(engine));
  }
  await buildPublicData();
  commitAndPush(`inscripción: ${player.name} juega con el usuario ${player.chesscomUsername}`);
  console.log(`${player.name}: ${from} -> ${player.chesscomUsername}`);
}

/**
 * add-late-pair --a=<user> --a-name=<name> --b=<user> --b-name=<name> [--rounds=1,2]: two players who join during
 * the swiss stage play each other once for every round already opened (default: 1..current round), counted in
 * those rounds; from the next round on they are paired normally. Both accounts are checked on chess.com.
 */
async function addLatePlayers() {
  const tournament = await readJson('tournament.json');
  if (tournament.phase !== 'stage-one') throw new Error('Solo se pueden incorporar jugadores durante la fase suiza.');
  const entries = [
    [getFlag('a') ?? process.env.PLAYER_A, getFlag('a-name') ?? process.env.NAME_A],
    [getFlag('b') ?? process.env.PLAYER_B, getFlag('b-name') ?? process.env.NAME_B]
  ];
  if (entries.some(([u, n]) => !u || !n)) throw new Error('Uso: --action=add-late-pair --a=<usuario> --a-name=<nombre> --b=<usuario> --b-name=<nombre>');
  const roster = await readJson('players.json');
  const players = [];
  for (const [username, name] of entries) {
    const profile = await getPlayerProfile(String(username).replace(/^@/, ''));
    if (!profile) throw new Error(`No existe ningún usuario de chess.com llamado "${username}".`);
    const canonical = canonicalUsername(profile);
    const clash = roster.players.find((p) => p.status === 'active' && p.chesscomUsername.toLowerCase() === canonical.toLowerCase());
    if (clash) throw new Error(`El usuario "${canonical}" ya es de ${clash.name}.`);
    players.push({
      id: slugify(name, canonical),
      name: String(name).trim(),
      chesscomUsername: canonical,
      status: 'active',
      registeredAt: new Date().toISOString(),
      source: 'late-entry',
      chesscomVerified: true,
      chesscomPlayerId: profile.player_id
    });
  }
  const rounds = getFlag('rounds')
    ? getFlag('rounds').split(',').map(Number)
    : Array.from({ length: tournament.currentRound }, (_, i) => i + 1);
  const current = tournament.rounds.find((r) => r.number === tournament.currentRound);

  const engine = loadEngineTournament(await readJson('engine-state.json'));
  addLatePair(engine, players, rounds, current?.startedAt ?? new Date().toISOString());
  roster.players.push(...players);
  tournament.playerCount = roster.players.filter((p) => p.status === 'active').length;
  await writeJson('players.json', roster);
  await writeJson('tournament.json', tournament);
  await writeJson('engine-state.json', saveEngineTournament(engine));
  await buildPublicData();
  commitAndPush(`inscripción: se incorporan ${players.map((p) => p.name).join(' y ')} (rondas ${rounds.join(', ')} entre ellos)`);
  console.log(`Incorporados ${players.map((p) => `${p.name} (${p.chesscomUsername})`).join(' y ')}: rondas ${rounds.join(', ')} entre ellos.`);
}

/** Regenerates data/public/*.json (e.g. after editing players.json by hand) and commits it. */
async function rebuildPublicData() {
  await buildPublicData();
  const committed = commitAndPush('datos públicos: reconstruidos a mano');
  console.log(committed ? 'Public data rebuilt and committed.' : 'Public data already up to date.');
}

const RESULT_KINDS = {
  'gana-jugador-1': 'winner',
  winner: 'winner',
  'sorteo-gana-jugador-1': 'coin_toss',
  coin_toss: 'coin_toss',
  'pierden-los-dos': 'double_forfeit',
  double_forfeit: 'double_forfeit'
};

/**
 * manual-result (workflow "Resultado manual", usable from the phone): adds an overrides.json entry for one pairing
 * of the current round and applies it; with ADVANCE=true it then closes the round and opens the next one
 * (force-next-round). RESULT=gana-jugador-1: PLAYER_A beats PLAYER_B (walkover); RESULT=sorteo-gana-jugador-1: the same,
 * decided by drawing lots after a drawn game (the site shows a note);
 * RESULT=pierden-los-dos: neither played, both lose. Refuses, changing nothing, if the two usernames are not a
 * pending pairing of the current round (with IF_PENDING=true it only warns: the game was already synced).
 */
async function manualResult() {
  const kind = RESULT_KINDS[String(process.env.RESULT ?? '').trim()];
  const a = String(process.env.PLAYER_A ?? '').trim().replace(/^@/, '');
  const b = String(process.env.PLAYER_B ?? '').trim().replace(/^@/, '');
  const reason = String(process.env.REASON ?? '').trim();
  if (!kind) throw new Error(`Resultado no reconocido: "${process.env.RESULT}". Usa gana-jugador-1, sorteo-gana-jugador-1 o pierden-los-dos.`);
  if (!a || !b) throw new Error('Faltan los usuarios de chess.com de los dos jugadores.');

  const entry =
    kind === 'double_forfeit' ? { players: [a, b], outcome: 'double_forfeit' } : { winner: a, loser: b, ...(kind === 'coin_toss' ? { coinToss: true } : {}) };
  if (reason) entry.reason = reason;

  const tournament = await readJson('tournament.json');
  const engineJson = await readJson('engine-state.json');
  const current = await readJson('overrides.json');
  const withEntry = { overrides: [...current.overrides, entry] };
  // Try it on a throwaway copy first: nothing is written if the entry matches no pending pairing.
  const probe = applyPendingOverrides({ engine: loadEngineTournament(engineJson), tournament, overrides: withEntry });
  if (!probe.overrides.overrides.at(-1).applied) {
    // IF_PENDING=true (workflow "Cierre de ronda"): the game may have been played at the last minute and already
    // synced from chess.com; that result stands and the manual one is dropped.
    if (process.env.IF_PENDING === 'true') {
      console.log(`::warning::${a} - ${b}: la partida ya tiene resultado (de chess.com); se ignora el resultado manual.`);
      return;
    }
    throw new Error(`No hay ninguna partida pendiente de la ronda ${tournament.currentRound} entre "${a}" y "${b}". Revisa los usuarios (en la web, pestaña Rondas) o si esa partida ya tiene resultado.`);
  }
  await writeJson('overrides.json', withEntry);
  console.log(kind === 'double_forfeit' ? `Resultado: ${a} y ${b} pierden los dos.` : `Resultado: gana ${a} a ${b}${kind === 'coin_toss' ? ' (sorteo)' : ''}.`);
  return process.env.ADVANCE === 'true' ? next(true) : applyOverrides();
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
  if (action === 'set-cutoff') return setCutoff();
  if (action === 'set-username') return setUsername();
  if (action === 'manual-result') return manualResult();
  if (action === 'add-late-pair') return addLatePlayers();
  if (action === 'next-round') return next(false);
  if (action === 'force-next-round') return next(true);
  throw new Error(`Acción desconocida: "${action}". Usa check-players | start-tournament | apply-overrides | rebuild-public-data | set-cutoff | set-username | manual-result | add-late-pair | next-round | force-next-round.`);
}

await main();
