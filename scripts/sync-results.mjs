#!/usr/bin/env node
// Run by .github/workflows/sync-results.yml on a schedule (and on-demand via
// workflow_dispatch). Looks up chess.com game results for every pending
// pairing in the active round and applies them to the tournament engine.
// Never guesses: ambiguous or missing games are left pending and recorded in
// data/needs-review.json for the organizer.

import { findGameForPairing } from './lib/resultMatcher.mjs';
import {
  loadEngineTournament,
  saveEngineTournament,
  getUnresolvedMatches,
  getRoundInfo,
  applyResult
} from './lib/tournamentEngine.mjs';
import { readJson, writeJson } from './lib/repoData.mjs';
import { commitAndPush } from './lib/commitAndPush.mjs';
import { buildPublicData } from './build-public-data.mjs';

async function main() {
  const tournament = await readJson('tournament.json');
  if (tournament.phase !== 'stage-one' && tournament.phase !== 'stage-two') {
    console.log(`Nothing to sync in phase "${tournament.phase}".`);
    return;
  }

  const engineJson = await readJson('engine-state.json');
  if (!engineJson) {
    console.log('No engine-state.json yet — tournament not started.');
    return;
  }

  const roundInfo = tournament.rounds.find((r) => r.number === tournament.currentRound);
  if (!roundInfo) {
    console.log(`No round window recorded for round ${tournament.currentRound}.`);
    return;
  }

  const engine = loadEngineTournament(engineJson);

  // findGameForPairing resolves a pairing from ONE chess.com game. In a Bo3/Bo5
  // that would record a single game as a whole series, so refuse until the
  // matcher aggregates the games of a series (scoreSeries in lib/series.mjs).
  const { bestOf, label } = getRoundInfo(engine, tournament.currentRound);
  if (bestOf > 1) {
    console.log(`${label} es al mejor de ${bestOf}: el matcher aún no agrega series, no se resuelve nada automáticamente.`);
    return;
  }

  const byId = new Map(engine.getPlayers().map((p) => [p.id, p]));
  const pending = getUnresolvedMatches(engine, tournament.currentRound);

  const needsReview = { items: [] };
  let anyResolved = false;

  for (const match of pending) {
    const p1 = byId.get(match.player1.id);
    const p2 = byId.get(match.player2.id);
    const usernameA = p1?.meta?.chesscomUsername;
    const usernameB = p2?.meta?.chesscomUsername;
    if (!usernameA || !usernameB) continue;

    const result = await findGameForPairing({
      usernameA,
      usernameB,
      timeClass: tournament.timeClass,
      rules: tournament.rules,
      requireRated: tournament.requireRated,
      windowStart: roundInfo.startedAt,
      windowEnd: roundInfo.endedAt
    });

    if (result.status === 'resolved' && result.outcome === 'draw') {
      // A drawn game decides nothing: another one has to be played.
      console.log(`${usernameA} vs ${usernameB}: tablas, falta otra partida.`);
    } else if (result.status === 'resolved') {
      applyResult(engine, match.id, result.outcome);
      match.meta = { ...match.meta, chesscom: { url: result.game.url, endTime: result.game.endTime } };
      anyResolved = true;
      console.log(`Resolved ${usernameA} vs ${usernameB}: ${result.outcome}`);
    } else if (result.status === 'ambiguous') {
      needsReview.items.push({
        matchId: match.id,
        round: tournament.currentRound,
        player1: usernameA,
        player2: usernameB,
        reason: 'multiple_candidate_games',
        candidates: result.candidates,
        detectedAt: new Date().toISOString()
      });
    } else if (result.status === 'inconsistent') {
      needsReview.items.push({
        matchId: match.id,
        round: tournament.currentRound,
        player1: usernameA,
        player2: usernameB,
        reason: 'inconsistent_result_codes',
        game: { url: result.game.url, endTime: result.game.endTime },
        detectedAt: new Date().toISOString()
      });
    }
    // 'not_found' -> stays pending silently, expected while the round is in progress.
  }

  await writeJson('needs-review.json', needsReview);

  if (anyResolved) {
    await writeJson('engine-state.json', saveEngineTournament(engine));
  }

  await buildPublicData();
  const committed = commitAndPush(`sync: resultados chess.com (ronda ${tournament.currentRound})`);
  console.log(committed ? 'Changes committed.' : 'No changes to commit.');
}

await main();
