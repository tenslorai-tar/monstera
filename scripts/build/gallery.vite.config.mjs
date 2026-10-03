/**
 * The dialog gallery's build: `packages/ui/gallery.html`, a capture tool that opens each registered dialog in each
 * of its sample states (`packages/ui/src/gallery/dialogGallery.tsx`). Its own entry and its own output under the
 * ignored `.tools/`, so the renderer's build, whose one entry is `index.html`, and everything that packages it,
 * never see it.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export default defineConfig({
  root: join(REPO_ROOT, 'packages', 'ui'),
  base: './',
  plugins: [react()],
  assetsInclude: ['**/*.bcmap'],
  build: {
    outDir: join(REPO_ROOT, '.tools', 'gallery'),
    emptyOutDir: true,
    rollupOptions: { input: join(REPO_ROOT, 'packages', 'ui', 'gallery.html') },
  },
});
