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

/**
 * The code that means *"this was not a planned failure"*.
 *
 * Lives here rather than in the contract package because {@link Failure}'s shape
 * turns on it: the id-carrying half of that union is *this code's* half. Two
 * declarations of one literal is how the type and the schema get to disagree
 * about which failures carry an id.
 */
export const INTERNAL_FAILURE = 'internal';
export type InternalFailure = typeof INTERNAL_FAILURE;

/**
 * A failure on the wire, in **one of two shapes** (ADR-0009, 2026-08-19).
 *
 * A declared code travels alone. `internal` travels with the id of the log entry
 * its diagnostic was withheld into. So an `incident` accompanies **exactly** the
 * failures that hid something, and that is a property of the type rather than a
 * convention someone follows.
 *
 * ## Why the id is not on both halves
 *
 * It was, for two commits, and the first handler is what showed the problem:
 * `wrapHandler` gives a handler its params and nothing else, so a handler
 * returning a **declared** failure has no source for an id the type demands. The
 * only instances in the tree were test fixtures writing `'i0'` by hand.
 *
 * Both ways of supplying one are worse than not having one. A **fabricated** id
 * points at no log line, so the one action a user can take — report it — leads
 * whoever searches the log to nothing. A **second log** collides: counters are
 * per log and both start at zero, so a handler's `i1` and the boundary's `i1`
 * are different failures wearing one id, which is the state
 * `boundary.ts` keeps one log per registry to prevent.
 *
 * A declared failure hides nothing — the code is the whole of what happened —
 * so there is no entry for an id to point at.
 *
 * ## The limit of the unparameterised form, stated rather than left to be found
 *
 * `Exclude<string, 'internal'>` is `string`: a literal cannot be subtracted from
 * the open type. So `Failure` with no argument does **not** forbid
 * `{ code: 'internal' }` without an id. Every real use is parameterised by a
 * channel's declared codes, where the exclusion does work, and the schema
 * refuses the shape at runtime on the wire — but the bare default is weaker than
 * the parameterised type and saying so here is cheaper than someone concluding
 * otherwise from the name.
 */
export type Failure<C extends string = string> =
  // The declared half is ELIDED when a channel declares nothing, rather than
  // left as `{ code: never }`. An uninhabited member is not harmless here: the
  // property access `error.incident` fails against it — a member no value can
  // ever take — while narrowing on the code is simultaneously flagged as always
  // false, because the code really is `'internal'`. The type would be demanding
  // a discrimination it had already made. `[X] extends [never]` is the
  // non-distributive form; the bare `X extends never` distributes and answers
  // for each member instead of for the union.
  | ([Exclude<C, InternalFailure>] extends [never]
      ? never
      : { readonly code: Exclude<C, InternalFailure> })
  | {
      readonly code: InternalFailure;
      /** Opaque id of the full diagnostic in the main-side log. Never a path. */
      readonly incident: string;
    };

/**
 * What a **handler** may report: a code its channel declared, and nothing else.
 *
 * No `incident`, because a handler cannot obtain one honestly. No `internal`
 * either — that is the boundary's to produce, which `channel.ts` asserted in
 * prose while the type put it in the handler's own return union and then
 * demanded an id the handler could not reach. The rule and the type disagreed,
 * and the type was the one being compiled.
 *
 * A channel declaring no failures gives `{ code: never }`, which is uninhabited:
 * its handler can only succeed. That is the mapped type doing the work rather
 * than a comment asking for it.
 */
export interface DeclaredFailure<C extends string> {
  readonly code: C;
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
