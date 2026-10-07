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
 * ## Typed fields: a code's DETAIL
 *
 * A code needing a field gets one when a caller needs it, and two now do
 * ([ADR-0169](../../../docs/DECISIONS/0169-a-pdfium-rewrite-is-saved-only-when-it-reads-back-as-edited.md)
 * Decision 4): {@link FailureDetails} declares it once per code, for every
 * boundary the code crosses. What the type forbids is still free text. A detail
 * is an enum member, a bounded number, or characters the person typed, and never
 * text a native library produced.
 */

/** The step of a PDFium rewrite that refused, from ADR-0169 Decision 3's fixed set. */
export const EDIT_STEPS = ['open', 'page', 'object', 'set-text', 'matrix', 'generate', 'save', 'read-back'] as const;
export type EditStep = (typeof EDIT_STEPS)[number];

/** Why a change to a form field was refused (ADR-0193): each the person's to act on, and none a defect. */
export const FIELD_EDIT_REASONS = [
  'not-found',
  'name-taken',
  'name-parent',
  'options-count',
  'options-duplicate',
  'options-radio-labels',
  'duplicate-radio',
  'duplicate-signature',
  'encrypted',
] as const;
export type FieldEditReason = (typeof FIELD_EDIT_REASONS)[number];

/**
 * The number `FPDF_GetLastError` answers when a document needs a password: `FPDF_ERR_PASSWORD`, read from PDFium
 * 155.0.8044.0's `fpdfview.h` (line 609, `.tools/pdfium/155.0.8044.0/include`) on 2026-10-05. At step `open` it means
 * the document is protected, which the person is told as such (ADR-0169 Decision 7).
 */
export const PDFIUM_PASSWORD_ERROR = 4;

/**
 * The codes that carry a detail, and the detail each carries.
 *
 * The TYPE is here and the schema is `@monstera/contract`'s `FAILURE_DETAIL_SCHEMAS`, which is checked against this
 * in both directions, so the two cannot differ. A code absent from this table carries nothing beside it.
 */
export interface FailureDetails {
  /** The distinct characters, in the order typed, that the font the edit was written in cannot show. */
  readonly 'text-not-writable': { readonly characters: string };
  /** Which step of a PDFium rewrite refused, and what `FPDF_GetLastError` answered at that moment. */
  readonly 'edit-refused': { readonly step: EditStep; readonly engineError: number };
  /** Which refusal a change to a form field met (ADR-0193). */
  readonly 'field-edit-refused': { readonly reason: FieldEditReason };
}

/** The codes of `C` that carry no detail, as one member — or nothing, when every code of `C` carries one. */
type PlainFailure<C extends string> = [Exclude<C, keyof FailureDetails>] extends [never]
  ? never
  : { readonly code: Exclude<C, keyof FailureDetails> };

/** One member per code of `C` that carries a detail, the detail required. */
type DetailedFailure<C extends string> = {
  readonly [K in Extract<C, keyof FailureDetails>]: { readonly code: K; readonly detail: FailureDetails[K] };
}[Extract<C, keyof FailureDetails>];

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
 * A declared failure hides nothing — the code, with the detail its code declares
 * where it declares one ({@link FailureDetails}), is the whole of what happened —
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
  //
  // A code with a declared detail is its own member carrying it (ADR-0169), so narrowing on that code reaches the
  // detail and a failure of it without one does not type.
  | PlainFailure<Exclude<C, InternalFailure>>
  | DetailedFailure<Exclude<C, InternalFailure>>
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
 * A channel declaring no failures gives `never`: its handler can only succeed.
 * That is the mapped type doing the work rather than a comment asking for it.
 *
 * A code with a declared detail must carry it, and a code without one must not
 * (ADR-0169): a handler cannot forget the characters a refusal names, and cannot
 * attach a field nothing declared.
 */
export type DeclaredFailure<C extends string> = PlainFailure<C> | DetailedFailure<C>;

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
