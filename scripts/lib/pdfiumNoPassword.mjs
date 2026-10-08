// @ts-check
/**
 * `localPdfiumExecution` over BYTES that open with no password, which is what every fixture a proof generates is.
 *
 * The execution takes an `ImageSession`, the bytes and the key that opens them
 * ([ADR-0171](../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md)'s addendum), and a
 * proof about something else would otherwise spell `{ bytes, opensWith: undefined }` at each of its calls and unwrap
 * the result before the next. Named once, so a proof that needs a key calls the execution itself, where it shows.
 *
 * ## `apply` and `invert` answer the IMAGE, and `applyDrawing` the whole answer
 *
 * A PDFium apply answers the new image and the characters it drew as boxes
 * ([ADR-0174](../../docs/DECISIONS/0174-a-pdfium-apply-answers-the-characters-it-drew-as-boxes.md)). A proof whose
 * subject is the document reads the image, which is what these two unwrap to; one whose subject is the boxes takes
 * `applyDrawing`, so the list is never unwrapped away where it is the thing asserted.
 */

/** @param {Uint8Array} bytes */
const unlocked = (bytes) => ({ bytes, opensWith: undefined });

/**
 * @param {any} execution `localPdfiumExecution` from the kernel's build
 * @returns {{
 *   apply: (request: any) => Promise<Uint8Array>,
 *   applyDrawing: (request: any) => Promise<{ image: Uint8Array, boxed: readonly { character: string, page: number }[], more: number }>,
 *   capture: (bytes: Uint8Array, command: any) => Promise<any>,
 *   invert: (bytes: Uint8Array, kind: any, prior: any) => Promise<Uint8Array>,
 * }}
 */
export function withNoPassword(execution) {
  /** @param {any} request */
  const applyDrawing = (request) => execution.apply({ ...request, session: unlocked(request.session) });
  return {
    apply: async (request) => (await applyDrawing(request)).image,
    applyDrawing,
    capture: (bytes, command) => execution.capture(unlocked(bytes), command),
    invert: async (bytes, kind, prior) => (await execution.invert(unlocked(bytes), kind, prior)).image,
  };
}
