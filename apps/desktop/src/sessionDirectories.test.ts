import { describe, expect, it } from 'vitest';

import { type ContainerSid, type UserSid, handedDirectoryDacl } from './hostDacl.js';
import {
  type DirectoryCreationSurface,
  type DirectoryPath,
  createSessionDirectories,
  removeSessionDirectories,
  sessionDirectoryName,
  sessionDirectoryPaths,
} from './sessionDirectories.js';

const user: UserSid = { __sid: 'user', value: 'S-1-5-21-USER' };
const container: ContainerSid = { __sid: 'container', value: 'S-1-15-2-CONTAINER' };

/**
 * A recording surface.
 *
 * ONE list for every call, as `enginePipeFactory.test.ts` does, because the
 * properties under test are about ORDER and about what happens after a refusal.
 * Per-call spies would let "the snapshot is removed when the output fails" pass
 * against a factory that removed it before trying.
 */
function recorder(outcomes: ('created' | 'exists' | 'refused')[]): {
  surface: DirectoryCreationSurface;
  calls: string[];
} {
  const calls: string[] = [];
  const queue = [...outcomes];
  return {
    calls,
    surface: {
      create: (path, sddl) => {
        calls.push(`create(${path}, ${sddl})`);
        return queue.shift() ?? 'created';
      },
      remove: (path) => {
        calls.push(`remove(${path})`);
        return true;
      },
      removeTree: (path) => {
        calls.push(`removeTree(${path})`);
        return true;
      },
      lastError: () => 5,
    },
  };
}

function paths() {
  const name = sessionDirectoryName('a1b2-c3');
  if (!name.ok) throw new Error(name.error);
  return sessionDirectoryPaths('C:\\root', name.value);
}

describe('sessionDirectoryName', () => {
  it('accepts a lower-case hex and hyphen name', () => {
    expect(sessionDirectoryName('0f-9a')).toEqual({ ok: true, value: '0f-9a' });
  });

  /**
   * AN ALLOWLIST, so the cases below are examples rather than the specification.
   * Each is a spelling that reaches a directory other than the intended one,
   * and none of them is enumerated by the implementation — which is the point:
   * a denylist would have to know them all.
   */
  it.each([
    ['..', 'the parent'],
    ['.', 'the same directory'],
    ['a\\b', 'a separator'],
    ['a/b', 'the other separator'],
    ['a:b', 'an alternate data stream'],
    ['CON', 'a device name'],
    ['A1B2', 'upper case, which a case-insensitive filesystem folds'],
    ['a b', 'a space'],
    ['', 'nothing at all'],
  ])('refuses %j — %s', (value) => {
    expect(sessionDirectoryName(value).ok).toBe(false);
  });

  it('refuses a name one character over the bound', () => {
    expect(sessionDirectoryName('a'.repeat(65)).ok).toBe(false);
    expect(sessionDirectoryName('a'.repeat(64)).ok).toBe(true);
  });
});

describe('sessionDirectoryPaths', () => {
  /**
   * FLAT, and the two cannot collide. A nested layout would need a grant on the
   * directory above them, which is the inherited ACE the split exists to
   * prevent.
   */
  it('puts both directories directly under the root', () => {
    const directories = paths();
    expect(directories.snapshot).toBe('C:\\root\\in-a1b2-c3');
    expect(directories.output).toBe('C:\\root\\out-a1b2-c3');
  });
});

