import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { type UserSid, packageDataDacl } from './hostDacl.js';
import {
  type DaclSurface,
  PACKAGE_DATA_FOLDERS,
  gatePackageData,
  lockPackageData,
  packageDataRoot,
} from './packageDataLock.js';

const user: UserSid = { __sid: 'user', value: 'S-1-5-21-1-2-3-1001' };
const family = 'Monstera.Test_0123456789abc';
const root = join('C:', 'Users', 'someone', 'AppData', 'Local', 'Packages', family);
const userData = join(root, 'LocalCache', 'Roaming', 'Monstera');

/** A package data folder as MSIX leaves it: the package's capability granted explicitly (see `hostDacl.test.ts`). */
const AS_INSTALLED = `D:AI(A;;FA;;;S-1-15-3-1-2-3)(A;OICI;FA;;;${user.value})(A;OICIID;FA;;;SY)`;

/**
 * A DACL surface over a map, recording every write — the write is the decision under test, so it is what the cases
 * read, never only the folders' end state.
 */
function fakeSurface(
  initial: string | null,
  behaviour: { refuse?: string; lieAbout?: string; unreadable?: string } = {},
): DaclSurface & { readonly writes: string[] } {
  const dacls = new Map<string, string | null>(PACKAGE_DATA_FOLDERS.map((folder) => [join(root, folder), initial]));
  const writes: string[] = [];
  const nameOf = (path: string): string => path.slice(root.length + 1);
  return {
    writes,
    read: (path) => (nameOf(path) === behaviour.unreadable ? null : (dacls.get(path) ?? null)),
    write: (path, sddl) => {
      writes.push(nameOf(path));
      if (nameOf(path) === behaviour.refuse) return false;
      // A surface whose write reports success and changes nothing — the state a read-back exists to catch.
      if (nameOf(path) !== behaviour.lieAbout) dacls.set(path, sddl);
      return true;
    },
  };
}

describe('lockPackageData', () => {
  it('locks every package data folder as MSIX left it', () => {
    const surface = fakeSurface(AS_INSTALLED);
    const lock = lockPackageData(root, user, surface);
    expect(lock.unlocked).toEqual([]);
    expect(lock.locked).toEqual([...PACKAGE_DATA_FOLDERS]);
    expect(surface.writes).toEqual([...PACKAGE_DATA_FOLDERS]);
  });

  it('writes nothing to a folder already locked', () => {
    const surface = fakeSurface(packageDataDacl(user));
    const lock = lockPackageData(root, user, surface);
    expect(surface.writes).toEqual([]);
    expect(lock).toEqual({ locked: [], unlocked: [] });
  });

  it('does not take a write that said yes as a lock', () => {
    const surface = fakeSurface(AS_INSTALLED, { lieAbout: 'TempState' });
    const lock = lockPackageData(root, user, surface);
    expect(lock.unlocked).toEqual([{ folder: 'TempState', reason: `it reads back as ${AS_INSTALLED}` }]);
    expect(lock.locked).not.toContain('TempState');
  });

  it('reports a folder whose DACL cannot be read back', () => {
    const lock = lockPackageData(root, user, fakeSurface(AS_INSTALLED, { unreadable: 'Settings' }));
    expect(lock.unlocked).toEqual([{ folder: 'Settings', reason: 'its DACL could not be read back' }]);
  });
});

describe('gatePackageData', () => {
  it('lets a host be created once every folder is locked', () => {
    const gate = gatePackageData(userData, family, user, fakeSurface(AS_INSTALLED));
    expect(gate.ok).toBe(true);
  });

  /**
   * THE OWNER'S CONTROL (ADR-0023 Decision 17): a data folder that is not locked must be refused. Windows refusing
   * the write is the realistic route to it, and the refusal names that folder and only that one.
   */
  it('refuses when a folder stays unlocked, and names it', () => {
    const gate = gatePackageData(userData, family, user, fakeSurface(AS_INSTALLED, { refuse: 'LocalState' }));
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.error).toContain('LocalState (Windows refused the new DACL)');
    for (const folder of PACKAGE_DATA_FOLDERS.filter((name) => name !== 'LocalState')) {
      expect(gate.error).not.toContain(`${folder} (`);
    }
  });

  it('writes nothing when the package root cannot be found', () => {
    const surface = fakeSurface(AS_INSTALLED);
    const gate = gatePackageData(join(root, 'Roaming', 'Monstera'), family, user, surface);
    expect(gate.ok).toBe(false);
    expect(surface.writes).toEqual([]);
  });
});

describe('packageDataRoot', () => {
  it('is the folder above LocalCache, named after the family', () => {
    expect(packageDataRoot(userData, family)).toEqual({ ok: true, value: root });
  });

  it('matches the family without regard to case, as Windows names it', () => {
    expect(packageDataRoot(userData, family.toUpperCase())).toEqual({ ok: true, value: root });
  });

  it('refuses a path with no LocalCache in it', () => {
    expect(packageDataRoot(join('C:', 'Users', 'someone', 'AppData', 'Roaming', 'Monstera'), family).ok).toBe(false);
  });

  it('refuses a LocalCache that belongs to another package', () => {
    const other = join('C:', 'Users', 'someone', 'AppData', 'Local', 'Packages', 'Other_1', 'LocalCache', 'Roaming');
    const answer = packageDataRoot(other, family);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error).toContain(family);
  });
});
