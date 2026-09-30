import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isPackageDataLocked } from './hostDacl.js';
import { PACKAGE_DATA_FOLDERS, lockPackageData } from './packageDataLock.js';
import { createWin32DaclSurface, currentPackageFamilyName } from './win32DaclSurface.js';
import { currentUserSid } from './win32PipeSurface.js';

/**
 * The lock against real folders and Windows' own rendering of what was written. `packageDataLock.test.ts` proves the
 * decisions over a fake; this is where the fake's premise — that what is written reads back as the predicate expects —
 * is measured.
 */
describe.skipIf(process.platform !== 'win32')('the Win32 DACL surface', () => {
  it('locks real folders, keeps the user, and leaves a sibling inheriting', () => {
    const user = currentUserSid();
    if (!user.ok) throw new Error(user.error);
    const surface = createWin32DaclSurface();
    const root = mkdtempSync(join(tmpdir(), 'monstera-package-data-'));
    try {
      for (const folder of PACKAGE_DATA_FOLDERS) mkdirSync(join(root, folder));
      // THE POSITIVE CONTROL: a folder nobody locked, created the same way. Without it, *not locked* read back from
      // the others would be indistinguishable from a reader that renders every DACL the same.
      const control = join(root, 'control');
      mkdirSync(control);

      const lock = lockPackageData(root, user.value, surface);

      expect(lock.unlocked).toEqual([]);
      expect(lock.locked).toEqual([...PACKAGE_DATA_FOLDERS]);
      const controlDacl = surface.read(control);
      expect(controlDacl).not.toBeNull();
      expect(isPackageDataLocked(controlDacl ?? '')).toBe(false);
      expect(controlDacl).toContain('ID;');

      // `main` runs as this user, so its data stays its own under the lock.
      const file = join(root, 'LocalCache', 'settings.json');
      writeFileSync(file, '{}');
      expect(readFileSync(file, 'utf8')).toBe('{}');

      // A second start writes nothing: every folder reads back locked.
      expect(lockPackageData(root, user.value, surface)).toEqual({ locked: [], unlocked: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports no package family for a process with no package identity', () => {
    expect(currentPackageFamilyName()).toBeNull();
  });
});
