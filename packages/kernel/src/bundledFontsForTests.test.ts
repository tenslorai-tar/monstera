import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { bundledFontsFolder } from './bundledFontsForTests.js';

const VARIABLE = 'MONSTERA_FONTS_DIRECTORY';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('bundledFontsFolder', () => {
  it('answers the provisioned folder, the one vitest.config.mjs passes', () => {
    const folder = bundledFontsFolder();
    expect(readdirSync(folder).some((name) => name.endsWith('.ttf'))).toBe(true);
  });

  it('fails NAMING THE COMMAND where the folder holds no face, rather than a bare error from deep in a reader (VVVVVVV-3)', () => {
    const empty = mkdtempSync(join(tmpdir(), 'monstera-no-fonts-'));
    try {
      vi.stubEnv(VARIABLE, empty);
      expect(() => bundledFontsFolder()).toThrow(/npm run provision:fonts/u);
      vi.stubEnv(VARIABLE, '');
      expect(() => bundledFontsFolder()).toThrow(/no folder given.*npm run provision:fonts/u);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('is the one reader: no other kernel test reads the variable itself', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const spelling = `process.env['${VARIABLE}']`;
    // EVERY FOLDER UNDER src, `host/` included: a scan of the top folder alone passed while a host test still read the
    // variable with the empty fallback this helper exists to end (the audit of 39a81ead..cd0abe3c).
    const all = readdirSync(here, { recursive: true, encoding: 'utf8' }).map((name) => name.replaceAll('\\', '/'));
    const readers = all
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => readFileSync(join(here, name), 'utf8').includes(spelling));
    // POSITIVE CONTROLS: the helper itself reads it, so a search that sees nothing is a broken search, not a clean tree;
    // and the walk reaches a file inside `host/`, so a scan that stopped at the top folder fails here too.
    expect(readers).toContain('bundledFontsForTests.ts');
    expect(all).toContain('host/remoteEngine.test.ts');
    expect(readers).toStrictEqual(['bundledFontsForTests.ts']);
  });
});
