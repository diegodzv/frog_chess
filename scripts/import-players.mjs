#!/usr/bin/env node
// Imports the Microsoft Forms registrations into data/players.json (or $FROG_DATA_DIR).
//
//   node import-players.mjs <export.csv>            # adds the new players, unverified
//   node import-players.mjs <export.csv> --check    # also checks them against chess.com (needs a network without the office firewall)
//   node import-players.mjs <export.csv> --dry-run  # shows what would happen, writes nothing
//
// The CSV is the Forms "Open in Excel" file saved as "CSV UTF-8". It contains e-mails: never commit it.
// This script doesn't commit either: review `git diff data/` and push; then run the check-players action
// (GitHub's runners can reach chess.com) if you didn't use --check.

import { readFile } from 'node:fs/promises';
import { parseCsv, extractRegistrations, mergeRegistrations, verifyRoster } from './lib/roster.mjs';
import { getPlayerProfile } from './lib/chesscomClient.mjs';
import { readJson, writeJson, getDataDir } from './lib/repoData.mjs';
import { buildPublicData } from './build-public-data.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const check = args.includes('--check');
const dryRun = args.includes('--dry-run');

if (!file) {
  console.error('Uso: node import-players.mjs <export.csv> [--check] [--dry-run]');
  process.exit(1);
}

const tournament = await readJson('tournament.json');
if (tournament.phase !== 'registration') {
  console.error(`La inscripción está cerrada (fase actual: ${tournament.phase}); no se importa nada.`);
  process.exit(1);
}

const registrations = extractRegistrations(parseCsv(await readFile(file, 'utf8')));
let { roster, added, unchanged, skipped } = mergeRegistrations(await readJson('players.json'), registrations, {
  maxPlayers: tournament.playerCap.max
});

let invalid = [];
if (check) {
  try {
    ({ roster, invalid } = await verifyRoster(roster, getPlayerProfile));
  } catch (err) {
    console.error(`No se pudo consultar chess.com (${err.message}). Repite sin --check y usa la acción check-players en GitHub.`);
    process.exit(1);
  }
}

console.log(`${registrations.length} respuesta(s) en el fichero.`);
console.log(`Nuevos: ${added.length}${added.length ? ` — ${added.map((p) => `${p.name} (${p.chesscomUsername})`).join(', ')}` : ''}`);
console.log(`Ya inscritos: ${unchanged.length}`);
for (const s of skipped) console.log(`Descartada (línea ${s.line}, ${s.name || '¿sin nombre?'} / ${s.username || '¿sin usuario?'}): ${s.reason}`);
for (const p of invalid) console.log(`Sin validar: ${p.name} (${p.chesscomUsername}): ${p.reason}. Corrígelo en players.json o pídele el usuario correcto.`);
const pending = roster.players.filter((p) => p.status === 'active' && p.chesscomVerified === false).length;
console.log(`Total inscritos: ${roster.players.filter((p) => p.status === 'active').length} · sin comprobar en chess.com: ${pending}`);

if (dryRun) {
  console.log('--dry-run: no se ha escrito nada.');
} else {
  await writeJson('players.json', roster);
  await buildPublicData();
  console.log(`Escrito en ${getDataDir()}. Revisa \`git diff\` y haz commit + push.`);
}
