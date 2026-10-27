// Preloaded with `node --import` by syncResults.test.mjs: answers the monthly game archives of
// api.chess.com/pub from the JSON file named by $FROG_STUB_GAMES ({ "<username>": [games...] }).
import { readFileSync } from 'node:fs';

const gamesByUser = JSON.parse(readFileSync(process.env.FROG_STUB_GAMES, 'utf8'));

globalThis.fetch = async (url) => {
  const m = /\/player\/([^/]+)\/games\/\d{4}\/\d{2}$/.exec(String(url));
  if (!m) return new Response('{}', { status: 404 });
  const games = gamesByUser[decodeURIComponent(m[1]).toLowerCase()] ?? [];
  return new Response(JSON.stringify({ games }), { status: 200, headers: { 'content-type': 'application/json' } });
};
