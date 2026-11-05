import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../');
const DEFAULT_DATA_DIR = path.join(REPO_ROOT, 'data');

// FROG_DATA_DIR redirects every read/write to another directory (same layout
// as data/). The tournament simulator uses it so that simulated runs can never
// touch the real tournament data.
let dataDir = process.env.FROG_DATA_DIR ? path.resolve(process.env.FROG_DATA_DIR) : DEFAULT_DATA_DIR;

export function getDataDir() {
  return dataDir;
}

export function setDataDir(dir) {
  dataDir = path.resolve(dir);
}

function toJson(value) {
  return typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
}

export async function readJson(relativePath) {
  const raw = await readFile(path.join(dataDir, relativePath), 'utf8');
  return JSON.parse(raw);
}

export async function writeJson(relativePath, value) {
  const target = path.join(dataDir, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, toJson(value), 'utf8');
}

export async function writePublicJson(fileName, value) {
  await writeJson(path.join('public', fileName), value);
}
