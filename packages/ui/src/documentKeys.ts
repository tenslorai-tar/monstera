import { type DocId, HeldPassword } from '@monstera/shared';

/**
 * The passwords a person typed for each open document, held for this renderer's own view of it
 * ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md) Decision 7).
 *
 * PDF.js draws from the bytes main serves, and for a document opened with its password those are encrypted, so every
 * new version's parse needs the password again. Main holds its own and never sends it here; this keeps what the person
 * typed, so they are asked once per password rather than once per version.
 *
 * ## Every key, not only the last
 *
 * An undo of a protect puts the image back under the password it had before, so the newest key is the wrong one exactly
 * then. A parse tries each, newest first.
 *
 * ## Never written
 *
 * Each key is a `HeldPassword`, which no serialisation writes, and nothing here persists: no setting, no storage, no
 * channel. The holder is owned by {@link DocumentStores}, whose `close` wipes and drops a document's keys in the same
 * call that drops its store, so the lifetime is the store's by shape.
 */
export class DocumentKeys {
  readonly #keys = new Map<DocId, HeldPassword[]>();

  /** Keeps `password` for `docId`, once: a password already held is not held twice. */
  hold(docId: DocId, password: string): void {
    const held = this.#keys.get(docId) ?? [];
    if (held.some((key) => key.reveal() === password)) return;
    held.push(new HeldPassword(password));
    this.#keys.set(docId, held);
  }

  /** The document's keys, newest first. Each is revealed only at the parse that needs it. */
  keysOf(docId: DocId): readonly HeldPassword[] {
    return [...(this.#keys.get(docId) ?? [])].reverse();
  }

  /** Wipes and drops the document's keys: its close. */
  forget(docId: DocId): void {
    for (const key of this.#keys.get(docId) ?? []) key.wipe();
    this.#keys.delete(docId);
  }
}

/** One document's keys, as a view of it takes them: the held ones to try, and where an accepted one is kept. */
export interface ViewKeys {
  readonly held: () => readonly HeldPassword[];
  readonly hold: (password: string) => void;
}

/** A view that keeps no keys: Side by Side's halves, which decline a password rather than ask for one. */
export const NO_KEYS: ViewKeys = { held: () => [], hold: () => undefined };

/** `docId`'s keys in `keys`, bound for its view. Memoise the answer: a view reopens when its keys change identity. */
export function viewKeysOf(keys: DocumentKeys, docId: DocId): ViewKeys {
  return {
    held: () => keys.keysOf(docId),
    hold: (password) => {
      keys.hold(docId, password);
    },
  };
}
