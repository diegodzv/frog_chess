import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Relative base so the build works from any GitHub Pages subpath
  // (https://<user>.github.io/<repo>/) without hardcoding the repo name.
  base: './',
  build: {
    rollupOptions: {
      input: {
        standings: resolve(dirname, 'index.html'),
        round: resolve(dirname, 'round.html'),
        bracket: resolve(dirname, 'bracket.html'),
        register: resolve(dirname, 'register.html')
      }
    }
  }
});
