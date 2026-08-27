import { stat } from 'node:fs/promises';
import { realpath as realpathCallback } from 'node:fs';
import { promisify } from 'node:util';

import type { Brand } from '@monstera/shared';

/**
 * Whether two paths name the same document.
 *
 * Two documents over one file means two command logs and two save pipelines,
 * and the second save silently discards the first's edits. That is data loss,
 * so this is the check that prevents it.
 *
 * ## The rule: MERGE on `dev:ino`, never SPLIT on it
 *
 * | `realpath.native` | `dev:ino` | Verdict |
 * |---|---|---|
 * | match | — | same document |
 * | differ | match **and corroborated** | same document |
 * | differ | anything else | different documents |
 *
 * `dev:ino` may only ever *join* two paths that `realpath.native` kept apart.
 * It can never separate two paths `realpath.native` agreed on. That asymmetry
 * is what makes the rule safe to ship against filesystems nobody here has
 * measured: one that reports unstable or zero file indexes degrades to
 * `realpath.native`-only behaviour, which is where this project already was.
 *
 * ## Why the second row exists at all — measured, not assumed
 *
 * `realpath.native` does **not** fold a UNC path to its local equivalent, and
 * does not fold two UNC forms to each other. One file, measured on Windows 11:
 *
 * - `C:\…\f.txt`
 * - `\\EMEM-PC\C$\…\f.txt`
 * - `\\localhost\C$\…\f.txt`
 *
 * gave **three** distinct `realpath.native` values and **one** `dev:ino`. In an
 * office, one of those arrives from Recent Files and another from a colleague's
 * link. Without the second row they are two documents.
 *
 * `realpath.native` also cannot fold **hard links**, by construction — two hard
 * links are equally canonical names, and there is no third name to resolve to.
 * `dev:ino` folds them.
 *
 * A `subst` DOS device mapping *is* folded by `realpath.native`, so it needs no
 * help. A genuine mapped network drive is **unmeasured** — see ADR-0009's
 * correction — which is exactly why the rule is designed to degrade rather than
 * to depend on the answer.
 *
 * ## NO `dev:ino` MEANS NO MERGE. There is no fallback.
 *
 * **If a filesystem reports a zero or missing file index, the answer is
 * "different documents". It is never "then merge on size and last-write time
 * instead".**
 *
 * This is the specific change someone will be tempted to make the first time a
 * NAS reports a zero index, and it would turn the corroboration guard into the
 * bug. Size and last-write time are how two *copies* of one document look —
 * a backup, a second version, the same filename in a different directory. They
 * agree constantly between genuinely distinct files. They are only safe as
 * corroboration of a merge `dev:ino` has **already proposed**, because
 * `dev:ino` is what carries the actual evidence of sameness; their agreement
 * alone is never sufficient and never becomes sufficient.
 *
 * Stated here, at the call site, because this is the exact place where a later
 * improvement becomes a data-corruption defect.
 *
 * ## What this cannot cover, and what does
 *
 * No path-derived identity survives a file being replaced, renamed or
 * hard-linked *while open*. `DocumentService` therefore re-verifies against the
 * actual file immediately before writing, independently of this function. With
 * that check in place a wrong answer here is a caught error rather than a
 * silent overwrite.
 */

/** `fs.promises.realpath.native` does not exist; this is the documented route. */
const realpathNative = promisify(realpathCallback.native);

/**
 * A path as the operating system spells it: the output of `realpath.native`,
 * and nothing else.
 *
 * Kernel-private (ADR-0009 §1). The brand has one producer —
 * {@link readFileIdentity} — and there is deliberately no exported constructor,
 * so a hand-built string cannot become one. That is the whole mechanism behind
 * comparing these with `===`.
 *
 * ## Why there is no case fold here, and why every candidate fold was wrong
 *
 * This used to be compared with `localeCompare(a, b, undefined, { sensitivity:
 * 'accent' })`, justified by a comment saying a caller might hold a value from
 * a different source. **That caller did not exist**, and the fold was designed
 * around a limit nobody established. Both folds available are wrong, in
 * opposite directions, and each is wrong for a different character class:
 *
 * - `localeCompare` is **locale-dependent**. Under `tr-TR` it reports
 *   `FILE.pdf` and `file.pdf` as different, because both contain `I`/`i` and
 *   Turkish collation pairs those with other letters. A row-1 miss is a **false
 *   split**: two `DocId`s for one file, two command logs, one save discarding
 *   the other's edits.
 * - `toUpperCase()` fixes that and introduces a worse one. JavaScript expands
 *   `ß` to `SS`; NTFS's `$UpCase` is a 1:1 16-bit table that cannot expand one
 *   code unit into two, so it maps `ß` to itself. Measured on this filesystem:
 *   `straße.pdf` and `STRASSE.pdf` coexist in one directory as **two files with
 *   different indexes**, while `plain.pdf` and `PLAIN.PDF` are one. So
 *   `toUpperCase` merges two genuinely distinct documents — a **false merge**,
 *   which is the worse direction: the second open returns `already-open`, one
 *   file becomes unopenable, and a write can land on the other one.
 *
 * The fold itself was the defect, so it is gone rather than replaced.
 *
 * ## Why exact comparison is strictly safer, not merely adequate
 *
 * - **Where `dev:ino` exists, row 1 is an optimisation.** Row 2 carries the
 *   merge, so a row-1 miss degrades into a row-2 merge rather than into a
 *   split.
 * - **Where `dev:ino` is absent, row 1 is the only path** — and both sides
 *   still come from `realpath.native`, which ADR-0009's measured table shows
 *   returns the name as recorded on disk, with case corrected. A false split
 *   would require that call to return two different strings for one file, which
 *   is the one thing it is specified not to do.
 *
 * A future caller holding a hand-built path is now a **compile error**, which
 * is what the old comment was reaching for and could not express (rule B5).
 */
