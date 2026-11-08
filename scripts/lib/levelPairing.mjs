// Round-1 pairing by self-reported level (registration form: "how good are you at chess?"), so that the
// first round matches people of similar strength. Later rounds are paired by the library from the results.
//
// Players are shuffled inside each level, ordered from the strongest level down and paired in that order:
// everybody plays someone of their own level, except the odd one out of a level, who plays the first
// player of the next level down. With an odd number of players, a random player gets the bye.

/** Form answers -> level (higher = stronger). Matched on the start of the text, ignoring case and accents. */
const LEVELS = [
  ['juego mucho', 4],
  ['juego de vez en cuando', 3],
  ['hace tiempo que no juego', 2],
  ['se como se mueven las piezas', 1]
];

const plain = (text) =>
  String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

/** Level (1-4) of a form answer, or null if it isn't one of the four options. */
export function levelFromAnswer(answer) {
  const text = plain(answer);
  return LEVELS.find(([start]) => text.startsWith(start))?.[1] ?? null;
}

function shuffled(items, rng) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * @param players [{ id, level }] (level null/undefined = lowest)
 * @returns {{ pairs: [string, string][], bye: string | null }}
 */
export function pairByLevel(players, rng = Math.random) {
  let pool = [...players];
  let bye = null;
  if (pool.length % 2 === 1) {
    bye = pool[Math.floor(rng() * pool.length)].id;
    pool = pool.filter((p) => p.id !== bye);
  }
  const levels = [...new Set(pool.map((p) => p.level ?? 0))].sort((a, b) => b - a);
  const ordered = levels.flatMap((level) => shuffled(pool.filter((p) => (p.level ?? 0) === level), rng));
  const pairs = [];
  for (let i = 0; i < ordered.length; i += 2) pairs.push([ordered[i].id, ordered[i + 1].id]);
  return { pairs, bye };
}
