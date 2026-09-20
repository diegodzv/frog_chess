#!/usr/bin/env node
// Simulates whole tournaments (fake players, simulated chess.com games) through
// the real lifecycle code and writes each one as a dataset the frontend can
// display. Never touches data/: output goes to sim/n<players>/ (gitignored).
//
//   node dev/simulate-tournament.mjs                       # 20, 40 and 60 players
//   node dev/simulate-tournament.mjs --players=32 --seed=7
//   node dev/simulate-tournament.mjs --runs=500            # more Monte-Carlo samples for the stats
//   node dev/simulate-tournament.mjs --swiss-rounds=7 --cutoff=16 --out=/tmp/sim7   # try another format
//
// Then view them with: cd web && npm run dev   (and open /?data=sim/n40)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT } from '../lib/repoData.mjs';
import { saveEngineTournament } from '../lib/tournamentEngine.mjs';
import { simulateTournament, verifyTournament } from '../lib/simulation.mjs';
import { derivePublicData } from '../build-public-data.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);
const sizes = (args.players ?? '20,40,60').split(',').map(Number);
const seed = Number(args.seed ?? 1);
const runs = Number(args.runs ?? 200);
const noShowRate = Number(args['no-show'] ?? 0.02);
const snapshotSize = Number(args.snapshots ?? 40);
const outRoot = path.resolve(args.out ?? path.join(REPO_ROOT, 'sim'));

const config = JSON.parse(await readFile(path.join(REPO_ROOT, 'data', 'tournament.json'), 'utf8'));
if (args['swiss-rounds']) config.swissRounds = Number(args['swiss-rounds']);
if (args.cutoff) config.playoffCutoff = { method: 'rank', value: Number(args.cutoff) };
config.phase = 'registration';
config.currentRound = 0;
config.rounds = [];

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x) => `${(x * 100).toFixed(0)}%`;

async function writeDataset(key, run, report) {
  const dir = path.join(outRoot, key);
  await mkdir(path.join(dir, 'public'), { recursive: true });
  const engineJson = saveEngineTournament(run.engine);
  const files = {
    'players.json': json(run.roster),
    'tournament.json': json(run.tournament),
    'engine-state.json': engineJson,
    'overrides.json': json(run.overrides),
    'needs-review.json': json({ items: [] }),
    'hidden-ratings.json': json(run.ratings),
    'report.json': json(report)
  };
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, name), content, 'utf8');

  const publicFiles = derivePublicData({
    tournament: run.tournament,
    roster: run.roster,
    engineState: JSON.parse(engineJson),
    now: '2026-10-05T09:00:00.000Z'
  });
  for (const [name, content] of Object.entries(publicFiles)) {
    await writeFile(path.join(dir, 'public', name), json(content), 'utf8');
  }
}

const index = [];
const summary = [];

for (const n of sizes) {
  const main = simulateTournament({ config, playerCount: n, seed, noShowRate });
  const { issues, metrics } = verifyTournament({ ...main, config });
  if (issues.length) {
    console.error(`\n✖ n=${n} seed=${seed}: ${issues.length} incidencia(s)`);
    for (const issue of issues.slice(0, 10)) console.error(`   - ${issue}`);
    process.exitCode = 1;
  }

  // Monte-Carlo over many seeds: how good is the format, not just this one draw.
  const samples = [];
  let invalid = 0;
  for (let s = 1; s <= runs; s++) {
    const run = simulateTournament({ config, playerCount: n, seed: 1000 + s, noShowRate });
    const result = verifyTournament({ ...run, config });
    if (result.issues.length) invalid++;
    samples.push(result.metrics);
  }
  const stats = {
    runs,
    invalidRuns: invalid,
    bestPlayerWins: samples.filter((m) => m.champion.ratingRank === 1).length / runs,
    championInTop3: samples.filter((m) => m.champion.ratingRank <= 3).length / runs,
    championMeanRatingRank: mean(samples.map((m) => m.champion.ratingRank)),
    topEloQualifiedMean: mean(samples.map((m) => m.topEloQualified)),
    spearmanMean: mean(samples.map((m) => m.ratingVsSwissRankSpearman)),
    undefeatedMean: mean(samples.map((m) => m.undefeatedAfterSwiss)),
    tiedAtCutoffShare: samples.filter((m) => m.tiedAtCutoffOnPoints).length / runs,
    playersOnCutoffLineMean: mean(samples.map((m) => m.playersTiedWithCutoffLine)),
    totalGamesMean: mean(samples.map((m) => m.totalGames))
  };

  await writeDataset(`n${n}`, main, { seed, noShowRate, metrics, monteCarlo: stats });
  index.push({ key: `n${n}`, label: `${n} jugadores`, players: n, seed });
  summary.push({ n, metrics, stats });

  // Mid-tournament snapshots: the states the site spends most of its life in.
  if (n === snapshotSize) {
    const swissRounds = main.tournament.swissRounds;
    const snapshots = [
      { key: `n${n}-swiss`, label: `${n} jugadores · a mitad de ronda suiza`, stopAt: { round: 4, resolvedShare: 0.6 } },
      { key: `n${n}-bracket`, label: `${n} jugadores · a mitad de cuartos`, stopAt: { round: swissRounds + 2, resolvedShare: 0.5 } }
    ];
    for (const snap of snapshots) {
      const partial = simulateTournament({ config, playerCount: n, seed, noShowRate: 0, stopAt: snap.stopAt });
      await writeDataset(snap.key, partial, { seed, snapshot: snap.stopAt });
      index.push({ key: snap.key, label: snap.label, players: n, seed });
    }
  }
}

await mkdir(outRoot, { recursive: true });
await writeFile(path.join(outRoot, 'index.json'), json({ datasets: index }), 'utf8');

console.log(`\nDatasets escritos en ${outRoot}\n`);
for (const { n, metrics: m, stats: s } of summary) {
  console.log(`━━ ${n} jugadores ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Formato: ${m.swissRounds} rondas suizas (Bo3) → top ${m.playoffCutoff} → ${m.totalRounds - m.swissRounds} rondas eliminatorias → ${m.totalRounds} rondas en total`);
  console.log(`  Partidas de ajedrez: ~${Math.round(s.totalGamesMean)} en total; máx. ${m.maxGamesPerPlayerInARound} por jugador en una ronda`);
  console.log(`  (${s.runs} simulaciones, ${s.invalidRuns} con incidencias)`);
  console.log(`  ¿Gana el mejor jugador (Elo oculto)?  ${pct(s.bestPlayerWins)}   · campeón entre los 3 mejores: ${pct(s.championInTop3)}   · puesto Elo medio del campeón: ${s.championMeanRatingRank.toFixed(1)}`);
  console.log(`  Correlación Elo↔clasificación suiza (Spearman): ${s.spearmanMean.toFixed(2)}   · de los ${m.playoffCutoff} mejores por Elo, clasifican de media ${s.topEloQualifiedMean.toFixed(1)}`);
  console.log(`  Invictos tras el suizo: ${s.undefeatedMean.toFixed(1)} de media   · el corte se decide por desempate en el ${pct(s.tiedAtCutoffShare)} de los casos (${s.playersOnCutoffLineMean.toFixed(1)} jugadores empatados a los puntos del corte)`);
}
console.log('');
