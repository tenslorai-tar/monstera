import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import koffi from 'koffi';
import { describe, expect, it } from 'vitest';

import { isPackageDataLocked } from './hostDacl.js';
import { PACKAGE_DATA_FOLDERS, lockPackageData } from './packageDataLock.js';
import { appContainerFolder, createWin32DaclSurface, currentPackageFamilyName } from './win32DaclSurface.js';
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

  /**
   * WINDOWS' ANSWER FOR A CONTAINER THAT EXISTS, AND FOR ONE THAT DOES NOT. A profile created here stands for the
   * package — Windows keeps every AppContainer's folder at `…\Packages\<name>\AC`, the package's included — and a name
   * with no profile is the control, which must be refused rather than answered with a path someone assembled.
   */
  it('finds the AC folder of a container that exists, and refuses one that does not', () => {
    const userenv = koffi.load('userenv.dll');
    const create = userenv.func(
      'int32 CreateAppContainerProfile(const char16_t *name, const char16_t *display, const char16_t *description, ' +
        'void *capabilities, uint32 count, _Out_ void **sid)',
    );
    const remove = userenv.func('int32 DeleteAppContainerProfile(const char16_t *name)');
    const freeSid = koffi.load('advapi32.dll').func('void *FreeSid(void *sid)');
    const name = `monstera.test.containerfolder.${randomBytes(4).toString('hex')}`;
    const sid: unknown[] = [null];
    expect(create(name, name, name, null, 0, sid)).toBe(0);
    freeSid(sid[0]);
    try {
      const found = appContainerFolder(name);
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(basename(found.value)).toBe('AC');
      expect(basename(dirname(found.value))).toBe(name);
      expect(existsSync(found.value)).toBe(true);
    } finally {
      remove(name);
    }
    const gone = appContainerFolder(name);
    expect(gone.ok).toBe(false);
    if (gone.ok) return;
    expect(gone.error).toContain('GetAppContainerFolderPath answered 0x80070002');
  });
});
