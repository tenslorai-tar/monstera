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
const packages = join('C:', 'Users', 'someone', 'AppData', 'Local', 'Packages');
const root = join(packages, family);
/** As `SHGetKnownFolderPath` with the redirection flag answers inside the package (measured 2026-09-30). */
const redirectedRoaming = { ok: true, value: join(root, 'LocalCache', 'Roaming') } as const;

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
    const gate = gatePackageData(redirectedRoaming, family, user, fakeSurface(AS_INSTALLED));
    expect(gate.ok).toBe(true);
  });

  /**
   * THE OWNER'S CONTROL (ADR-0023 Decision 17): a data folder that is not locked must be refused. Windows refusing
   * the write is the realistic route to it, and the refusal names that folder and only that one.
   */
  it('refuses when a folder stays unlocked, and names it', () => {
    const gate = gatePackageData(redirectedRoaming, family, user, fakeSurface(AS_INSTALLED, { refuse: 'LocalState' }));
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.error).toContain('LocalState (Windows refused the new DACL)');
    for (const folder of PACKAGE_DATA_FOLDERS.filter((name) => name !== 'LocalState')) {
      expect(gate.error).not.toContain(`${folder} (`);
    }
  });

  it('writes nothing when Windows did not answer', () => {
    const surface = fakeSurface(AS_INSTALLED);
    const gate = gatePackageData({ ok: false, error: 'SHGetKnownFolderPath answered 0x80070002' }, family, user, surface);
    expect(gate).toEqual({
      ok: false,
      error: "the package's data root was not found: SHGetKnownFolderPath answered 0x80070002",
    });
    expect(surface.writes).toEqual([]);
  });

  /** What a process with no redirection is answered: the plain folder, which is not the package's and is not locked. */
  it('writes nothing when Roaming AppData is not redirected', () => {
    const surface = fakeSurface(AS_INSTALLED);
    const plain = { ok: true, value: join('C:', 'Users', 'someone', 'AppData', 'Roaming') } as const;
    expect(gatePackageData(plain, family, user, surface).ok).toBe(false);
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
  it('is two levels above the redirected LocalCache\\Roaming', () => {
    expect(packageDataRoot(redirectedRoaming.value, family)).toEqual({ ok: true, value: root });
  });

  it('matches every level without regard to case', () => {
    const lower = join(packages, family.toLowerCase(), 'localcache', 'roaming');
    expect(packageDataRoot(lower, family)).toEqual({ ok: true, value: join(packages, family.toLowerCase()) });
  });

  /**
   * ONE FIXTURE PER CLAUSE, each passing the other two, so removing any one clause reddens exactly its case. The
   * plain `…\AppData\Roaming` a process with no redirection gets fails two clauses at once and separates neither.
   */
  it('refuses a Roaming that is not under LocalCache', () => {
    const answer = packageDataRoot(join(root, 'LocalState', 'Roaming'), family);
    expect(answer).toEqual({
      ok: false,
      error: `${join(root, 'LocalState', 'Roaming')} is not a package's LocalCache\\Roaming — Roaming AppData is not redirected here`,
    });
  });

  it('refuses a LocalCache folder that is not Roaming', () => {
    const answer = packageDataRoot(join(root, 'LocalCache', 'Local'), family);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error).toContain('is not a package');
  });

  it("refuses another package's LocalCache\\Roaming", () => {
    const answer = packageDataRoot(join(packages, 'Other_1', 'LocalCache', 'Roaming'), family);
    expect(answer).toEqual({ ok: false, error: `${join(packages, 'Other_1')} is not named after the package family ${family}` });
  });

  it('refuses the plain Roaming AppData a process with no redirection is answered', () => {
    expect(packageDataRoot(join('C:', 'Users', 'someone', 'AppData', 'Roaming'), family).ok).toBe(false);
  });
});
