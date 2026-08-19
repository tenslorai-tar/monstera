/**
 * An explicit success-or-failure value.
 *
 * Used where a failure is an expected outcome rather than a defect — a document
 * that will not parse, a password that is wrong, a binary that is missing.
 * Those cross process boundaries, and an exception does not survive that trip
 * intact: it arrives as a string, or as `{}`, having lost its cause. C5 requires
 * errors to cross structurally, and a Result makes the failure part of the
 * return type so a caller cannot forget it exists.
 *
 * Genuine defects — a violated invariant, an impossible state — still throw.
 * Wrapping those in a Result would ask every caller to handle a condition that
 * means the program is already wrong.
 */
export type Result<T, E = Failure> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * The shape an error takes when it crosses a process or worker boundary. `cause`
 * is retained because the useful half of a failure is usually underneath the
 * message that reached the top.
 */
export interface StructuredError {
  readonly name: string;
  readonly message: string;
  // `| undefined` is explicit, and required, under exactOptionalPropertyTypes.
  // This type describes a value that has crossed a process boundary, and the
  // sender decides whether an absent field arrives absent or present-and-
  // undefined: structuredClone preserves an explicit undefined where JSON drops
  // the key entirely. Declaring `?: string` would claim a guarantee the wire
  // does not make. Producers here still omit the key — see toStructuredError —
  // so the narrower form is what we emit, not what we can insist on receiving.
  readonly stack?: string | undefined;
  readonly cause?: StructuredError | undefined;
}

/**
 * What a failure looks like **to the renderer** (ADR-0009 §9, 2026-08-19).
 *
 * ## Why this is not `StructuredError` with the paths taken out
 *
 * `StructuredError` copies `message`, copies `stack`, and recurses into `cause`
 * with itself. Sanitising it means filtering free text, and free text is a
 * filter that has to be right on every message ever written — the runtime check
 * B5 says to prefer a type over. Measured, a rethrown `EPERM` reads
 * `EPERM: operation not permitted, stat '<absolute path>'`, with the same path
 * in the stack.
 *
 * So this carries **no `message`, no `stack`, no `cause`**. A field that does
 * not exist cannot leak, and `stack` is the worst of the three: it carries the
 * absolute paths of *source files* as well as of the target, which no sanitiser
 * matching document paths would catch.
 *
 * The two objects have opposite jobs and both are right on their own side.
 * `StructuredError` preserves diagnostics and stays in the main process, where
 * the path is already known and discloses nothing. This crosses.
 *
 * ## What the renderer does with it
 *
 * `code` selects an i18n key. **No text crosses at all**, which closes a second
 * hole for free: a boundary that cannot carry a string cannot carry an
 * unlocalised one (B9).
 *
 * `incident` joins this to the full diagnostic in the main-side log. Opaque by
 * construction — it identifies a log entry, not a file.
 *
 * ## Typed fields
 *
 * There are none yet, and that is deliberate rather than unfinished. A code
 * needing a field gets one when a caller needs it; what the type forbids either
 * way is free text. Fields it may carry are ones that cannot express a path —
 * a `DocId`, a count, an enum member — which inherits invariant L2 rather than
 * restating it.
 */
export interface Failure<C extends string = string> {
  readonly code: C;
  /** Opaque id of the full diagnostic in the main-side log. Never a path. */
  readonly incident: string;
}

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Converts a thrown value into a serialisable error.
 *
 * `catch` yields `unknown` — a string, a number, or null are all legal throws —
 * so the non-Error cases are normalised rather than assumed away.
 */
export function toStructuredError(thrown: unknown): StructuredError {
  if (thrown instanceof Error) {
    return {
      name: thrown.name,
      message: thrown.message,
      ...(thrown.stack === undefined ? {} : { stack: thrown.stack }),
      ...(thrown.cause === undefined ? {} : { cause: toStructuredError(thrown.cause) }),
    };
  }
  return { name: 'UnknownError', message: String(thrown) };
}
