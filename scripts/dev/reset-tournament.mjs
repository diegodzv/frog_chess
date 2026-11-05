#!/usr/bin/env node
// Puts the tournament back into the registration phase. Meant for the switch from a rehearsal
// (test players, test rounds) to the real tournament. It only rewrites files under data/ (or
// $FROG_DATA_DIR): review the changes with `git diff` and commit them yourself.
//
//   node dev/reset-tournament.mjs --yes                 # empties the roster too
//   node dev/reset-tournament.mjs --yes --keep-players  # keeps the registered players, re-opens registration
//
// Not a workflow on purpose: it must never be one click away while the real tournament is running.

import { readJson, writeJson, getDataDir } from '../lib/repoData.mjs';
import { buildPublicData } from '../build-public-data.mjs';

const args = new Set(process.argv.slice(2));
const keepPlayers = args.has('--keep-players');

if (!args.has('--yes')) {
  console.error(
    `Esto borra el estado del torneo en ${getDataDir()} (fase, rondas, resultados, overrides${keepPlayers ? '' : ' Y jugadores'}).\n` +
      'Repite con --yes para confirmar (y --keep-players para conservar la lista de jugadores).'
  );
  process.exit(1);
}

const tournament = await readJson('tournament.json');
const configured = tournament.configured ?? {};

// Drop everything the start of the tournament derived; restore what was configured ("auto" or explicit numbers).
const { configured: _configured, playerCount: _playerCount, ...rest } = tournament;
const restored = {
  ...rest,
  swissRounds: configured.swissRounds ?? 'auto',
  playoffCutoff: configured.playoffCutoff ?? { method: 'rank', value: 'auto' },
  phase: 'registration',
  currentRound: 0,
  rounds: []
};

await writeJson('tournament.json', restored);
await writeJson('engine-state.json', 'null\n');
await writeJson('overrides.json', { overrides: [] });
await writeJson('needs-review.json', { items: [] });

if (!keepPlayers) await writeJson('players.json', { players: [] });

await buildPublicData();
console.log(`Torneo reiniciado en ${getDataDir()}: fase "registration", ${keepPlayers ? 'jugadores conservados' : 'sin jugadores'}.`);
