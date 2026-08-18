import { timingSafeEqual } from 'node:crypto';

import { type FileHandle, asFileHandle } from '@monstera/shared';

import { type TokenBytesSource, cryptoBytes, mintToken } from './token.js';

/**
 * How a filesystem location reaches the renderer: as a capability token that
 * stands for a path, never as the path.
 *
 * This is the mechanism behind invariant L2. The renderer is given a handle
 * wherever the *user* or the *app* produced a location — an open dialog,
 * drag-drop, argv, a file association, an app-created temp file — and every
 * path-consuming operation takes a handle. A string path in a renderer-facing
 * type is a compile error, which `scripts/proofs/contract.proof.mjs` verifies.
 *
 * The rejected design was a runtime path-allowlist check. It fails open at
 * every handler that forgets to call it, and "every handler remembers" is a
 * property no codebase keeps for long. A handler cannot forget to call a type.
 *
 * What a handle is and is not:
 *
 * - It is **unguessable**: 256 bits from the CSPRNG. Guessing one is not a
 *   threat model anyone needs to reason about.
 * - It is **not derived from the path**. A deterministic token would be
 *   forgeable by anyone who can guess a filename, which on a desktop is
 *   everyone.
 * - It is **meaningless outside this process**. Nothing persists it; Recent
 *   Files stores paths in main and re-mints on load, so a handle captured from
 *   a previous session resolves to nothing.
 *
 * ## What this deliberately does not do
 *
 * **It does not canonicalise paths, so minting is idempotent per *string*, not
 * per *file*.** On Windows `C:\a\b.pdf`, `C:/a/b.pdf` and `c:\A\B.PDF` name one
 * file and mint three handles.
 *
 * That is safe here — each handle resolves to a path that reaches the right
 * file — but it is **not** a basis for document identity, and the distinction
 * matters: two documents over one file means two command logs and two save
 * pipelines, and the second save silently discards the first's edits. That is
 * data loss, so `DocumentService` establishes identity by canonicalising with
 * `fs.realpath` (which resolves symlinks and returns the canonical case) rather
 * than by comparing handles or raw paths.
 *
 * Canonicalisation is kept out of this class on purpose. It is fallible —
 * per-volume case folding, symlinks, UNC paths, 8.3 short names — and it needs
 * I/O, which a path that does not exist yet (a Save As target, a temp file the
 * app is about to create) cannot supply. Putting a fallible normaliser inside a
 * security primitive makes the primitive's correctness depend on the
 * normaliser's, and this primitive has one job.
 */
/**
 * Where a handle's bytes come from. See {@link TokenBytesSource} for why it is
 * injectable; `DocId` mints from the same source type and the same width.
 */
export type HandleBytesSource = TokenBytesSource;

export class CapabilityRegistry {
  readonly #pathsByHandle = new Map<string, string>();
  readonly #handlesByPath = new Map<string, FileHandle>();
  readonly #randomBytes: HandleBytesSource;

  /**
   * The default source is the CSPRNG. The parameter exists so a test can observe
   * the width actually drawn; it is not a configuration seam, and production
   * code has no reason to pass one.
   */
  constructor(randomBytesSource: HandleBytesSource = cryptoBytes) {
    this.#randomBytes = randomBytesSource;
  }

  /**
   * Returns a handle standing for `path`, minting one if this path has not been
   * seen.
   *
   * Minting is idempotent per path so that opening the same file repeatedly
   * does not grow the registry without bound. Idempotency is achieved by
   * *remembering* the handle, never by deriving it — a token computed from the
   * path would be guessable, which is the property the whole design exists to
   * avoid.
   *
   * The path is not checked for existence. A handle is a capability to name a
   * location, not an assertion that something is there; a file can be deleted
   * between the dialog closing and the read, and that failure belongs to the
   * read.
   */
  mint(path: string): FileHandle {
    if (path.length === 0) throw new Error('Cannot mint a handle for an empty path');

    const existing = this.#handlesByPath.get(path);
    if (existing !== undefined) return existing;

    // The width and the short-draw refusal are in `mintToken`, shared with the
    // `DocId` mint, so the entropy rule has one implementation rather than two
    // that can drift apart unnoticed.
    const handle = asFileHandle(mintToken('Handle', this.#randomBytes));
    this.#pathsByHandle.set(handle, path);
    this.#handlesByPath.set(path, handle);
    return handle;
  }

  /**
   * Resolves a handle to the path it stands for, or `undefined` if this
   * registry did not mint it.
   *
   * Comparison is by map lookup, which is not constant-time. That is
   * deliberate and safe here: the attacker model for a local desktop
   * application does not include an adversary timing map lookups in the main
   * process, and treating it as though it did would imply the renderer is
   * hostile — at which point the sandbox, not this class, is the control that
   * matters.
   */
  resolve(handle: FileHandle): string | undefined {
    return this.#pathsByHandle.get(handle);
  }

  /**
   * Resolves or throws. Handlers that cannot proceed without a path use this,
   * so an unminted handle fails loudly at the boundary rather than turning into
   * an `undefined` that reaches a filesystem call.
   */
  resolveOrThrow(handle: FileHandle): string {
    const path = this.resolve(handle);
    if (path === undefined) {
      // The handle is deliberately not echoed. It is not a secret, but logging
      // opaque tokens trains readers to compare them by eye, and the useful
      // information is that the handle is unknown, not which one it was.
      throw new Error(
        'Unknown FileHandle. It was not minted by this registry, or it was revoked. ' +
          'Handles do not survive a restart — Recent Files re-mints on load.',
      );
    }
    return path;
  }

  /** True when this registry minted the handle. */
  has(handle: FileHandle): boolean {
    return this.#pathsByHandle.has(handle);
  }

  /**
   * Withdraws a handle. Subsequent resolution fails as though it had never been
   * minted.
   */
  revoke(handle: FileHandle): void {
    const path = this.#pathsByHandle.get(handle);
    if (path === undefined) return;
    this.#pathsByHandle.delete(handle);
    this.#handlesByPath.delete(path);
  }

  /** Number of live handles. Exposed for tests and diagnostics. */
  get size(): number {
    return this.#pathsByHandle.size;
  }
}

/**
 * Constant-time comparison of two handles.
 *
 * Not used by `resolve` — see the note there — but provided because comparing
 * handles with `===` in a future network-facing context (a companion service,
 * a remote-control feature) would be a timing oracle, and the safe primitive
 * should exist before someone needs it rather than after.
 */
export function handlesEqual(left: FileHandle, right: FileHandle): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
