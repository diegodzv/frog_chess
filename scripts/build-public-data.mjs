#!/usr/bin/env node
// Pure derivation: data/tournament.json + data/players.json + data/engine-state.json
// -> data/public/*.json. Safe to run standalone (e.g. for local frontend dev)
// since it never talks to chess.com or mutates tournament state.

import { readJson, writePublicJson } from './lib/repoData.mjs';

function playerLookup(engineState) {
  const byId = new Map();
  for (const p of engineState?.players ?? []) byId.set(p.id, p);
  return byId;
}

function matchRecord(player) {
  let win = 0;
  let loss = 0;
  let draw = 0;
  for (const m of player.matches ?? []) {
    win += m.win ?? 0;
    loss += m.loss ?? 0;
    draw += m.draw ?? 0;
  }
  return { win, loss, draw };
}

function buildStandings(tournament, engineState) {
  const rows = (engineState?.players ?? [])
    .filter((p) => p.active)
    .map((p) => {
      const { win, loss, draw } = matchRecord(p);
      return {
        name: p.name,
        chesscomUsername: p.meta?.chesscomUsername ?? null,
        matchPoints: p.value ?? 0,
        record: `${win}-${loss}-${draw}`
      };
    })
    .sort((a, b) => b.matchPoints - a.matchPoints)
    .map((row, i) => ({ rank: i + 1, ...row }));

  return {
    updatedAt: new Date().toISOString(),
    phase: tournament.phase,
    round: tournament.currentRound,
    rows
  };
}

function buildCurrentRound(tournament, engineState) {
  const byId = playerLookup(engineState);
  const currentRoundInfo = tournament.rounds.find((r) => r.number === tournament.currentRound);
  const matches = (engineState?.matches ?? []).filter((m) => m.round === engineState?.round);

  const pairings = matches.map((m) => {
    const p1 = byId.get(m.player1?.id);
    const p2 = m.bye ? null : byId.get(m.player2?.id);
    return {
      matchId: m.id,
      player1: p1 ? { name: p1.name, chesscomUsername: p1.meta?.chesscomUsername ?? null } : null,
      player2: p2 ? { name: p2.name, chesscomUsername: p2.meta?.chesscomUsername ?? null } : null,
      bye: Boolean(m.bye),
      status: m.active ? 'pending' : 'complete',
      result: m.active
        ? null
        : {
            player1: { win: m.player1?.win ?? 0, loss: m.player1?.loss ?? 0, draw: m.player1?.draw ?? 0 },
            player2: { win: m.player2?.win ?? 0, loss: m.player2?.loss ?? 0, draw: m.player2?.draw ?? 0 }
          },
      gameUrl: m.meta?.chesscom?.url ?? null
    };
  });

  return {
    updatedAt: new Date().toISOString(),
    phase: tournament.phase,
    round: tournament.currentRound,
    windowStart: currentRoundInfo?.startedAt ?? null,
    windowEnd: currentRoundInfo?.endedAt ?? null,
    pairings
  };
}

function buildBracket(tournament, engineState) {
  const byId = playerLookup(engineState);
  const rounds = [];

  if (tournament.phase === 'stage-two' || tournament.phase === 'complete') {
    const bracketMatches = (engineState?.matches ?? []).filter((m) => m.round > tournament.swissRounds);
    const byRound = new Map();
    for (const m of bracketMatches) {
      if (!byRound.has(m.round)) byRound.set(m.round, []);
      byRound.get(m.round).push(m);
    }
    for (const [round, matches] of [...byRound.entries()].sort((a, b) => a[0] - b[0])) {
      rounds.push({
        round: round - tournament.swissRounds,
        matches: matches.map((m) => {
          const p1 = byId.get(m.player1?.id);
          const p2 = m.bye ? null : byId.get(m.player2?.id);
          const winnerId = m.active ? null : (m.player1?.win ?? 0) > (m.player2?.win ?? 0) ? m.player1?.id : m.player2?.id;
          return {
            matchId: m.id,
            player1: p1 ? { name: p1.name } : null,
            player2: p2 ? { name: p2.name } : null,
            winner: winnerId ? byId.get(winnerId)?.name ?? null : null,
            gameUrl: m.meta?.chesscom?.url ?? null
          };
        })
      });
    }
  }

  return { updatedAt: new Date().toISOString(), phase: tournament.phase, rounds };
}

function buildPlayers(roster) {
  return {
    updatedAt: new Date().toISOString(),
    players: roster.players.map((p) => ({
      name: p.name,
      chesscomUsername: p.chesscomUsername,
      status: p.status
    }))
  };
}

function buildMeta(tournament, roster) {
  return {
    name: tournament.name,
    phase: tournament.phase,
    currentRound: tournament.currentRound,
    swissRounds: tournament.swissRounds,
    playerCount: roster.players.filter((p) => p.status === 'active').length,
    playerCap: tournament.playerCap,
    updatedAt: new Date().toISOString()
  };
}

export async function buildPublicData() {
  const tournament = await readJson('tournament.json');
  const roster = await readJson('players.json');
  const engineState = await readJson('engine-state.json');

  await writePublicJson('meta.json', buildMeta(tournament, roster));
  await writePublicJson('standings.json', buildStandings(tournament, engineState));
  await writePublicJson('current-round.json', buildCurrentRound(tournament, engineState));
  await writePublicJson('bracket.json', buildBracket(tournament, engineState));
  await writePublicJson('players.json', buildPlayers(roster));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildPublicData();
}
