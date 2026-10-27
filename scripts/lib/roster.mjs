// Registration from a Microsoft Forms export (Excel saved as CSV) into
// data/players.json. Pure functions except verifyRoster, which takes the
// chess.com lookup as a parameter.
//
// The export carries the respondent's work e-mail. It is only used to keep the
// latest answer of someone who submitted twice and is never written anywhere.

import { createHash } from 'node:crypto';

const MAX_NAME_LENGTH = 60;
const USERNAME_RE = /^[A-Za-z0-9_-]{3,25}$/;

export function slugify(name, username) {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const suffix = createHash('sha1').update(username.toLowerCase()).digest('hex').slice(0, 6);
  return `p_${base || 'player'}-${suffix}`;
}

/** RFC 4180 CSV. The delimiter (`;` from a Spanish Excel, `,` or tab) is detected from the header line. */
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0];
  const count = (ch) => firstLine.split(ch).length - 1;
  const delimiter = [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0];

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function findColumn(headers, patterns) {
  for (const re of patterns) {
    const index = headers.findIndex((h) => re.test(h.trim()));
    if (index !== -1) return index;
  }
  return -1;
}

/**
 * Turns the export rows into registrations: { line, name, username (raw), email }. Columns are found by their
 * question title ("Nombre y apellidos", "Usuario de chess.com"); the Forms "Nombre" column (the respondent's
 * account name) is the fallback for the name.
 */
export function extractRegistrations(rows) {
  if (rows.length === 0) throw new Error('El fichero está vacío.');
  const headers = rows[0];
  const nameCol = findColumn(headers, [/nombre y apellidos/i, /nombre completo/i, /^nombre$/i, /^name$/i]);
  const userCol = findColumn(headers, [/chess\.?com/i, /usuario/i]);
  const emailCol = findColumn(headers, [/correo/i, /e-?mail/i]);
  if (nameCol === -1 || userCol === -1) {
    throw new Error(
      `No encuentro las columnas del nombre y del usuario de chess.com. Cabeceras del fichero: ${headers.map((h) => `"${h}"`).join(', ')}.`
    );
  }
  return rows.slice(1).map((r, i) => ({
    line: i + 2,
    name: (r[nameCol] ?? '').trim().replace(/\s+/g, ' '),
    username: (r[userCol] ?? '').trim(),
    email: emailCol === -1 ? '' : (r[emailCol] ?? '').trim().toLowerCase()
  }));
}

/** Accepts "user", "@user" or a profile link (chess.com/member/user). Returns null if it can't be a username. */
export function normalizeUsername(raw) {
  let value = String(raw ?? '').trim();
  const link = /chess\.com\/(?:member|players?)\/([^/?#\s]+)/i.exec(value);
  if (link) value = link[1];
  value = value.replace(/^@/, '');
  return USERNAME_RE.test(value) ? value : null;
}

/**
 * Adds new registrations to the roster. Someone who answered twice (same e-mail) keeps their last answer;
 * usernames already in the roster are left as they are, so importing the same (or a longer) export again is
 * safe. New players are stored with `chesscomVerified: false` until checked against chess.com.
 *
 * @returns {{ roster, added, unchanged, skipped: {line, name, username, reason}[] }}
 */
export function mergeRegistrations(roster, registrations, { maxPlayers, now = new Date().toISOString() }) {
  const next = structuredClone(roster);
  const added = [];
  const unchanged = [];
  const skipped = [];

  const latest = new Map();
  registrations.forEach((reg, i) => {
    const key = reg.email || `#${i}`;
    if (latest.has(key)) skipped.push({ ...pick(latest.get(key)), reason: 'sustituida por una respuesta posterior de la misma persona' });
    latest.set(key, reg);
  });

  const taken = (username) =>
    next.players.find((p) => p.status === 'active' && p.chesscomUsername.toLowerCase() === username.toLowerCase());

  for (const reg of latest.values()) {
    const username = normalizeUsername(reg.username);
    if (!reg.name) {
      skipped.push({ ...pick(reg), reason: 'falta el nombre' });
      continue;
    }
    if (reg.name.length > MAX_NAME_LENGTH) {
      skipped.push({ ...pick(reg), reason: `nombre de más de ${MAX_NAME_LENGTH} caracteres` });
      continue;
    }
    if (!username) {
      skipped.push({ ...pick(reg), reason: 'usuario de chess.com no válido' });
      continue;
    }
    const existing = taken(username);
    if (existing) {
      if (added.includes(existing)) skipped.push({ ...pick(reg), reason: `usuario ya inscrito por ${existing.name}` });
      else unchanged.push(existing);
      continue;
    }
    if (next.players.filter((p) => p.status === 'active').length >= maxPlayers) {
      skipped.push({ ...pick(reg), reason: `aforo completo (${maxPlayers})` });
      continue;
    }
    const player = {
      id: slugify(reg.name, username),
      name: reg.name,
      chesscomUsername: username,
      status: 'active',
      registeredAt: now,
      source: 'microsoft-forms',
      chesscomVerified: false
    };
    next.players.push(player);
    added.push(player);
  }
  return { roster: next, added, unchanged, skipped };
}

function pick(reg) {
  return { line: reg.line, name: reg.name, username: reg.username };
}

/**
 * Checks every active, not-yet-verified player against chess.com: fixes the username's casing to the canonical
 * one and marks it verified, or reports it as missing. `getProfile(username)` resolves to the profile or null;
 * network errors propagate.
 *
 * @returns {{ roster, verified, invalid }}
 */
export async function verifyRoster(roster, getProfile) {
  const next = structuredClone(roster);
  const verified = [];
  const invalid = [];
  for (const player of next.players) {
    if (player.status !== 'active' || player.chesscomVerified !== false) continue;
    const profile = await getProfile(player.chesscomUsername);
    if (!profile) {
      invalid.push({ ...player, reason: 'no existe en chess.com' });
      continue;
    }
    const clash = next.players.find(
      (p) => p !== player && p.status === 'active' && p.chesscomUsername.toLowerCase() === profile.username.toLowerCase()
    );
    if (clash) {
      invalid.push({ ...player, reason: `es la misma cuenta que ${clash.name}` });
      continue;
    }
    player.chesscomUsername = profile.username;
    player.chesscomPlayerId = profile.player_id;
    player.chesscomVerified = true;
    verified.push(player);
  }
  return { roster: next, verified, invalid };
}
