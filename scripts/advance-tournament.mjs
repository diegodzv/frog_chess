#!/usr/bin/env node
// Run by .github/workflows/advance-round.yml, triggered manually by an
// organizer via workflow_dispatch. Actions: start-tournament | apply-overrides | rebuild-public-data | next-round | force-next-round.
// The tournament logic lives in lib/tournamentFlow.mjs; this script only does I/O.

import { loadEngineTournament, saveEngineTournament } from './lib/tournamentEngine.mjs';
import { startTournament, advance, applyPendingOverrides } from './lib/tournamentFlow.mjs';
import { readJson, writeJson } from './lib/repoData.mjs';
import { commitAndPush } from './lib/commitAndPush.mjs';
import { buildPublicData } from './build-public-data.mjs';

function getAction() {
  const flag = process.argv.find((a) => a.startsWith('--action='));
  return flag ? flag.split('=')[1] : process.env.ACTION;
}

async function start() {
  const { engine, tournament } = startTournament({
    tournament: await readJson('tournament.json'),
    roster: await readJson('players.json')
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
  if (action === 'start-tournament') return start();
  if (action === 'apply-overrides') return applyOverrides();
  if (action === 'rebuild-public-data') return rebuildPublicData();
  if (action === 'next-round') return next(false);
  if (action === 'force-next-round') return next(true);
  throw new Error(`Acción desconocida: "${action}". Usa start-tournament | apply-overrides | rebuild-public-data | next-round | force-next-round.`);
}

await main();
