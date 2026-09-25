import { resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { type KnownRoot, displayLocationOf, knownRoots } from './displayLocation.js';

// PLATFORM PATHS, because CI runs this on Linux too and `path` is the platform's.
const HOME = resolve('home', 'someone');
const ROOTS: readonly KnownRoot[] = [
  { within: 'documents', path: resolve(HOME, 'OneDrive', 'Documents'), showsFolder: true },
  { within: 'downloads', path: resolve(HOME, 'Downloads'), showsFolder: true },
  { within: 'desktop', path: resolve(HOME, 'Desktop'), showsFolder: true },
  { within: 'onedrive', path: resolve(HOME, 'OneDrive'), showsFolder: true },
  { within: 'google-drive', path: resolve('appdata', 'cloud', 'google-drive'), showsFolder: false },
];

const at = (...parts: string[]): string => resolve(...parts);

describe('displayLocationOf (ADR-0100)', () => {
  it('names the known folder and the folder the file is in', () => {
    expect(displayLocationOf(at(HOME, 'Downloads', 'Leases', 'a.pdf'), ROOTS)).toStrictEqual({
      within: 'downloads',
      folder: 'Leases',
    });
  });

  it('shows the known folder ALONE for a file directly in it', () => {
    expect(displayLocationOf(at(HOME, 'Downloads', 'a.pdf'), ROOTS)).toStrictEqual({ within: 'downloads', folder: null });
  });

  it('names the DEEPEST known folder: Documents inside OneDrive is Documents', () => {
    expect(displayLocationOf(at(HOME, 'OneDrive', 'Documents', 'Leases', 'a.pdf'), ROOTS)).toStrictEqual({
      within: 'documents',
      folder: 'Leases',
    });
    // CONTROL: the same OneDrive, outside Documents, is OneDrive.
    expect(displayLocationOf(at(HOME, 'OneDrive', 'Legal', 'a.pdf'), ROOTS)).toStrictEqual({
      within: 'onedrive',
      folder: 'Legal',
    });
  });

  it('shows a cloud working copy as its cloud alone, since its folders are internal ids', () => {
    expect(displayLocationOf(at('appdata', 'cloud', 'google-drive', '9f2c', 'a.pdf'), ROOTS)).toStrictEqual({
      within: 'google-drive',
      folder: null,
    });
  });

  it('a file under no known folder shows the folder it is in and nothing above it', () => {
    expect(displayLocationOf(at(HOME, 'Projects', 'Q3', 'a.pdf'), ROOTS)).toStrictEqual({ within: null, folder: 'Q3' });
  });

  it('a file at a drive’s root shows nothing at all, never the drive', () => {
    expect(displayLocationOf(resolve(sep, 'a.pdf'), ROOTS)).toStrictEqual({ within: null, folder: null });
  });

  it('a folder whose name merely STARTS like a known one is not inside it', () => {
    // `Downloads2` is not `Downloads`: containment is by component, never by string prefix.
    expect(displayLocationOf(at(HOME, 'Downloads2', 'a.pdf'), ROOTS)).toStrictEqual({ within: null, folder: 'Downloads2' });
  });

  it('a folder named `..notes` inside a known folder is still inside it', () => {
    expect(displayLocationOf(at(HOME, 'Desktop', '..notes', 'a.pdf'), ROOTS)).toStrictEqual({
      within: 'desktop',
      folder: '..notes',
    });
  });

  it('NEVER carries a path: across every case above, the folder is one component', () => {
    const paths = [
      at(HOME, 'Downloads', 'Leases', 'a.pdf'),
      at(HOME, 'OneDrive', 'Documents', 'Leases', 'a.pdf'),
      at(HOME, 'Projects', 'Q3', 'a.pdf'),
      at('appdata', 'cloud', 'google-drive', '9f2c', 'a.pdf'),
      resolve(sep, 'a.pdf'),
    ];
    for (const path of paths) {
      const { folder } = displayLocationOf(path, ROOTS);
      expect(folder === null || !(folder.includes(sep) || folder.includes('/') || folder.includes(':'))).toBe(true);
    }
  });

  it('knownRoots: Electron’s three folders, each OneDrive variable that is set, and a working copy per cloud', () => {
    const roots = knownRoots({
      documents: at(HOME, 'Documents'),
      downloads: at(HOME, 'Downloads'),
      desktop: at(HOME, 'Desktop'),
      env: { OneDrive: at(HOME, 'OneDrive'), OneDriveCommercial: '', PATH: 'unrelated' },
      cloudWorkingDirectory: at('appdata', 'cloud'),
    });

    expect(roots).toStrictEqual([
      { within: 'documents', path: at(HOME, 'Documents'), showsFolder: true },
      { within: 'downloads', path: at(HOME, 'Downloads'), showsFolder: true },
      { within: 'desktop', path: at(HOME, 'Desktop'), showsFolder: true },
      // THE EMPTY VARIABLE IS SKIPPED, and nothing else in the environment is read.
      { within: 'onedrive', path: at(HOME, 'OneDrive'), showsFolder: true },
      { within: 'onedrive', path: at('appdata', 'cloud', 'onedrive'), showsFolder: false },
      { within: 'google-drive', path: at('appdata', 'cloud', 'google-drive'), showsFolder: false },
    ]);
  });

  it('an EMPTY root is no root, rather than one measured from the working directory', () => {
    expect(displayLocationOf(at('Leases', 'a.pdf'), [{ within: 'onedrive', path: '', showsFolder: true }])).toStrictEqual({
      within: null,
      folder: 'Leases',
    });
  });
});
