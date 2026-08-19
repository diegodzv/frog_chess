// Thin client for the Chess.com Published Data API (https://api.chess.com/pub).
// Runs only in Node (GitHub Actions runners / local dev), never in the browser:
// the API has no CORS headers, so browser fetches to api.chess.com are blocked.

const BASE_URL = 'https://api.chess.com/pub';
const USER_AGENT = 'frog-chess-tournament-bot (contact: github.com/<owner>/frog_chess)';
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1000;

const cache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(path) {
  if (cache.has(path)) return cache.get(path);

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
    });

    if (res.ok) {
      const json = await res.json();
      cache.set(path, json);
      return json;
    }

    if (res.status === 404) {
      // Not-found is meaningful (e.g. no games that month) — never retried.
      cache.set(path, null);
      return null;
    }

    lastError = new Error(`chess.com API ${res.status} for ${path}`);
    if (res.status === 429 || res.status >= 500) {
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      continue;
    }
    throw lastError;
  }
  throw lastError;
}

/** Fetches a player's public profile. Returns null if the username doesn't exist. */
export async function getPlayerProfile(username) {
  return fetchJson(`/player/${encodeURIComponent(username.toLowerCase())}`);
}

/** Fetches one month of a player's finished games, trimmed to the fields we care about. */
export async function getPlayerGamesForMonth(username, year, month) {
  const mm = String(month).padStart(2, '0');
  const data = await fetchJson(
    `/player/${encodeURIComponent(username.toLowerCase())}/games/${year}/${mm}`
  );
  if (!data || !Array.isArray(data.games)) return [];

  return data.games.map((game) => ({
    url: game.url,
    endTime: new Date(game.end_time * 1000).toISOString(),
    timeClass: game.time_class,
    rules: game.rules,
    rated: game.rated,
    white: { username: game.white.username, result: game.white.result },
    black: { username: game.black.username, result: game.black.result }
  }));
}

/** Returns the distinct {year, month} pairs touched by [start, end], inclusive. `end` defaults to now. */
export function monthsBetween(start, end = new Date()) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const months = [];
  let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  const last = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));

  while (cursor <= last) {
    months.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return months;
}

/** Clears the in-run memoization cache. Only useful in tests. */
export function _resetCache() {
  cache.clear();
}
