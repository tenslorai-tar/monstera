import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type FileIdentity, isSameDocument, readFileIdentity } from './documentIdentity.js';

/**
 * The cases that carry the weight here are the ones that must stay APART.
 *
 * A merge rule is uniquely prone to passing by over-merging: an implementation
 * returning `true` unconditionally, or one that fell back to comparing size and
 * last-write time, satisfies every positive case below. The sharp negative is
 * **two copies of one document** — different files, identical size, identical
 * last-write time, often the same filename in a different directory. That is
 * the ordinary shape of a backup or a second version, and it is exactly what a
 * corroboration-based merge would wrongly join.
 */

/** A constructed identity, so the rule can be exercised without a filesystem. */
function identity(overrides: Partial<FileIdentity>): FileIdentity {
  return {
    canonicalPath: 'C:\\docs\\a.pdf',
    dev: 1,
    ino: 100,
    size: 2048,
    modifiedMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe('isSameDocument — the merge rule', () => {
  it('row 1: equal canonical paths are the same document, with no index needed', () => {
    const a = identity({ dev: null, ino: null });
    const b = identity({ dev: null, ino: null });
    expect(isSameDocument(a, b)).toBe(true);
  });

  it('row 2: different paths with a matching corroborated index are the same document', () => {
    const local = identity({ canonicalPath: 'C:\\docs\\a.pdf' });
    const unc = identity({ canonicalPath: '\\\\server\\share\\docs\\a.pdf' });
    expect(isSameDocument(local, unc)).toBe(true);
  });

  it('row 3: different paths and different indexes are different documents', () => {
    const a = identity({ canonicalPath: 'C:\\docs\\a.pdf', ino: 100 });
    const b = identity({ canonicalPath: 'C:\\docs\\b.pdf', ino: 200 });
    expect(isSameDocument(a, b)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // THE CONTROL SET. Each of these passes trivially under a widened rule.
  // ---------------------------------------------------------------------------

  it('TWO COPIES: identical size and last-write time, different files, stay apart', () => {
    const original = identity({ canonicalPath: 'C:\\docs\\annual.pdf', ino: 100 });
    const backup = identity({ canonicalPath: 'C:\\backup\\annual.pdf', ino: 200 });

    // Same name, same size, same mtime — everything a corroboration-only merge
    // would look at. Different file.
    expect(backup.size).toBe(original.size);
    expect(backup.modifiedMs).toBe(original.modifiedMs);
    expect(isSameDocument(original, backup)).toBe(false);
  });

  it('NO INDEX MEANS NO MERGE: absent dev:ino never falls back to attributes', () => {
    const a = identity({ canonicalPath: 'C:\\docs\\a.pdf', dev: null, ino: null });
    const b = identity({ canonicalPath: '\\\\nas\\share\\a.pdf', dev: null, ino: null });

    // Identical size and mtime, and a filesystem that reports no index. The
    // tempting change is to merge these. It would join every backup to its
    // original.
    expect(isSameDocument(a, b)).toBe(false);
  });

  it('a zero index on one side does not merge', () => {
    const a = identity({ canonicalPath: 'C:\\docs\\a.pdf' });
    const b = identity({ canonicalPath: '\\\\nas\\share\\a.pdf', dev: null, ino: null });
    expect(isSameDocument(a, b)).toBe(false);
  });

  it('a matching index with contradicting corroboration does not merge', () => {
    const a = identity({ canonicalPath: 'C:\\docs\\a.pdf', size: 2048 });
    const b = identity({ canonicalPath: '\\\\server\\share\\a.pdf', size: 4096 });
    expect(isSameDocument(a, b)).toBe(false);
  });

  it('a matching ino on a different device does not merge', () => {
    const a = identity({ canonicalPath: 'C:\\docs\\a.pdf', dev: 1 });
    const b = identity({ canonicalPath: 'D:\\docs\\a.pdf', dev: 2 });
    expect(isSameDocument(a, b)).toBe(false);
  });
});

describe('readFileIdentity — against a real filesystem', () => {
  let root = '';
  const original = (): string => join(root, 'annual.pdf');
  const hardLink = (): string => join(root, 'link.pdf');
  const copyDir = (): string => join(root, 'backup');
  const copy = (): string => join(copyDir(), 'annual.pdf');

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'monstera-identity-'));
    writeFileSync(original(), 'document bytes\n');

    mkdirSync(copyDir(), { recursive: true });
    writeFileSync(copy(), 'document bytes\n');

    // Force the copy to match on every corroborating attribute: same name, same
    // size, same last-write time. This is what a backup looks like.
    const when = new Date(1_700_000_000_000);
    utimesSync(original(), when, when);
    utimesSync(copy(), when, when);

    if (process.platform === 'win32') {
      execFileSync('cmd', ['/c', 'mklink', '/H', hardLink(), original()], { stdio: 'ignore' });
    }
  });

  afterAll(() => {
    if (root !== '') rmSync(root, { recursive: true, force: true });
  });

  it('a path that does not exist has no identity', async () => {
    expect(await readFileIdentity(join(root, 'absent.pdf'))).toBeNull();
  });

  it('a path THROUGH a file has no identity, and does not throw', async () => {
    expect(await readFileIdentity(join(original(), 'nested.pdf'))).toBeNull();
  });

  /** Reads an identity that must exist. A null here is a broken fixture. */
  async function mustRead(path: string): Promise<FileIdentity> {
    const found = await readFileIdentity(path);
    if (found === null) throw new Error(`fixture missing: ${path}`);
    return found;
  }

  it('the same file by two path forms is one document', async () => {
    const direct = await mustRead(original());
    const extended = await mustRead(`\\\\?\\${original()}`);
    expect(isSameDocument(direct, extended)).toBe(true);
  });

  it('wrong case is one document', async () => {
    const direct = await mustRead(original());
    const shouted = await mustRead(original().toUpperCase());
    expect(isSameDocument(direct, shouted)).toBe(true);
  });

  it.runIf(process.platform === 'win32')('a hard link is one document', async () => {
    const a = await mustRead(original());
    const b = await mustRead(hardLink());

    // realpath cannot fold these — both names are equally canonical — so this
    // case exists only because of row 2.
    expect(a.canonicalPath).not.toBe(b.canonicalPath);
    expect(isSameDocument(a, b)).toBe(true);
  });

  it('CONTROL: a real copy matching on name, size and mtime is a DIFFERENT document', async () => {
    const a = await mustRead(original());
    const b = await mustRead(copy());

    expect(b.size).toBe(a.size);
    expect(b.modifiedMs).toBe(a.modifiedMs);
    expect(isSameDocument(a, b)).toBe(false);
  });
});
