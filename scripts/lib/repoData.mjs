import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../');
export const DATA_DIR = path.join(REPO_ROOT, 'data');
export const PUBLIC_DATA_DIR = path.join(DATA_DIR, 'public');

export async function readJson(relativePath) {
  const raw = await readFile(path.join(DATA_DIR, relativePath), 'utf8');
  return JSON.parse(raw);
}

export async function writeJson(relativePath, value) {
  const json = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path.join(DATA_DIR, relativePath), json, 'utf8');
}

export async function writePublicJson(fileName, value) {
  const json = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path.join(PUBLIC_DATA_DIR, fileName), json, 'utf8');
}
