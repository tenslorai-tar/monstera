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
export type Result<T, E = StructuredError> =
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
  readonly stack?: string;
  readonly cause?: StructuredError;
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
