// @ts-check
/**
 * `localPdfiumExecution` over BYTES that open with no password, which is what every fixture a proof generates is.
 *
 * The execution takes an `ImageSession`, the bytes and the key that opens them
 * ([ADR-0171](../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md)'s addendum), and a
 * proof about something else would otherwise spell `{ bytes, opensWith: undefined }` at each of its calls and unwrap
 * the result before the next. Named once, so a proof that needs a key calls the execution itself, where it shows.
 */

/** @param {Uint8Array} bytes */
const unlocked = (bytes) => ({ bytes, opensWith: undefined });

/**
 * @param {any} execution `localPdfiumExecution` from the kernel's build
 * @returns {{ apply: (request: any) => Promise<Uint8Array>, capture: (bytes: Uint8Array, command: any) => Promise<any>, invert: (bytes: Uint8Array, kind: any, prior: any) => Promise<Uint8Array> }}
 */
export function withNoPassword(execution) {
  return {
    apply: (request) => execution.apply({ ...request, session: unlocked(request.session) }),
    capture: (bytes, command) => execution.capture(unlocked(bytes), command),
    invert: (bytes, kind, prior) => execution.invert(unlocked(bytes), kind, prior),
  };
}
