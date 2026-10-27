export const PHASE_LABELS = {
  registration: 'Inscripción abierta',
  'stage-one': 'Fase suiza',
  'stage-two': 'Fase eliminatoria',
  complete: 'Torneo finalizado'
};

const GAME_GLYPH = { p1: 'V', p2: 'D', draw: '½' };

/** Game-by-game sequence from player1's point of view, e.g. "V ½ D". */
export function gameSequence(games) {
  return games ? games.map((g) => GAME_GLYPH[g] ?? '?').join(' ') : null;
}

export function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : null;
}

export function playerLink(player) {
  return player?.chesscomUsername ? `https://www.chess.com/member/${player.chesscomUsername}` : null;
}

/** "una sola partida" for Bo1, "al mejor de N" otherwise. */
export function bestOfText(bestOf) {
  return bestOf === 1 ? 'una sola partida' : `al mejor de ${bestOf}`;
}

/** 754 -> "12 min 34 s". */
export function formatDuration(seconds) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}
