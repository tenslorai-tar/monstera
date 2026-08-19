import type * as mupdf from 'mupdf';

import { type CommandOfKind } from '@monstera/contract';

import { type CaptureResult } from './commandLog.js';
import { type Apply, type Invert, type MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';

/**
 * The first command, and the one ADR-0009 §3 was derived from.
 *
 * ## Two functions, because the bus captures and the handler applies
 *
 * The 2026-08-19 decision on ADR-0009: prior state for an inverse is captured
 * by the `CommandBus`, in a step of its own, before `apply` — never inside a
 * handler. So {@link captureRotatePages} and {@link applyRotatePages} are
 * separate exports rather than one function returning both.
 *
 * The bus does not exist yet. What matters before it does is that `apply`
 * **does not consume what the inverse will need**: the prior `/Rotate`
 * own-state is readable by a caller, and reading it is not entangled with
 * mutating.
 *
 * ## Own-state, not effective state — and the two are different objects
 *
 * §3's finding: the inverse of rotating a page that **inherited** its rotation
 * is `delete('Rotate')`, not writing back the value that was showing. Both
 * render identically; only `delete` restores the same document, because a
 * write-back leaves the leaf declaring what it used to inherit and it silently
 * stops tracking its branch.
 *
 * MuPDF gives both readings and they are separate calls, verified by running
 * them rather than by reading the declarations: on a leaf that inherits
 * `/Rotate 90` from its `/Pages` node, `get('Rotate')` reports `null` and
 * `getInheritable('Rotate')` reports `90`. Capture uses the first. The forward
 * rotation uses the second, because the user is rotating what they can see.
 */

/**
 * A page's own `/Rotate` before the command ran (ADR-0009 §3).
 *
 * Absence is a value here, not a missing one. `{ present: false }` is what
 * makes the inverse a `delete` rather than a write-back — the distinction the
 * whole log design turns on.
 */
export type PriorRotation =
  | { readonly present: false }
  | { readonly present: true; readonly raw: number };

/** One page's prior own-state, in the order the command named its pages. */
export interface PriorPageRotation {
  readonly page: number;
  readonly prior: PriorRotation;
}

/**
 * The rotation the engine actually applies for a raw `/Rotate` value.
 *
 * A **port of MuPDF's own snap**, not a tidier rule of our own, and that
 * distinction is the whole point: the forward command rotates by quarter turns
 * from *what the user sees*, and what the user sees is whatever the renderer
 * decided. A separate normalisation would make the page jump on the first
 * rotate of any document carrying a non-quarter-turn value.
 *
 * From `pdf_page_transform_box`, MuPDF 1.28.0 `source/pdf/pdf-page.c`:
 *
 * ```c
 * if (rotate < 0)    rotate = 360 - ((-rotate) % 360);
 * if (rotate >= 360) rotate = rotate % 360;
 * rotate = 90*((rotate + 45)/90);
 * if (rotate >= 360) rotate = 0;
 * ```
 *
 * Two details survive the port deliberately. The `+45` rounds a half-way value
 * **up**, so `45` snaps to `90` and not to `0` — measured against the engine,
 * where the page bounds swap. And the trailing `>= 360` guard exists because
 * the rounding can overshoot: a raw `340` reaches `360`, which is `0`.
 *
 * `Math.trunc` stands in for `pdf_dict_get_inheritable_int`, which reads the
 * object as an integer; a real-valued `/Rotate` is truncated toward zero before
 * any of this runs.
 */
export function snapRotation(raw: number): number {
  let rotate = Math.trunc(raw);
  if (rotate < 0) rotate = 360 - ((-rotate) % 360);
  if (rotate >= 360) rotate = rotate % 360;
  rotate = 90 * Math.floor((rotate + 45) / 90);
  if (rotate >= 360) rotate = 0;
  return rotate;
}

/** The page dictionary for a validated index, or a named refusal. */
function pageObject(
  document: mupdf.PDFDocument,
  page: number,
  total: number,
): mupdf.PDFObject {
  if (!Number.isInteger(page) || page < 0 || page >= total) {
    throw new RangeError(
      `Page ${String(page)} is outside this document, which has ${String(total)} page(s). ` +
        'Page indices are zero-based.',
    );
  }
  return document.loadPage(page).getObject();
}

/**
 * Reads each named page's prior `/Rotate` **own-state**, before anything is
 * mutated.
 *
 * Called by the bus, not by {@link applyRotatePages}. Every page is read before
 * any is written, so a failure part-way through the command leaves no page
 * captured-but-not-applied — and the whole set is validated first, so an
 * out-of-range index refuses the command rather than half-rotating it.
 *
 * ## Two failures, and only one of them is the log's business
 *
 * **A non-numeric `/Rotate` returns `{ captured: false }`, and does not throw.**
 * The specification says `/Rotate` is an integer; a name or a string there is a
 * malformed document, and one that every other reader opens. §3 types prior
 * state `raw: number`, so there is no honest capture — but ADR-0009's
 * 2026-08-19 decision is that invertibility is *declared per command and
 * determined per entry*, so this is an ordinary outcome the bus answers with a
 * checkpoint, not a reason to refuse the user their rotation.
 *
 * Two wrong answers were rejected, and both render correctly. Coercing records
 * an inverse that is well-formed and wrong. Treating malformed as **absent** is
 * worse: undo would then `delete` a key that was *present*.
 *
 * **An invalid command still throws.** An out-of-range page index or a forged
 * session is the caller getting it wrong, not a document to route around, and
 * converting those into checkpoints would hide a bug behind a byte snapshot.
 */
export function captureRotatePages(
  session: MupdfSession,
  command: CommandOfKind<'rotatePages'>,
): Promise<CaptureResult<readonly PriorPageRotation[]>> {
  return withDocument(session, (document) => {
    const total = document.countPages();
    const objects = command.pages.map((page) => ({
      page,
      own: pageObject(document, page, total).get('Rotate'),
    }));

    const malformed = objects.find(({ own }) => !own.isNull() && !own.isNumber());
    if (malformed !== undefined) {
      return {
        captured: false,
        reason:
          `page ${String(malformed.page)} carries a non-numeric /Rotate ` +
          `(${malformed.own.toString()}), which cannot be recorded as prior state`,
      };
    }

    return {
      captured: true,
      prior: objects.map(({ page, own }) =>
        own.isNull()
          ? { page, prior: { present: false } }
          : { page, prior: { present: true, raw: own.asNumber() } },
      ),
    };
  });
}

/**
 * Rotates each named page by the command's quarter turns.
 *
 * Mutates the live session in place and returns nothing — `Apply` for a
 * live-session writer is `=> Promise<void>` (§8). Returning the inverse from
 * here was the rejected alternative in the ADR: it would change that signature
 * one commit after it landed.
 *
 * The base is the **inheritable** value, snapped the way the engine snaps it,
 * so one quarter turn moves the page one quarter turn from what was on screen.
 * The result is written to the leaf, which is correct — the page now has a
 * rotation of its own — and is exactly why the inverse has to be able to delete
 * the key rather than write a value back.
 *
 * Validated in full before the first write, so a bad index cannot leave a
 * partly rotated document behind.
 */
/**
 * Restores each page's prior `/Rotate` **own-state**, verbatim (ADR-0009 §3).
 *
 * ## The two branches are the whole finding
 *
 * - `{ present: false }` → **`delete('Rotate')`**. The page inherited before the
 *   command and must inherit after it. Writing back the value that was showing
 *   renders identically and leaves the leaf *declaring* what it used to inherit,
 *   so it silently stops tracking its branch — spike R3, and the reason a test
 *   comparing rendered output passes on the wrong implementation.
 * - `{ present: true, raw }` → **`put('Rotate', raw)`**, unnormalised. MuPDF
 *   keeps `45`, `450` and `-90` through a round trip and documents in the wild
 *   carry them, so restoring a tidied quarter turn would silently rewrite the
 *   document — R3's defect wearing different clothes.
 *
 * **Forward normalises; the inverse restores verbatim.** The asymmetry is
 * deliberate and is §3's point.
 *
 * The command is not passed here, and {@link Invert} explains why: an inverse
 * computed from intent — rotate back by the same quarter turns — cannot reach
 * either branch.
 */
export const invertRotatePages: Invert<'mupdf', 'rotatePages'> = (
  session: MupdfSession,
  inverse: readonly PriorPageRotation[],
): Promise<void> =>
  withDocument(session, (document) => {
    const total = document.countPages();
    // Validated in full before the first write, for the same reason as apply: a
    // half-restored document is worse than a refused undo.
    const restorations = inverse.map((entry) => ({
      object: pageObject(document, entry.page, total),
      prior: entry.prior,
    }));
    for (const { object, prior } of restorations) {
      if (prior.present) object.put('Rotate', prior.raw);
      else object.delete('Rotate');
    }
  });

export const applyRotatePages: Apply<'mupdf', 'rotatePages'> = (
  session: MupdfSession,
  command: CommandOfKind<'rotatePages'>,
): Promise<void> =>
  withDocument(session, (document) => {
    const total = document.countPages();
    const objects = command.pages.map((page) => pageObject(document, page, total));
    const turn = command.quarterTurns * 90;
    for (const object of objects) {
      const inherited = object.getInheritable('Rotate');
      const base = inherited.isNumber() ? snapRotation(inherited.asNumber()) : 0;
      object.put('Rotate', (base + turn) % 360);
    }
  });
