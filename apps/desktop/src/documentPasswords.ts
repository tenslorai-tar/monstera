import type { CopyStanding } from '@monstera/kernel';
import { type DocId, HeldPassword } from '@monstera/shared';

/** How a document stands, as a reopen of one of its copies is told: the kernel's `CopyStanding` (one spelling). */
export type DocumentStanding = CopyStanding;

/** What every open of a document's bytes in a host is given: every key a copy may need, current first, and the standing. */
export interface EngineOpening {
  readonly keys: readonly HeldPassword[];
  readonly standing: DocumentStanding;
}

/** Where a document stands: the key it opens with now, and its standing. */
interface Position {
  readonly opensWith: HeldPassword | undefined;
  readonly standing: DocumentStanding;
}

interface Held {
  position: Position;
  /** Every key any copy of the document may be encrypted with, in the order they arrived. Only grows until close. */
  readonly keys: HeldPassword[];
  /** Each protect's position before and after it, keyed by its log entry, so it dies with the entry. */
  readonly steps: WeakMap<object, { readonly before: Position; readonly after: Position }>;
}

/** The protect's own terms, as far as opening a copy goes. */
export interface ProtectionTerms {
  readonly encryption: string;
  readonly userPassword?: string | undefined;
}

/** Before anything says otherwise: no key, and the copy's encryption kept, which is what an unknown document has. */
const UNKNOWN: Position = { opensWith: undefined, standing: 'as-copied' };

/**
 * The one holder of open documents' passwords in main
 * ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md) Decisions 1
 * and 8).
 *
 * Holds, per document, **the key that opens the document as it stands** and **every key any of its copies may need**:
 * the one an unlock was accepted with, and the user password of every protect run in this session. A protect, its undo
 * and its redo move the document between positions, each protect's before and after held beside its log entry. Written
 * only inside the document's lane, and read only to open the document's bytes in a host. Held by `EngineSessions`,
 * whose close teardown wipes and drops it with the document's entry (Decision 2), so no close path has to remember it.
 *
 * **It answers held values, never their text.** The text is revealed where a host's frame is written, so a reader that
 * only passes a key along cannot log, store or copy it on the way.
 */
export class DocumentPasswords {
  readonly #held = new Map<DocId, Held>();

  #entry(docId: DocId): Held {
    const found = this.#held.get(docId);
    if (found !== undefined) return found;
    const made: Held = { position: UNKNOWN, keys: [], steps: new WeakMap() };
    this.#held.set(docId, made);
    return made;
  }

  /** The key for `password`, the one already held when it is, so a password typed twice is held once. */
  #keyFor(held: Held, password: string): HeldPassword {
    const known = held.keys.find((key) => key.reveal() === password);
    if (known !== undefined) return known;
    const key = new HeldPassword(password);
    held.keys.push(key);
    return key;
  }

  /** Records the password `docId` opens with, which an unlock was accepted with: its file's own encryption. */
  hold(docId: DocId, password: string): void {
    const held = this.#entry(docId);
    held.position = { opensWith: this.#keyFor(held, password), standing: 'as-copied' };
  }

  /**
   * Records how a document stood when it was first opened, from what the engine answered: `plain` is a file with no
   * encryption at all, which therefore stands unprotected. Only the first answer counts; a later reopen is of a copy,
   * which says nothing about how the document stands.
   */
  opened(docId: DocId, plain: boolean): void {
    const held = this.#entry(docId);
    if (held.position !== UNKNOWN) return;
    held.position = { opensWith: undefined, standing: plain ? 'unprotected' : 'as-copied' };
  }

  /**
   * Moves the document to where `protect` leaves it, and keeps where it was beside `step`, its log entry. Its user
   * password is the key the document opens with now; a protect with none, or one removing the protection, opens with
   * none, and the second stands unprotected.
   */
  protect(docId: DocId, step: object, terms: ProtectionTerms): void {
    const held = this.#entry(docId);
    const before = held.position;
    const after: Position =
      terms.encryption === 'none'
        ? { opensWith: undefined, standing: 'unprotected' }
        : {
            opensWith: terms.userPassword === undefined ? undefined : this.#keyFor(held, terms.userPassword),
            standing: 'as-copied',
          };
    held.steps.set(step, { before, after });
    held.position = after;
  }

  /** Moves the document to where it stood before (`undo`) or after (`redo`) the protect `step`. A step it never saw is no move. */
  step(docId: DocId, step: object, to: 'before' | 'after'): void {
    const held = this.#held.get(docId);
    const positions = held?.steps.get(step);
    if (held === undefined || positions === undefined) return;
    held.position = to === 'before' ? positions.before : positions.after;
  }

  /** The key `docId` opens with as it stands, or `undefined` for a document that needs none. */
  readonly opensWith = (docId: DocId): HeldPassword | undefined => this.#held.get(docId)?.position.opensWith;

  /**
   * What an open of one of `docId`'s copies is given: the key it opens with now, then every other, newest first. The
   * frame's bound is applied where the frame is written (`composition.ts`), so the order here is what decides which
   * keys a very long session leaves unoffered: the oldest.
   */
  readonly opening = (docId: DocId): EngineOpening => {
    const held = this.#held.get(docId);
    if (held === undefined) return { keys: [], standing: UNKNOWN.standing };
    const current = held.position.opensWith;
    const others = [...held.keys].reverse().filter((key) => key !== current);
    return { keys: current === undefined ? others : [current, ...others], standing: held.position.standing };
  };

  /** Wipes and drops `docId`'s keys. The close teardown's, and idempotent. */
  readonly forget = (docId: DocId): void => {
    for (const key of this.#held.get(docId)?.keys ?? []) key.wipe();
    this.#held.delete(docId);
  };
}
