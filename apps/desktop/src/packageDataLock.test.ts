import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { type UserSid, packageDataDacl } from './hostDacl.js';
import {
  type DaclSurface,
  PACKAGE_DATA_FOLDERS,
  describePackageDataCheck,
  gatePackageData,
  lockPackageData,
  packageDataRoot,
} from './packageDataLock.js';

const user: UserSid = { __sid: 'user', value: 'S-1-5-21-1-2-3-1001' };
const family = 'Monstera.Test_0123456789abc';
/** As `GetAppContainerFolderPath` answers, with the family in lower case (measured 2026-09-30). */
const packages = join('C:', 'Users', 'someone', 'AppData', 'Local', 'Packages');
const root = join(packages, family.toLowerCase());
const containerFolder = { ok: true, value: join(root, 'AC') } as const;

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
    const gate = gatePackageData(containerFolder, family, user, fakeSurface(AS_INSTALLED));
    expect(gate.ok).toBe(true);
  });

  /**
   * THE OWNER'S CONTROL (ADR-0023 Decision 17): a data folder that is not locked must be refused. Windows refusing
   * the write is the realistic route to it, and the refusal names that folder and only that one.
   */
  it('refuses when a folder stays unlocked, and names it', () => {
    const gate = gatePackageData(containerFolder, family, user, fakeSurface(AS_INSTALLED, { refuse: 'LocalState' }));
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.error).toContain('LocalState (Windows refused the new DACL)');
    for (const folder of PACKAGE_DATA_FOLDERS.filter((name) => name !== 'LocalState')) {
      expect(gate.error).not.toContain(`${folder} (`);
    }
  });

  it('writes nothing when Windows has no folder for the package', () => {
    const surface = fakeSurface(AS_INSTALLED);
    const gate = gatePackageData({ ok: false, error: 'GetAppContainerFolderPath answered 0x80070002' }, family, user, surface);
    expect(gate).toEqual({
      ok: false,
      error: "the package's data root was not found: GetAppContainerFolderPath answered 0x80070002",
    });
    expect(surface.writes).toEqual([]);
  });

  it("writes nothing when the folder Windows answered is not the package's", () => {
    const surface = fakeSurface(AS_INSTALLED);
    const gate = gatePackageData({ ok: true, value: join(packages, 'other_1', 'AC') }, family, user, surface);
    expect(gate.ok).toBe(false);
    expect(surface.writes).toEqual([]);
  });
});

describe('describePackageDataCheck', () => {
  /** The case the function exists for: a start that wrote nothing must still say the check ran and what it read. */
  it('says so when every folder was already locked', () => {
    expect(describePackageDataCheck({ ok: true, value: { locked: [], unlocked: [] } })).toEqual({
      kind: 'notice',
      detail: 'all 5 read back locked; none needed writing',
    });
  });

  it('names what this start had to lock', () => {
    const line = describePackageDataCheck({ ok: true, value: { locked: ['LocalState', 'TempState'], unlocked: [] } });
    expect(line).toEqual({ kind: 'notice', detail: 'locked this start: LocalState, TempState; all 5 read back locked' });
  });

  it('carries a refusal through as a failure, in its own words', () => {
    expect(describePackageDataCheck({ ok: false, error: 'LocalState (Windows refused the new DACL)' })).toEqual({
      kind: 'failure',
      detail: 'LocalState (Windows refused the new DACL)',
    });
  });
});

describe('packageDataRoot', () => {
  it("is the parent of the package's AC folder", () => {
    expect(packageDataRoot(containerFolder.value, family)).toEqual({ ok: true, value: root });
  });

  it('matches the family without regard to case, since Windows answers it in lower case', () => {
    expect(root.endsWith(family)).toBe(false);
    expect(packageDataRoot(containerFolder.value, family)).toEqual({ ok: true, value: root });
  });

  /**
   * WHAT THE FIRST RULE RESOLVED TO: the final path of `userData` once a same-named folder existed in the real
   * `%APPDATA%` (measured 2026-09-30). Handed here, it is refused by the rule's shape, not by a special case.
   */
  it('refuses a folder that is not an AC folder, such as the real AppData the old rule landed in', () => {
    const answer = packageDataRoot(join('C:', 'Users', 'someone', 'AppData', 'Roaming', 'Monstera PDF Editor'), family);
    expect(answer.ok).toBe(false);
  });

  /** The fixture only the AC test can refuse: its parent IS named after the family, so the family test passes it. */
  it("refuses a sibling of AC inside the package's own folder", () => {
    const answer = packageDataRoot(join(root, 'LocalCache'), family);
    expect(answer).toEqual({ ok: false, error: `${join(root, 'LocalCache')} is not an AppContainer's AC folder` });
  });

  it('refuses an AC folder that belongs to another package', () => {
    const answer = packageDataRoot(join(packages, 'other_1', 'AC'), family);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error).toContain(family);
  });
});
