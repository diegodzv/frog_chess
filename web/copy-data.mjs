// Copies the generated tournament data (data/public/*.json) into web/public/data
// so `npm run dev` / `npm run build` have something to fetch locally. The
// deploy-pages workflow does the same copy in CI; this just mirrors it for
// local development. web/public/data/ is gitignored — it's always derived.
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const webDir = fileURLToPath(new URL('.', import.meta.url));
const src = path.join(webDir, '..', 'data', 'public');
const dest = path.join(webDir, 'public', 'data');

await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`Copied ${src} -> ${dest}`);
