export const PHASE_LABELS = {
  registration: 'Inscripción abierta',
  'stage-one': 'Fase suiza',
  'stage-two': 'Fase final',
  complete: 'Torneo finalizado'
};

export function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }) : null;
}

/** Last day of a round: rounds open on a Monday and are played until that week's Sunday. */
export function roundEndDate(startIso) {
  return startIso ? new Date(new Date(startIso).getTime() + 6 * 86_400_000).toISOString() : null;
}

export function playerLink(player) {
  return player?.chesscomUsername ? `https://www.chess.com/member/${player.chesscomUsername}` : null;
}

/** 754 -> "12 min 34 s". */
export function formatDuration(seconds) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}
