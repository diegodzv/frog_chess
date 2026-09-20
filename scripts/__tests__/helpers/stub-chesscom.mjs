// Preloaded with `node --import` by registerPlayer.test.mjs: answers api.chess.com/pub/player/<name> locally.
const PROFILES = {
  adalovelace: { username: 'AdaLovelace', player_id: 101 },
  bob: { username: 'bob', player_id: 102 },
  carl: { username: 'Carl', player_id: 103 }
};

globalThis.fetch = async (url) => {
  const name = decodeURIComponent(String(url).split('/player/')[1] ?? '');
  if (name === 'boom') return new Response('forbidden', { status: 403 });
  const profile = PROFILES[name];
  if (!profile) return new Response('{}', { status: 404 });
  return new Response(JSON.stringify(profile), { status: 200, headers: { 'content-type': 'application/json' } });
};
