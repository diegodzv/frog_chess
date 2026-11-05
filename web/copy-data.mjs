// Copies the generated tournament data (data/public/*.json) into web/public/data
// so `npm run dev` / `npm run build` have something to fetch locally. The
// deploy-pages workflow does the same copy in CI; this just mirrors it for
// local development. web/public/data/ is gitignored — it's always derived.
//
// If simulated tournaments exist (sim/<name>/public, created by
// scripts/dev/simulate-tournament.mjs) they are copied to data/sim/<name>/ so any
// page can show them with ?data=sim/<name>. sim/ is gitignored, so CI and the
// deployed site never contain simulations.
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const webDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = path.join(webDir, '..');
const dest = path.join(webDir, 'public', 'data');

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

const src = path.join(repoRoot, 'data', 'public');
await cp(src, dest, { recursive: true });
console.log(`Copied ${src} -> ${dest}`);

const simRoot = path.join(repoRoot, 'sim');
if (existsSync(path.join(simRoot, 'index.json'))) {
  await cp(path.join(simRoot, 'index.json'), path.join(dest, 'sim', 'index.json'), { recursive: true });
  for (const entry of await readdir(simRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !existsSync(path.join(simRoot, entry.name, 'public'))) continue;
    await cp(path.join(simRoot, entry.name, 'public'), path.join(dest, 'sim', entry.name), { recursive: true });
    console.log(`Copied simulation ${entry.name}`);
  }
}
