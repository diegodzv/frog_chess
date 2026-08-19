#!/usr/bin/env node
// Run by .github/workflows/advance-round.yml, triggered manually by an
// organizer via workflow_dispatch. Actions: start-tournament | next-round | force-next-round.

import {
  createEngineTournament,
  loadEngineTournament,
  saveEngineTournament,
  getUnresolvedMatches,
  applyResult,
  applyDoubleForfeit,
  advanceRound
} from './lib/tournamentEngine.mjs';
import { readJson, writeJson } from './lib/repoData.mjs';
import { commitAndPush } from './lib/commitAndPush.mjs';
import { buildPublicData } from './build-public-data.mjs';

function getAction() {
  const flag = process.argv.find((a) => a.startsWith('--action='));
  return flag ? flag.split('=')[1] : process.env.ACTION;
}

function describeMatch(match, byId) {
  const p1 = byId.get(match.player1?.id)?.name ?? match.player1?.id;
  const p2 = byId.get(match.player2?.id)?.name ?? match.player2?.id;
  return `${p1} vs ${p2} (match ${match.id})`;
}

async function startTournament() {
  const tournament = await readJson('tournament.json');
  if (tournament.phase !== 'registration') {
    throw new Error(`No se puede iniciar: fase actual es "${tournament.phase}", no "registration".`);
  }

  const roster = await readJson('players.json');
  const active = roster.players.filter((p) => p.status === 'active');
  if (active.length < tournament.playerCap.min) {
    throw new Error(`Faltan jugadores: ${active.length} registrados, mínimo ${tournament.playerCap.min}.`);
  }

  const engine = createEngineTournament(tournament, roster.players);
  engine.startTournament();

  await writeJson('engine-state.json', saveEngineTournament(engine));

  const now = new Date().toISOString();
  tournament.phase = 'stage-one';
  tournament.currentRound = 1;
  tournament.rounds = [{ number: 1, phase: 'stage-one', startedAt: now, endedAt: null }];
  await writeJson('tournament.json', tournament);

  await buildPublicData();
  commitAndPush(`torneo: inicio, ronda 1 (${active.length} jugadores)`);
  console.log(`Tournament started with ${active.length} players.`);
}

async function nextRound(force) {
  const tournament = await readJson('tournament.json');
  if (tournament.phase !== 'stage-one' && tournament.phase !== 'stage-two') {
    throw new Error(`No hay ronda que avanzar en fase "${tournament.phase}".`);
  }

  const engineJson = await readJson('engine-state.json');
  const engine = loadEngineTournament(engineJson);
  const byId = new Map(engine.players.map((p) => [p.id, p]));

  let unresolved = getUnresolvedMatches(engine).filter((m) => !m.bye && m.player2);

  if (force && unresolved.length > 0) {
    const overridesData = await readJson('overrides.json');
    for (const match of unresolved) {
      const ov = overridesData.overrides.find((o) => o.matchId === match.id && !o.applied);
      if (!ov) continue;
      if (ov.outcome === 'double_forfeit') {
        applyDoubleForfeit(engine, match);
      } else {
        applyResult(engine, match.id, ov.outcome);
      }
      ov.applied = true;
    }
    await writeJson('overrides.json', overridesData);
    unresolved = getUnresolvedMatches(engine).filter((m) => !m.bye && m.player2);
  }

  if (unresolved.length > 0) {
    const list = unresolved.map((m) => describeMatch(m, byId)).join('\n  - ');
    const hint = force
      ? 'Añade una entrada en data/overrides.json para cada partida pendiente y vuelve a intentarlo.'
      : 'Espera a que se resuelvan vía sync-results, o repite con action=force-next-round tras añadir overrides.';
    throw new Error(`Hay ${unresolved.length} partida(s) sin resolver:\n  - ${list}\n${hint}`);
  }

  // Close the current round's window before advancing.
  const currentRoundInfo = tournament.rounds.find((r) => r.number === tournament.currentRound);
  const now = new Date().toISOString();
  if (currentRoundInfo) currentRoundInfo.endedAt = now;

  advanceRound(engine);
  await writeJson('engine-state.json', saveEngineTournament(engine));

  const engineValues = engine.getValues();
  const newPhase = engineValues.status === 'complete' ? 'complete' : engineValues.status === 'stage-two' ? 'stage-two' : 'stage-one';
  tournament.phase = newPhase;
  tournament.currentRound = engineValues.round;
  if (newPhase !== 'complete') {
    tournament.rounds.push({ number: engineValues.round, phase: newPhase, startedAt: now, endedAt: null });
  }
  await writeJson('tournament.json', tournament);

  await buildPublicData();
  commitAndPush(`torneo: avance a ronda ${tournament.currentRound} (${newPhase})`);
  console.log(`Advanced to round ${tournament.currentRound}, phase ${newPhase}.`);
}

async function main() {
  const action = getAction();
  if (action === 'start-tournament') return startTournament();
  if (action === 'next-round') return nextRound(false);
  if (action === 'force-next-round') return nextRound(true);
  throw new Error(`Acción desconocida: "${action}". Usa start-tournament | next-round | force-next-round.`);
}

await main();
