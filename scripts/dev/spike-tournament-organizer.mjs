#!/usr/bin/env node
// Verification spike (Fase 1 del plan). Ejecutado el 2026-09-19 con tournament-organizer 4.1.1;
// sus conclusiones están documentadas en la cabecera de lib/tournamentEngine.mjs
// (transición suizo -> eliminatorias, byes, `bestOf` mutable, sin nextRound() en stage two).
// Vuelve a ejecutarlo (`npm run spike`) si cambias de versión de la librería.
//
// Qué confirma:
//  1. Cómo se dispara la transición swiss -> eliminación en tournament-organizer
//     (¿nextRound() la hace sola tras la última ronda suiza, o hace falta algo más?).
//  2. Cómo maneja la librería un número impar de jugadores (bye).
//  3. Que getValues() -> loadTournament(json) hace un round-trip sin pérdida de datos.
//  4. La forma real de match.path.win/loss para poder pintar el bracket.
//
// Si algo de esto no coincide con lo asumido en lib/tournamentEngine.mjs y
// build-public-data.mjs, ajusta esos ficheros según lo que observes aquí.

import Manager from 'tournament-organizer';
import assert from 'node:assert/strict';

const PLAYER_COUNT = 9; // impar a propósito, para forzar un bye
const SWISS_ROUNDS = 3;

function log(title, value) {
  console.log(`\n--- ${title} ---`);
  console.log(JSON.stringify(value, null, 2));
}

const manager = new Manager();
const tournament = manager.createTournament('Spike', {
  seating: false,
  sorting: 'none',
  scoring: { bestOf: 1, win: 1, draw: 0.5, loss: 0, bye: 1, tiebreaks: [] },
  stageOne: { format: 'swiss', rounds: SWISS_ROUNDS, initialRound: 1, maxPlayers: 0 },
  stageTwo: { format: 'single-elimination', advance: { value: 4, method: 'rank' } }
});

for (let i = 1; i <= PLAYER_COUNT; i++) {
  tournament.createPlayer(`Player ${i}`, `p${i}`);
}

tournament.startTournament();
log('After startTournament()', { status: tournament.status, round: tournament.round });

for (let round = 1; round <= SWISS_ROUNDS; round++) {
  const active = tournament.getActiveMatches();
  console.log(`\nRound ${round}: ${active.length} active matches`);
  for (const match of active) {
    if (match.bye) continue; // byes auto-resolve, nothing to enter
    // Deterministic fake results: lower id always wins, for reproducibility.
    tournament.enterResult(match.id, 1, 0, 0);
  }

  console.log(`Calling nextRound() (currently round ${tournament.round}, status ${tournament.status})...`);
  tournament.nextRound();
  console.log(`-> now round ${tournament.round}, status ${tournament.status}`);
}

log('Status after final swiss nextRound() call', {
  status: tournament.status,
  round: tournament.round,
  activeMatches: tournament.getActiveMatches().length
});

log('Full getValues() dump (inspect players[].matches, matches[].path, stageTwo bracket shape)', tournament.getValues());

// Round-trip check.
const dumped = tournament.getValues();
const reloaded = manager.loadTournament(dumped);
assert.deepEqual(reloaded.getValues(), dumped, 'getValues() -> loadTournament() round-trip should be lossless');
console.log('\nRound-trip getValues()/loadTournament() OK.');

console.log(
  '\nSPIKE DONE. Compare `status` transitions above against the assumptions in lib/tournamentEngine.mjs (advanceRound) and scripts/build-public-data.mjs (buildBracket, which currently assumes bracket match.round > swissRounds).'
);
