import { inspect } from 'node:util';

import type { DocId } from '@monstera/shared';

/** What every way of writing a {@link HeldPassword} writes instead of it. */
export const HELD_PASSWORD_REDACTION = '[a document password, held and not shown]';

/**
 * A document's password as main holds it while the document is open
 * ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md) Decision 2).
 *
 * **It cannot be written, by shape.** The only state is a byte array behind a private field, so there is no enumerable
 * property for `JSON.stringify`, a structured clone or a spread to copy, and the three ways the code turns a value into
 * text (`toJSON`, `toString`, Node's inspection) answer {@link HELD_PASSWORD_REDACTION}. The text comes out through
 * {@link reveal} alone, at the one call that hands it to an engine host's pipe.
 *
 * **Wiping is filling the bytes with zeros.** A JavaScript string cannot be overwritten, so the string the renderer's
 * message arrived as and the one a host frame leaves as are collected rather than wiped; this holds no string of its own.
 */
export class HeldPassword {
  readonly #bytes: Uint8Array;
  #wiped = false;

  constructor(text: string) {
    this.#bytes = new TextEncoder().encode(text);
  }

  /** The password's text, for an engine host's open. Refused once wiped, so a wiped holder cannot open as nothing. */
  reveal(): string {
    if (this.#wiped) throw new Error('a wiped password was asked for, which is a document read after its close');
    return new TextDecoder().decode(this.#bytes);
  }

  /** Fills the bytes with zeros. Idempotent. */
  wipe(): void {
    this.#bytes.fill(0);
    this.#wiped = true;
  }

  /** Whether every byte now reads as zero: what a wipe leaves, for the case that proves it. */
  isWiped(): boolean {
    return this.#wiped && this.#bytes.every((byte) => byte === 0);
  }

  toJSON(): string {
    return HELD_PASSWORD_REDACTION;
  }

  toString(): string {
    return HELD_PASSWORD_REDACTION;
  }

  [inspect.custom](): string {
    return HELD_PASSWORD_REDACTION;
  }
}

/**
 * The one holder of open documents' passwords in main (ADR-0171 Decision 1).
 *
 * Holds, per document, **the password that opens the document as it stands**: the one an unlock was accepted with.
 * Written only after the engine accepted it, inside the document's lane, and read only to open an engine session. Held
 * by `EngineSessions`, whose close teardown wipes and drops it with the document's entry (Decision 2), so no close
 * path has to remember it.
 */
export class DocumentPasswords {
  readonly #held = new Map<DocId, HeldPassword>();

  /** Records the password `docId` opens with, wiping any it replaces. */
  hold(docId: DocId, password: string): void {
    this.#held.get(docId)?.wipe();
    this.#held.set(docId, new HeldPassword(password));
  }

  /** The text `docId` opens with, for an engine host's open, or `undefined` for a document that needs none. */
  readonly openingPassword = (docId: DocId): string | undefined => this.#held.get(docId)?.reveal();

  /** Wipes and drops `docId`'s password. The close teardown's, and idempotent. */
  readonly forget = (docId: DocId): void => {
    this.#held.get(docId)?.wipe();
    this.#held.delete(docId);
  };

  /** The held value itself, for the case that proves a close wiped it. */
  heldFor(docId: DocId): HeldPassword | undefined {
    return this.#held.get(docId);
  }
}
