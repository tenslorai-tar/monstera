import { DocumentLocked } from './engineSeam.js';

/**
 * How a document stands, as an open of one of its copies is told
 * ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md) Decision 8):
 * `as-copied` keeps the copy's own encryption, and `unprotected` decrypts the copy in memory if it is encrypted, which
 * a checkpoint a protect encrypted is once that protect is undone.
 */
export const COPY_STANDINGS = ['as-copied', 'unprotected'] as const;

/** One of {@link COPY_STANDINGS}. */
export type CopyStanding = (typeof COPY_STANDINGS)[number];

/** What an open of a copy is given: every key it may need, the one the document opens with now first, and the standing. */
export interface CopyOpening {
  readonly keys: readonly string[];
  readonly standing: CopyStanding;
}

/** The engine calls {@link openCopy} needs, injected so this module binds no native library. */
export interface CopyEngine<S> {
  readonly open: (image: Uint8Array, password?: string) => Promise<S>;
  /** Decrypts the session in memory if it is encrypted: the protect's own inverse with an `unprotected` prior. */
  readonly unprotect: (session: S) => Promise<void>;
  readonly close: (session: S) => Promise<void>;
}

/**
 * Opens a copy of a document as the document stands: with each key in turn, then with none, every attempt a fresh open
 * so a wrong key destroys only its own document (ADR-0055); then, if the document stands unprotected, decrypted in
 * memory. The one spelling of that rule, for the engine host's `engine/open` and for every proof of it.
 *
 * The last refusal is the answer: `needs-password` when no key was offered, `wrong-password` when every one was
 * refused. A session whose decrypt throws is closed before the throw leaves, so a failed open holds nothing.
 */
export async function openCopy<S>(image: Uint8Array, opening: CopyOpening, engine: CopyEngine<S>): Promise<S> {
  const session = await openWithKeys(image, opening.keys, engine);
  if (opening.standing === 'as-copied') return session;
  try {
    await engine.unprotect(session);
    return session;
  } catch (thrown) {
    await engine.close(session);
    throw thrown;
  }
}

async function openWithKeys<S>(image: Uint8Array, keys: readonly string[], engine: CopyEngine<S>): Promise<S> {
  for (const key of keys) {
    try {
      return await engine.open(image, key);
    } catch (thrown) {
      if (!(thrown instanceof DocumentLocked)) throw thrown;
    }
  }
  try {
    return await engine.open(image);
  } catch (thrown) {
    if (thrown instanceof DocumentLocked && keys.length > 0) throw new DocumentLocked('wrong-password');
    throw thrown;
  }
}
