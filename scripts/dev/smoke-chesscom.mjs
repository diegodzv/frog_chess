#!/usr/bin/env node
// Manual local smoke test against the real chess.com API.
// Usage: node dev/smoke-chesscom.mjs <username> [year] [month]
//
// NOTE: won't work from a network that blocks chess.com (e.g. a corporate
// firewall that categorizes it as "gaming") — run from home/mobile network.

import { getPlayerProfile, getPlayerGamesForMonth } from '../lib/chesscomClient.mjs';

const [username, year, month] = process.argv.slice(2);
if (!username) {
  console.error('Usage: node dev/smoke-chesscom.mjs <username> [year] [month]');
  process.exit(1);
}

const now = new Date();
const y = Number(year) || now.getUTCFullYear();
const m = Number(month) || now.getUTCMonth() + 1;

const profile = await getPlayerProfile(username);
console.log('Profile:', profile);

const games = await getPlayerGamesForMonth(username, y, m);
console.log(`Games in ${y}-${String(m).padStart(2, '0')}:`, games.length);
console.log(games.slice(0, 3));
