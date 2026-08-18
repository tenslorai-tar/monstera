import { stat } from 'node:fs/promises';
import { realpath as realpathCallback } from 'node:fs';
import { promisify } from 'node:util';

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
  /** From `realpath.native`. The primary signal. */
  readonly canonicalPath: string;
  /** `dev`, or null when the filesystem supplies no usable index. */
  readonly dev: number | null;
  /** `ino`, or null when the filesystem supplies no usable index. */
  readonly ino: number | null;
  /** Corroboration only. Never evidence of sameness on its own. */
  readonly size: number;
  /** Corroboration only. Never evidence of sameness on its own. */
  readonly modifiedMs: number;
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
      canonicalPath,
      dev: hasIndex ? stats.dev : null,
      ino: hasIndex ? stats.ino : null,
      size: stats.size,
      modifiedMs: stats.mtimeMs,
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
  // Row 1. No dependence on file indexes.
  if (pathsEqual(a.canonicalPath, b.canonicalPath)) return true;

  // Row 2. dev:ino is REQUIRED — absent index, no merge, no fallback.
  if (a.dev === null || a.ino === null || b.dev === null || b.ino === null) return false;
  if (a.dev !== b.dev || a.ino !== b.ino) return false;

  // Corroboration of a merge dev:ino has already proposed. Two distinct files
  // colliding on file index AND size AND last-write time is not worth designing
  // against; two copies colliding on size and last-write time alone is the
  // ordinary case, which is why this never runs on its own.
  return a.size === b.size && a.modifiedMs === b.modifiedMs;
}

/**
 * Windows path comparison.
 *
 * `realpath.native` returns the name as recorded on disk, so two results for
 * one file agree exactly — but a caller may hold a value from a different
 * source, and NTFS is case-insensitive.
 */
function pathsEqual(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}
