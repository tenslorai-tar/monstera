import { stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * What the filesystem under a given path actually does — measured, not derived
 * from `process.platform`.
 *
 * ## Why not `process.platform`
 *
 * Because the platform is not the property. Case folding and the `\\?\` prefix
 * are properties of a *filesystem*, and the mapping to a platform is only
 * usually right: macOS is case-insensitive by default and case-sensitive when
 * the volume was formatted that way, a Windows machine can mount a
 * case-sensitive directory, and a Linux CI runner can be handed a case-folding
 * network share. Asserting Windows semantics unconditionally is what turned four
 * kernel tests red on an ubuntu runner while the same tests passed on
 * windows-latest.
 *
 * It is also the distinction the identity rule already makes. `pathsEqual`
 * refuses to fold case, precisely because folding is a guess about a filesystem
 * rather than a fact about a path (ADR-0009's 2026-08-19 correction). A test
 * suite that folds by platform is making the guess the production code refuses
 * to make.
 *
 * ## Each probe carries its own positive control
 *
 * Every function here answers by asking the filesystem for a path that must
 * resolve, and **throws if that path does not** — because each probe's negative
 * answer and its broken answer are the same value. A probe that silently
 * reported "no" for a mistyped fixture would quietly disable the assertions
 * that depend on it, which is audit item 4b arriving in a test helper.
 *
 * ## Not exported from the package index
 *
 * This is test support. It lives here rather than in `packages/testing` because
 * the module graph forbids `kernel` from importing that package, and a second
 * copy of "does this filesystem fold case" in two test files is a fact that
 * drifts.
 */

/** Whether `path` still resolves when its case is changed. */
export async function foldsCase(path: string): Promise<boolean> {
  // The control: the path as given must exist, or the answer below means
  // nothing. A missing fixture would otherwise read as "case-sensitive".
  await stat(path);

  // The BASENAME, not the whole path — found by the stage audit, which asked
  // what this guard was actually reading. A temp directory almost always
  // carries lower-case letters, so a whole-path check passes for any fixture
  // and the probe ends up reporting whether the DIRECTORY's name folds. That is
  // a different question with the same answer on most filesystems and the wrong
  // one on a case-sensitive volume holding a case-insensitive mount.
  const name = basename(path);
  if (name.toUpperCase() === name) {
    throw new Error(
      `Cannot probe case folding with "${name}": upper-casing it changes nothing, so a ` +
        'successful stat would prove only that the original exists. Use a fixture whose name ' +
        'has lower-case letters in it.',
    );
  }

  const shouted = join(dirname(path), name.toUpperCase());

  try {
    await stat(shouted);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the `\\?\` extended-length prefix resolves to the same file.
 *
 * A Win32 path convention. On a filesystem that does not know it, the prefix is
 * four ordinary characters at the front of a name that does not exist.
 */
export async function acceptsExtendedPrefix(path: string): Promise<boolean> {
  // Same control, same reason.
  await stat(path);

  try {
    await stat(`\\\\?\\${path}`);
    return true;
  } catch {
    return false;
  }
}