describe('createSessionDirectories', () => {
  /**
   * THE LOAD-BEARING CASE. The defect worth catching is not a create that
   * fails — it is a pair created with the WRONG WAY ROUND or with one DACL used
   * for both, which succeeds, leaves a working system, and hands the contained
   * host a document it can rewrite.
   *
   * So this asserts the exact descriptor per path, from the same resolver the
   * implementation calls. A fixture asserting only "two creates happened" is
   * one the bug also handles correctly.
   */
  it('grants the snapshot read and the output modify, in that order', () => {
    const directories = paths();
    const { surface, calls } = recorder(['created', 'created']);

    const result = createSessionDirectories(surface, directories, user, container);

    expect(result).toEqual({ ok: true, value: directories });
    expect(calls).toEqual([
      `create(C:\\root\\in-a1b2-c3, ${handedDirectoryDacl(user, container, 'read')})`,
      `create(C:\\root\\out-a1b2-c3, ${handedDirectoryDacl(user, container, 'modify')})`,
    ]);
    // Belt and braces on the half that matters: whatever else moved, the
    // snapshot's descriptor is never the modify one.
    expect(calls[0]).not.toContain('0x001301BF');
    expect(calls[1]).toContain('0x001301BF');
  });

  /**
   * BOTH OR NEITHER. A snapshot directory left behind a failed creation is
   * granted read to the container and is where the user's document goes next.
   */
  it('removes the snapshot when the output is refused', () => {
    const directories = paths();
    const { surface, calls } = recorder(['created', 'refused']);

    const result = createSessionDirectories(surface, directories, user, container);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.stage).toBe('output');
    expect(result.error.detail).toContain('GetLastError 5');
    expect(calls[calls.length - 1]).toBe('remove(C:\\root\\in-a1b2-c3)');
  });

  it('creates nothing else when the snapshot itself is refused', () => {
    const directories = paths();
    const { surface, calls } = recorder(['refused']);

    const result = createSessionDirectories(surface, directories, user, container);

    expect(result.ok).toBe(false);
    expect(calls).toEqual([
      `create(C:\\root\\in-a1b2-c3, ${handedDirectoryDacl(user, container, 'read')})`,
    ]);
  });

  /**
   * `exists` IS NOT `refused`, AND IT IS NOT SUCCESS. A directory already at
   * this path carries a DACL nobody in this run wrote — possibly one already
   * granted to a container — so adopting it would hand the host a grant this
   * process never made. The diagnostic has to say which of the two happened,
   * because only one of them is somebody else's directory.
   */
  it.each([
    ['snapshot', ['exists' as const], 'snapshot'],
    ['output', ['created' as const, 'exists' as const], 'output'],
  ])('refuses an existing %s directory rather than adopting it', (_which, outcomes, stage) => {
    const directories = paths();
    const { surface } = recorder(outcomes);

    const result = createSessionDirectories(surface, directories, user, container);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.stage).toBe(stage);
    expect(result.error.detail).toContain('already exists');
    // Separable from the refused case: that one names GetLastError, this one
    // must not, because there is no error to name.
    expect(result.error.detail).not.toContain('GetLastError');
  });
});

describe('removeSessionDirectories', () => {
  it('removes both trees and says so', () => {
    const directories = paths();
    const { surface, calls } = recorder([]);

    expect(removeSessionDirectories(surface, directories)).toEqual({
      snapshot: true,
      output: true,
    });
    expect(calls).toEqual([
      'removeTree(C:\\root\\in-a1b2-c3)',
      'removeTree(C:\\root\\out-a1b2-c3)',
    ]);
  });

  /**
   * THE CONTROL FOR THE ONE ABOVE. A remover that returned a hard-coded pair of
   * `true`s would pass every assertion in this file's happy path — and the
   * `false` is the whole signal, because it means a directory that may hold the
   * user's document is still on disk.
   */
  it('reports a directory it could not remove', () => {
    const directories = paths();
    const surface: DirectoryCreationSurface = {
      create: () => 'created',
      remove: () => true,
      removeTree: (path: DirectoryPath) => path !== directories.output,
      lastError: () => 0,
    };

    expect(removeSessionDirectories(surface, directories)).toEqual({
      snapshot: true,
      output: false,
    });
  });

  /**
   * BOTH ARE ATTEMPTED EVEN WHEN THE FIRST FAILS. A close that stopped at the
   * first failure would leave the other directory — and the ordering puts the
   * snapshot, the one holding the user's document, first.
   */
  it('attempts the output even when the snapshot could not be removed', () => {
    const directories = paths();
    const calls: string[] = [];
    const surface: DirectoryCreationSurface = {
      create: () => 'created',
      remove: () => true,
      removeTree: (path: DirectoryPath) => {
        calls.push(path);
        return false;
      },
      lastError: () => 0,
    };

    expect(removeSessionDirectories(surface, directories)).toEqual({
      snapshot: false,
      output: false,
    });
    expect(calls).toEqual([directories.snapshot, directories.output]);
  });
});
