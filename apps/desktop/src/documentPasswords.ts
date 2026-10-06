import { type DocId, HeldPassword } from '@monstera/shared';

/**
 * The one holder of open documents' passwords in main
 * ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md) Decision 1).
 *
 * Holds, per document, **the password that opens the document as it stands**: the one an unlock was accepted with.
 * Written only after the engine accepted it, inside the document's lane, and read only to open the document's bytes in
 * a host. Held by `EngineSessions`, whose close teardown wipes and drops it with the document's entry (Decision 2), so
 * no close path has to remember it.
 *
 * **It answers the held value, never its text.** The text is revealed where a host's frame is written, so a reader
 * that only passes the key along cannot log, store or copy it on the way.
 */
export class DocumentPasswords {
  readonly #held = new Map<DocId, HeldPassword>();

  /** Records the password `docId` opens with, wiping any it replaces. */
  hold(docId: DocId, password: string): void {
    this.#held.get(docId)?.wipe();
    this.#held.set(docId, new HeldPassword(password));
  }

  /** The key `docId`'s file opens with, or `undefined` for a document that needs none. */
  readonly opensWith = (docId: DocId): HeldPassword | undefined => this.#held.get(docId);

  /** Wipes and drops `docId`'s password. The close teardown's, and idempotent. */
  readonly forget = (docId: DocId): void => {
    this.#held.get(docId)?.wipe();
    this.#held.delete(docId);
  };
}