export type CanonicalPath = Brand<string, 'CanonicalPath'>;

/**
 * The identity of one existing file.
 *
 * A path that does not exist has **no identity**, per ADR-0009 §1: there is no
 * honest canonical form to compute, and hand-folding case would reintroduce the
 * fallible normaliser kept out of `CapabilityRegistry`. Save As establishes
 * identity after the rename, when the OS can answer.
 *
 * `realpath.native` and `stat` were measured to fail identically on an absent
 * path — both `ENOENT`, for a missing file and for a path through a file — so
 * adding `dev:ino` costs nothing in reachability.
 */
export interface FileIdentity {
  /** From `realpath.native`. The primary signal. See {@link CanonicalPath}. */
  readonly canonicalPath: CanonicalPath;
  /** `dev`, or null when the filesystem supplies no usable index. */
  readonly dev: number | null;
  /** `ino`, or null when the filesystem supplies no usable index. */
  readonly ino: number | null;
  /** Corroboration only. Never evidence of sameness on its own. */
  readonly size: number;
  /** Corroboration only. Never evidence of sameness on its own. */
  readonly modifiedMs: number;
  /**
   * The inode's change time, and the corroborator a **matching** `dev:ino`
   * needs (ADR-0009's 2026-08-19 correction).
   *
   * The other two corroborating fields are marked "never evidence of sameness".
   * This one is not evidence of sameness either — it is evidence of
   * **difference**, which is the direction that was missing. `dev:ino` matching
   * is necessary and not sufficient, because an inode number is a slot and
   * slots are handed back out; a reused inode always carries a fresh change
   * time, so this cannot miss the case a bare index comparison did.
   *
   * `null` when the filesystem reports no usable value, for the same reason
   * `dev` and `ino` are nullable: an absent corroborator must never read as an
   * unchanged one.
   */
  readonly changedMs: number | null;
}

/**
 * Reads a path's identity, or `null` when the path does not exist.
 *
 * Only `ENOENT` and `ENOTDIR` mean "absent". Every other errno rethrows, so
 * this is not a `catch {}` wearing a normaliser's clothes.
 */
export async function readFileIdentity(path: string): Promise<FileIdentity | null> {
  try {
    const [canonicalPath, stats] = await Promise.all([realpathNative(path), stat(path)]);

    // A zero index is what "this filesystem has no index" looks like. Treated
    // as absent evidence rather than as the value zero, so it can never
    // collide with another zero and merge two unrelated files.
    const hasIndex = stats.dev !== 0 && stats.ino !== 0;

    return {
      // The only place a CanonicalPath is minted. Keeping this cast unexported
      // is what makes `===` sound in `isSameDocument`.
      canonicalPath: canonicalPath as CanonicalPath,
      dev: hasIndex ? stats.dev : null,
      ino: hasIndex ? stats.ino : null,
      size: stats.size,
      modifiedMs: stats.mtimeMs,
      // Same treatment as the index: a zero or non-finite change time is a
      // filesystem that did not answer, not the instant zero. Kept apart so it
      // can never compare equal to another absent value and read as unchanged.
      changedMs: Number.isFinite(stats.ctimeMs) && stats.ctimeMs !== 0 ? stats.ctimeMs : null,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

/**
 * Whether two identities name the same document.
 *
 * Read the rule above before widening this. Every positive case in its proof is
 * satisfied by an implementation that returns `true` unconditionally, so the
 * cases that carry the weight are the pairs that must stay **apart** — in
 * particular two copies of one document, which share size and last-write time
 * and are not the same file.
 */
export function isSameDocument(a: FileIdentity, b: FileIdentity): boolean {
  // Row 1. No dependence on file indexes, and no case fold — see
  // CanonicalPath for why every fold on offer is wrong for some character
  // class, and why exact comparison degrades safely here.
  if (a.canonicalPath === b.canonicalPath) return true;

  // Row 2. dev:ino is REQUIRED — absent index, no merge, no fallback.
  if (a.dev === null || a.ino === null || b.dev === null || b.ino === null) return false;
  if (a.dev !== b.dev || a.ino !== b.ino) return false;

  // Corroboration of a merge dev:ino has already proposed. Two distinct files
  // colliding on file index AND size AND last-write time is not worth designing
  // against; two copies colliding on size and last-write time alone is the
  // ordinary case, which is why this never runs on its own.
  return a.size === b.size && a.modifiedMs === b.modifiedMs;
}

// There is deliberately no exported constructor for CanonicalPath. Adding one
// would restore, as an export, exactly the hazard the brand removes: a caller
// asserting that a string it built is what the operating system would have
// returned. Tests that need to construct identities without a filesystem cast
// locally, so the assertion is visible in the file making it.
