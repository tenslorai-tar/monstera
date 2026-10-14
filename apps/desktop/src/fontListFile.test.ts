import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { type FolderListing, fontFoldersFingerprint, keptFontFamilies } from './fontListFile.js';
import { createEphemeralSettings } from './settingsFile.js';

/**
 * The font folders' fingerprint and the kept list (ADR-0237): a font installed, removed or replaced changes the
 * fingerprint, and the same folders give the same one, so the list is read from the host exactly when the fonts changed.
 */
function listing(folders: Record<string, Record<string, { size: number; mtimeMs: number }>>): FolderListing {
  return {
    names: (folder) => {
      const files = folders[folder];
      if (files === undefined) throw new Error(`no folder ${folder}`);
      return Object.keys(files);
    },
    stat: (path) => {
      for (const [folder, files] of Object.entries(folders)) {
        for (const [name, stat] of Object.entries(files)) {
          // JOINED AS THE CODE JOINS, by `path.join`: on Windows it turns `/bundled` into `\bundled`, which the two
          // spellings this case once listed by hand did not cover (CI's Windows leg, 2026-10-14).
          if (path === join(folder, name)) return { ...stat, isFile: true };
        }
      }
      throw new Error(`no file ${path}`);
    },
  };
}

const FONTS = { '/bundled': { 'Tinos.ttf': { size: 100, mtimeMs: 1 } }, '/system': { 'arial.ttf': { size: 200, mtimeMs: 2 } } };
const of = (folders: typeof FONTS | Record<string, Record<string, { size: number; mtimeMs: number }>>): string =>
  fontFoldersFingerprint(['/bundled', '/system'], listing(folders));

describe('fontFoldersFingerprint', () => {
  it('is the same for the same folders, whatever order the names are listed in', () => {
    const reordered = { '/bundled': FONTS['/bundled'], '/system': { 'arial.ttf': { size: 200, mtimeMs: 2 } } };
    expect(of(reordered)).toBe(of(FONTS));
  });

  // CONTROL: each change a font makes to its folder is a different fingerprint.
  it('changes when a font is installed, removed, replaced at another size, or touched', () => {
    const base = of(FONTS);
    expect(of({ ...FONTS, '/system': { ...FONTS['/system'], 'new.ttf': { size: 5, mtimeMs: 3 } } })).not.toBe(base);
    expect(of({ ...FONTS, '/system': {} })).not.toBe(base);
    expect(of({ ...FONTS, '/system': { 'arial.ttf': { size: 201, mtimeMs: 2 } } })).not.toBe(base);
    expect(of({ ...FONTS, '/system': { 'arial.ttf': { size: 200, mtimeMs: 9 } } })).not.toBe(base);
    expect(fontFoldersFingerprint(['/bundled', '/gone'], listing(FONTS))).not.toBe(base);
  });
});

describe('keptFontFamilies', () => {
  const LIST = { families: [{ name: 'Tinos', origin: 'bundled' as const, embedding: 'subset' as const, bold: true, italic: true }], more: 0 };

  it('reads the host once, keeps its answer, and answers from the file while the fingerprint holds', async () => {
    const file = createEphemeralSettings();
    let asked = 0;
    const fromHost = (): Promise<typeof LIST> => {
      asked += 1;
      return Promise.resolve(LIST);
    };
    expect(await keptFontFamilies(file, () => 'a'.repeat(64), fromHost)).toStrictEqual(LIST);
    expect(await keptFontFamilies(file, () => 'a'.repeat(64), fromHost)).toStrictEqual(LIST);
    expect(asked).toBe(1);
    // CONTROL: another fingerprint asks again.
    await keptFontFamilies(file, () => 'b'.repeat(64), fromHost);
    expect(asked).toBe(2);
  });

  it('asks the host again for a kept file that does not read as one, rather than trusting part of it', async () => {
    const file = createEphemeralSettings();
    file.write({ fingerprint: 'a'.repeat(64), families: [{ name: '' }], more: 0 });
    let asked = 0;
    await keptFontFamilies(file, () => 'a'.repeat(64), () => {
      asked += 1;
      return Promise.resolve(LIST);
    });
    expect(asked).toBe(1);
  });

  it('keeps nothing when the host read fails', async () => {
    const file = createEphemeralSettings();
    await expect(keptFontFamilies(file, () => 'a'.repeat(64), () => Promise.reject(new Error('the host failed')))).rejects.toThrow('the host failed');
    expect(file.read()).toStrictEqual({});
  });
});
