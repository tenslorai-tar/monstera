import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type CanonicalPath,
  type FileIdentity,
  isSameDocument,
  readFileIdentity,
} from './documentIdentity.js';
import { acceptsExtendedPrefix, foldsCase } from './filesystemProbe.js';

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

/**
 * Brands a spelling without resolving it.
 *
 * The assertion lives here, in the file making it, rather than behind an
 * exported constructor — `CanonicalPath` has exactly one producer in production
 * (`readFileIdentity`), and that is what makes comparing them with `===` sound.
 */
function canonical(spelling: string): CanonicalPath {
  return spelling as CanonicalPath;
}

/** A constructed identity, so the rule can be exercised without a filesystem. */
function identity(
  overrides: Partial<Omit<FileIdentity, 'canonicalPath'>> & { canonicalPath?: string },
): FileIdentity {
  const { canonicalPath, ...rest } = overrides;
  return {
    dev: 1,
    ino: 100,
    size: 2048,
    modifiedMs: 1_700_000_000_000,
    changedMs: 1_700_000_000_000,
    ...rest,
    canonicalPath: canonical(canonicalPath ?? 'C:\\docs\\a.pdf'),
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

/**
 * Row 1 compares canonical paths EXACTLY. No case fold, because both folds
 * available are wrong and they are wrong in opposite directions — so a proof
 * that killed only one of them would pass the other, and the other is the worse
 * one.
 *
 * Each case below carries its OWN control: an assertion that the hazard is real
 * on this machine and in this runtime. Without those, the Turkish case is
 * indistinguishable from an accident of the CI locale, and the eszett case from
 * a coincidence.
 */
describe('row 1 compares exactly — and neither fold is acceptable', () => {
  it('LOCALE FOLD: two spellings of one path stay apart, so no locale can split them', () => {
    // The control. Under a Turkish collator, FILE and file differ — both carry
    // I/i, and Turkish pairs those with other letters. An explicit 'tr'
    // collator makes this assertion true under en-US too, so CI can see the
    // hazard it was structurally blind to.
    expect('FILE.pdf'.localeCompare('file.pdf', 'tr', { sensitivity: 'accent' })).not.toBe(0);

    // `realpath.native` returns the name as recorded on disk, so these two
    // spellings never both arrive from it. Row 1 says they are different
    // documents; where an index exists row 2 merges them anyway, and where none
    // exists a false SPLIT is the outcome a locale-sensitive compare produced
    // for real.
    const shouted = identity({ canonicalPath: 'C:\\docs\\FILE.pdf', dev: null, ino: null });
    const quiet = identity({ canonicalPath: 'C:\\docs\\file.pdf', dev: null, ino: null });
    expect(isSameDocument(shouted, quiet)).toBe(false);
  });

  it('UPPERCASE FOLD: eszett and SS are two files, and must stay two documents', () => {
    // The control naming the fold that would have merged them. JavaScript
    // expands eszett to SS; NTFS's $UpCase is a 1:1 16-bit table and cannot,
    // so it maps eszett to itself. Measured on this filesystem: the two names
    // coexist in one directory with different file indexes.
    expect('straße.pdf'.toUpperCase()).toBe('STRASSE.PDF');

    // This is why `toUpperCase()` was the wrong repair for the locale bug. A
    // false MERGE is the worse direction: the second open returns already-open,
    // one file becomes unopenable, and a write can land on the other.
    const sharp = identity({ canonicalPath: 'C:\\docs\\straße.pdf', dev: 1, ino: 100 });
    const doubled = identity({ canonicalPath: 'C:\\docs\\STRASSE.pdf', dev: 1, ino: 200 });
    expect(isSameDocument(sharp, doubled)).toBe(false);
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

  // Both cases below are about a FILESYSTEM property, and both used to assert
  // the Windows answer unconditionally — which is how they went red on an
  // ubuntu runner while passing on windows-latest. The condition is probed at
  // runtime rather than read off `process.platform`, because the platform is
  // not the property: macOS folds case by default and does not when the volume
  // says otherwise, and a network share can fold anywhere.
  //
  // NEITHER BRANCH IS A SKIP. A case-sensitive filesystem is not a filesystem
  // with nothing to assert here — it is one where the other spelling names a
  // file that does not exist, and "reports absence rather than throwing or
  // inventing" is exactly what `readFileIdentity` promises.

  // The probe's own positive controls, which nothing exercised until the stage
  // audit asked (item 4a). A probe reports `false` both when the answer is no
  // and when its subject is missing, so it throws on the second — and a throw
  // nothing tests is a throw that can be deleted by anyone who finds it
  // inconvenient.
  it('CONTROL: the probes REFUSE rather than answering about a path that is not there', async () => {
    const missing = join(root, 'no-such-fixture.pdf');
    await expect(foldsCase(missing)).rejects.toThrow();
    await expect(acceptsExtendedPrefix(missing)).rejects.toThrow();
  });

  it('CONTROL: case folding cannot be probed with a name that has no case', async () => {
    // Upper-casing "1234.pdf" changes nothing, so a successful stat would prove
    // only that the original exists — the probe would answer "folds case" on
    // every filesystem. It refuses the fixture instead of the answer.
    const caseless = join(root, '1234');
    writeFileSync(caseless, 'x');
    await expect(foldsCase(caseless)).rejects.toThrow(/upper-casing it changes nothing/u);
  });

  it('the same file by two path forms is one document, where the prefix resolves', async () => {
    const direct = await mustRead(original());
    if (!(await acceptsExtendedPrefix(original()))) {
      expect(await readFileIdentity(`\\\\?\\${original()}`)).toBeNull();
      return;
    }
    const extended = await mustRead(`\\\\?\\${original()}`);
    expect(isSameDocument(direct, extended)).toBe(true);
  });

  it('wrong case is one document, where the filesystem folds case', async () => {
    const direct = await mustRead(original());
    if (!(await foldsCase(original()))) {
      expect(await readFileIdentity(original().toUpperCase())).toBeNull();
      return;
    }
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
