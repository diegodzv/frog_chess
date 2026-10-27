#!/usr/bin/env node
// Run by .github/workflows/sync-results.yml on a schedule (and on-demand via
// workflow_dispatch). Looks up the chess.com games of every pending pairing in
// the active round, scores them as a best-of-N series and applies the finished
// ones to the tournament engine. Never guesses: inconsistent games or games
// played with the wrong settings go to data/needs-review.json for the organizer;
// unfinished series (e.g. a drawn Bo1 waiting for a replay or a coin toss) stay
// pending, with the games so far shown on the site.

import { findSeriesForPairing } from './lib/resultMatcher.mjs';
import {
  loadEngineTournament,
  saveEngineTournament,
  getUnresolvedMatches,
  getRoundInfo,
  applySeriesResult
} from './lib/tournamentEngine.mjs';
import { readJson, writeJson } from './lib/repoData.mjs';
import { commitAndPush } from './lib/commitAndPush.mjs';
import { buildPublicData } from './build-public-data.mjs';

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

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
  const { bestOf } = getRoundInfo(engine, tournament.currentRound);
  const byId = new Map(engine.getPlayers().map((p) => [p.id, p]));
  const pending = getUnresolvedMatches(engine, tournament.currentRound);

  const needsReview = { items: [] };
  let engineChanged = false;

  for (const match of pending) {
    if (match.bye) continue;
    const usernameA = byId.get(match.player1.id)?.meta?.chesscomUsername;
    const usernameB = byId.get(match.player2.id)?.meta?.chesscomUsername;
    if (!usernameA || !usernameB) continue;

    const result = await findSeriesForPairing({
      usernameA,
      usernameB,
      bestOf,
      timeClass: tournament.timeClass,
      rules: tournament.rules,
      requireRated: tournament.requireRated,
      windowStart: roundInfo.startedAt,
      windowEnd: roundInfo.endedAt
    });
    const review = { matchId: match.id, round: tournament.currentRound, player1: usernameA, player2: usernameB, detectedAt: new Date().toISOString() };

    if (result.status === 'complete') {
      const sequence = result.games.map((g) => g.result);
      applySeriesResult(engine, match.id, result.score, {
        games: sequence,
        meta: { source: 'chesscom', chesscomGames: result.games }
      });
      engineChanged = true;
      console.log(`Resuelto ${usernameA} vs ${usernameB}: ${result.score.p1Wins}-${result.score.p2Wins} (${sequence.join(' ')})`);
      if (result.ignored > 0) console.log(`  ${result.ignored} partida(s) posteriores a la decisión, ignoradas.`);
    } else if (result.status === 'in_progress') {
      // Shown on the site as the games so far; a drawn Bo1 needs a replay or a coin toss (override).
      const sequence = result.games.map((g) => g.result);
      if (!sameJson(match.meta?.games, sequence)) {
        match.set({ meta: { games: sequence } });
        engineChanged = true;
      }
      console.log(`${usernameA} vs ${usernameB}: en curso (${sequence.join(' ')}).`);
    } else if (result.status === 'inconsistent') {
      needsReview.items.push({ ...review, reason: 'inconsistent_result_codes', game: { url: result.game.url, endTime: result.game.endTime } });
    } else if (result.wrongFormat.length > 0) {
      needsReview.items.push({ ...review, reason: 'wrong_format', games: result.wrongFormat });
    }
    // 'not_found' with nothing else -> stays pending silently, expected while the round is in progress.
  }

  await writeJson('needs-review.json', needsReview);
  if (engineChanged) await writeJson('engine-state.json', saveEngineTournament(engine));

  await buildPublicData();
  const committed = commitAndPush(`sync: resultados chess.com (ronda ${tournament.currentRound})`);
  console.log(committed ? 'Changes committed.' : 'No changes to commit.');
}

await main();
