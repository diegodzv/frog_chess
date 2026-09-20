#!/usr/bin/env node
// Run by .github/workflows/register-player.yml when a "registration" issue is
// opened or edited. Validates the submission and, on success, appends the
// player to data/players.json and commits. Reports the outcome via
// $GITHUB_OUTPUT so the workflow can comment on / close the issue.

import { appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getPlayerProfile } from './lib/chesscomClient.mjs';
import { parseIssueForm } from './lib/issueForm.mjs';
import { readJson, writeJson } from './lib/repoData.mjs';
import { commitAndPush } from './lib/commitAndPush.mjs';
import { buildPublicData } from './build-public-data.mjs';

const NAME_FIELD = 'Nombre completo';
const USERNAME_FIELD = 'Usuario de chess.com';
const MAX_NAME_LENGTH = 60;

function slugify(name, username) {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const suffix = createHash('sha1').update(username.toLowerCase()).digest('hex').slice(0, 6);
  return `p_${base || 'player'}-${suffix}`;
}

async function setOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  const safe = value.replace(/\r?\n/g, ' ');
  await appendFile(process.env.GITHUB_OUTPUT, `${key}=${safe}\n`);
}

async function fail(reason) {
  await setOutput('result', 'rejected');
  await setOutput('reason', reason);
  console.log(`Rejected: ${reason}`);
}

async function main() {
  const body = process.env.ISSUE_BODY ?? '';
  const fields = parseIssueForm(body);
  const name = (fields[NAME_FIELD] ?? '').trim();
  const chesscomUsername = (fields[USERNAME_FIELD] ?? '').trim().replace(/^@/, '');

  if (!name) return fail('Falta el nombre completo.');
  if (!chesscomUsername) return fail('Falta el usuario de chess.com.');
  if (name.length > MAX_NAME_LENGTH) return fail(`El nombre es demasiado largo (máximo ${MAX_NAME_LENGTH} caracteres).`);

  const roster = await readJson('players.json');

  // The workflow also runs when an issue is edited. An issue that is already registered must not be
  // re-processed (it would be rejected as a "duplicate" of itself), nor register a second player.
  const issueNumber = Number(process.env.ISSUE_NUMBER) || null;
  const registeredFromThisIssue = issueNumber
    ? roster.players.find((p) => p.issueNumber === issueNumber && p.status === 'active')
    : null;
  if (registeredFromThisIssue) {
    if (registeredFromThisIssue.chesscomUsername.toLowerCase() === chesscomUsername.toLowerCase()) {
      await setOutput('result', 'unchanged');
      console.log(`Issue #${issueNumber} ya estaba registrado (${registeredFromThisIssue.chesscomUsername}); sin cambios.`);
      return;
    }
    return fail(
      `Este issue ya está registrado con el usuario "${registeredFromThisIssue.chesscomUsername}". Para cambiarlo, habla con el organizador.`
    );
  }

  const tournament = await readJson('tournament.json');
  if (tournament.phase !== 'registration') {
    return fail(`El registro está cerrado (fase actual: ${tournament.phase}).`);
  }

  const activePlayers = roster.players.filter((p) => p.status === 'active');
  if (activePlayers.length >= tournament.playerCap.max) {
    return fail(`Se ha alcanzado el aforo máximo (${tournament.playerCap.max} jugadores).`);
  }

  const duplicate = roster.players.find(
    (p) => p.chesscomUsername.toLowerCase() === chesscomUsername.toLowerCase() && p.status === 'active'
  );
  if (duplicate) return fail(`El usuario de chess.com "${chesscomUsername}" ya está registrado.`);

  let profile;
  try {
    profile = await getPlayerProfile(chesscomUsername);
  } catch (err) {
    // chess.com down, rate-limited or blocking the runner: tell the player instead of failing silently.
    console.error(err);
    return fail('No se pudo consultar chess.com en este momento. Edita este issue (o guarda de nuevo) para reintentarlo más tarde.');
  }
  if (!profile) return fail(`No existe ningún usuario de chess.com llamado "${chesscomUsername}".`);

  // Same check again on chess.com's canonical name (covers any difference between what was typed and the account).
  if (roster.players.some((p) => p.status === 'active' && p.chesscomUsername.toLowerCase() === profile.username.toLowerCase())) {
    return fail(`El usuario de chess.com "${profile.username}" ya está registrado.`);
  }

  const player = {
    id: slugify(name, chesscomUsername),
    name,
    chesscomUsername: profile.username, // canonical casing from chess.com
    chesscomPlayerId: profile.player_id,
    status: 'active',
    registeredAt: new Date().toISOString(),
    issueNumber
  };

  roster.players.push(player);
  await writeJson('players.json', roster);
  await buildPublicData();
  commitAndPush(`registro: añadir a ${player.name} (${player.chesscomUsername})`);

  await setOutput('result', 'accepted');
  await setOutput('player_name', player.name);
  await setOutput('player_username', player.chesscomUsername);
  console.log(`Accepted: ${player.name} (${player.chesscomUsername})`);
}

await main();
