/** What every way of writing a {@link HeldPassword} writes instead of it. */
export const HELD_PASSWORD_REDACTION = '[a document password, held and not shown]';

/**
 * The key Node's `util.inspect` looks a custom rendering up by. Named through the global symbol registry rather than
 * imported, so this module needs nothing from Node and the renderer's bundle can carry the type.
 */
const INSPECT = Symbol.for('nodejs.util.inspect.custom');

/**
 * A document's password as main holds it while the document is open
 * ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md) Decision 2).
 *
 * **It cannot be written, by shape.** The only state is a byte array behind a private field, so there is no enumerable
 * property for `JSON.stringify`, a structured clone or a spread to copy, and the three ways the code turns a value into
 * text (`toJSON`, `toString`, Node's inspection) answer {@link HELD_PASSWORD_REDACTION}. The text comes out through
 * {@link reveal} alone, where an engine host's frame is written.
 *
 * **Wiping is filling the units with zeros.** They are the text's UTF-16 code units, the string's own representation,
 * so holding and revealing need nothing from a platform. A JavaScript string cannot be overwritten, so the string the
 * renderer's message arrived as and the one a host frame leaves as are collected rather than wiped; this holds no
 * string of its own.
 *
 * In `shared` because a kernel type carries it — a byte-image writer's session (ADR-0171's addendum) — and the holder
 * that wipes it is in `apps/desktop`.
 */
export class HeldPassword {
  readonly #units: Uint16Array;
  #wiped = false;

  constructor(text: string) {
    this.#units = Uint16Array.from({ length: text.length }, (_, at) => text.charCodeAt(at));
  }

  /** The password's text, for an engine host's open. Refused once wiped, so a wiped holder cannot open as nothing. */
  reveal(): string {
    if (this.#wiped) throw new Error('a wiped password was asked for, which is a document read after its close');
    return Array.from(this.#units, (unit) => String.fromCharCode(unit)).join('');
  }

  /** Fills the units with zeros. Idempotent. */
  wipe(): void {
    this.#units.fill(0);
    this.#wiped = true;
  }

  /** Whether every unit now reads as zero: what a wipe leaves, for the case that proves it. */
  isWiped(): boolean {
    return this.#wiped && this.#units.every((unit) => unit === 0);
  }

  toJSON(): string {
    return HELD_PASSWORD_REDACTION;
  }

  toString(): string {
    return HELD_PASSWORD_REDACTION;
  }

  [INSPECT](): string {
    return HELD_PASSWORD_REDACTION;
  }
}
