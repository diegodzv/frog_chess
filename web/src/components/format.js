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
