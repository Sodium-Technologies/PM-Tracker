import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

/** Which commit this build came from, so the page can say which version it is.
 *  Netlify hands the commit over as COMMIT_REF; anywhere else it is read from
 *  git, and a build with neither says so rather than guessing. */
const commit = (() => {
  if (process.env.COMMIT_REF) return process.env.COMMIT_REF.slice(0, 7);
  try { return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return 'unknown'; }
})();
const builtOn = new Date().toISOString().slice(0, 10);

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist' },
  define: {
    __BUILD__: JSON.stringify(`${commit} · ${builtOn}`),
  },
});
