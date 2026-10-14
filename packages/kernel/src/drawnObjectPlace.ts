import type { CommandOfKind } from '@monstera/contract/host';

import type { CaptureResult } from './commandLog.js';
import type { Invert, MupdfSession } from './engineSeam.js';
import type { PDFObject } from './mupdfRaw.js';
import { withDocument } from './mupdfWriter.js';
import { placementMatrix } from './objectPlacementMatrix.js';
import { pageContentStreams } from './pageContent.js';
import { type DrawnObject, type Matrix, type XObjectKind, drawnObjects, joinedContent, multiply, showOperators } from './textOperators.js';

/**
 * `placeDrawnObject` in the MuPDF session ([ADR-0240](../../../docs/DECISIONS/0240-an-objects-placement-is-edited-where-it-is-drawn.md)):
 * a picture, a form or a shape moved and resized by wrapping its OWN instructions in `q M cm … Q`, every other byte of
 * the page's content copied as it is, so no text on the page is written again and no font can refuse the move (the
 * owner's E1, where PDFium's regeneration lost 17 of 85 Type 3 text objects on a printed page).
 *
 * ## Found by kind and ordinal, and checked against the listed box
 *
 * `textOperators.ts` numbers what a page draws as PDFium does (measured, ADR-0240). The command names the object by its
 * kind and its place among that kind, and carries the box PDFium's listing gave; the object found must land on it, or
 * the page is not the one the listing read and the command is refused rather than applied to something else.
 *
 * ## The page's streams become ONE stream, ADR-0176's rule
 */

/** Why a drawn object was not moved: said in words by the renderer, never a reference number (ADR-0240 Decision 4). */
export class DrawnObjectRefusedError extends Error {
  override readonly name = 'DrawnObjectRefusedError';
  constructor(
    readonly reason: 'not-found' | 'clips',
    detail: string,
  ) {
    super(detail);
  }
}

/** How far a listed box may differ from the found one: a stroke's half width with its mitre, rounded up. */
const STROKE_ALLOWANCE = 6;
/** How far an image's listed box may differ from its unit square under its matrix: the listing's own rounding. */
const IMAGE_ALLOWANCE = 0.5;
/** How far the matrix read back may differ from the one meant: a ten-thousandth of a point, far below a pixel. */
const READ_BACK_TOLERANCE = 1e-4;

/** What each XObject the page's resources name is. */
function xobjectKinds(leaf: PDFObject): (name: string) => XObjectKind {
  let resources = leaf.getInheritable('Resources');
  if (!resources.isNull()) resources = resources.resolve();
  const xobjects = resources.isDictionary() ? resources.get('XObject').resolve() : resources;
  return (name) => {
    if (!xobjects.isDictionary()) return undefined;
    const subtype = xobjects.get(name).resolve().get('Subtype');
    if (!subtype.isName()) return undefined;
    return subtype.asName() === 'Image' ? 'image' : subtype.asName() === 'Form' ? 'form' : undefined;
  };
}

/** A box of points. */
function boxOf(points: readonly (readonly [number, number])[]): { left: number; bottom: number; right: number; top: number } {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { left: Math.min(...xs), bottom: Math.min(...ys), right: Math.max(...xs), top: Math.max(...ys) };
}

/** The unit square under a matrix, which is where an image is drawn. */
function unitSquare(ctm: Matrix): readonly (readonly [number, number])[] {
  const [a, b, c, d, e, f] = ctm;
  return [
    [e, f],
    [a + e, b + f],
    [c + e, d + f],
    [a + c + e, b + d + f],
  ];
}

/** Whether the found object is the listed one: an image exactly, a path within a stroke, a form by its centre. */
function landsOn(found: DrawnObject, box: CommandOfKind<'placeDrawnObject'>['box']): boolean {
  const near = (computed: ReturnType<typeof boxOf>, allowance: number): boolean =>
    Math.abs(computed.left - box.left) <= allowance &&
    Math.abs(computed.bottom - box.bottom) <= allowance &&
    Math.abs(computed.right - box.right) <= allowance &&
    Math.abs(computed.top - box.top) <= allowance;
  if (found.kind === 'image') return near(boxOf(unitSquare(found.ctm)), IMAGE_ALLOWANCE);
  if (found.kind === 'path') return found.points.length > 0 && near(boxOf(found.points), STROKE_ALLOWANCE);
  // A FORM'S BOX is PDFium's union of what it draws, which this pass does not enter; its origin under the CTM is in it.
  const [, , , , e, f] = found.ctm;
  return e >= box.left - STROKE_ALLOWANCE && e <= box.right + STROKE_ALLOWANCE && f >= box.bottom - STROKE_ALLOWANCE && f <= box.top + STROKE_ALLOWANCE;
}

/** A matrix's inverse, or `null` for one that collapses the page (it cannot have drawn anything a person picked). */
function inverse([a, b, c, d, e, f]: Matrix): Matrix | null {
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/**
 * A number as a content stream writes one: no exponent, no trailing zeros, and TEN decimals, because the matrix is in
 * the object's own space and an image's is scaled by its size: six decimals under a 120-point photo moved it by 6e-5 pt.
 */
function written(value: number): string {
  const fixed = value.toFixed(10).replace(/\.?0+$/u, '');
  return fixed === '-0' ? '0' : fixed;
}

/**
 * The page-space change, `placeObject`'s: a scale about the listed box's bottom-left corner, then the move. Expressed in
 * the space the object is drawn in (`CTM × T × CTM⁻¹`), so `M cm` before its instructions moves it on the page by `T`.
 */
export function placementIn(ctm: Matrix, command: Pick<CommandOfKind<'placeDrawnObject'>, 'box' | 'moveBy' | 'scaleBy' | 'rotateBy'>): Matrix | null {
  const undo = inverse(ctm);
  return undo === null ? null : multiply(multiply(ctm, pageMatrix(command)), undo);
}

/** The placement in PAGE space: the one matrix both engines apply (ADR-0243), about the listed box. */
function pageMatrix(command: Pick<CommandOfKind<'placeDrawnObject'>, 'box' | 'moveBy' | 'scaleBy' | 'rotateBy'>): Matrix {
  return placementMatrix(command);
}

/**
 * What a placement wraps (E3): the object's own instructions, or, where it is drawn through a clip window that holds
 * NOTHING ELSE, the window with it — the outermost such window, so a picture and the window it shows through move as one.
 *
 * A window that also holds another object or any text stays where it is: wrapping it would move what else it holds. The
 * span from a window's path to the `Q` that ends it is balanced in `q` and `Q` by construction, since the clip was set at
 * that depth and the `Q` is the one that leaves it.
 */
export function placedSpan(
  content: Uint8Array,
  drawn: readonly DrawnObject[],
  found: DrawnObject,
): { readonly start: number; readonly end: number; readonly ctm: Matrix; readonly window: number | undefined } {
  const shows = showOperators(content);
  const window = found.windows.findIndex(
    (candidate) =>
      drawn.every((other) => other === found || other.start < candidate.start || other.start >= candidate.end) &&
      shows.every((show) => show.start < candidate.start || show.start >= candidate.end),
  );
  const chosen = found.windows[window];
  return chosen === undefined
    ? { start: found.start, end: found.end, ctm: found.ctm, window: undefined }
    : { start: chosen.start, end: chosen.end, ctm: chosen.ctm, window };
}

/** The content with one span of instructions wrapped in `q M cm … Q`. */
export function wrappedContent(content: Uint8Array, found: { readonly start: number; readonly end: number }, matrix: Matrix): Uint8Array {
  const before = new TextEncoder().encode(`q ${matrix.map(written).join(' ')} cm\n`);
  const after = new TextEncoder().encode('\nQ');
  const out = new Uint8Array(content.length + before.length + after.length);
  out.set(content.subarray(0, found.start), 0);
  out.set(before, found.start);
  out.set(content.subarray(found.start, found.end), found.start + before.length);
  out.set(after, found.end + before.length);
  out.set(content.subarray(found.end), found.end + before.length + after.length);
  return out;
}

export async function applyPlaceDrawnObject(session: MupdfSession, command: CommandOfKind<'placeDrawnObject'>): Promise<void> {
  await withDocument(session, (document) => {
    const leaf = document.findPage(command.page);
    const content = joinedContent(pageContentStreams(leaf));
    const kinds = xobjectKinds(leaf);
    const drawn = drawnObjects(content, kinds);
    const found = drawn.filter((object) => object.kind === command.object)[command.ordinal];
    if (found === undefined || !landsOn(found, command.box)) {
      throw new DrawnObjectRefusedError(
        'not-found',
        `page ${String(command.page)} holds no ${command.object} ${String(command.ordinal)} where the listing put it`,
      );
    }
    // A PATH THAT SETS THE CLIP is not wrapped: `Q` would end the clip early for everything drawn after it (Decision 3).
    if (found.clips) throw new DrawnObjectRefusedError('clips', `${command.object} ${String(command.ordinal)} also sets the clip`);
    const span = placedSpan(content, drawn, found);
    const matrix = placementIn(span.ctm, command);
    const own = placementIn(found.ctm, command);
    if (matrix === null || own === null) {
      throw new DrawnObjectRefusedError('not-found', `${command.object} ${String(command.ordinal)} is drawn under a matrix with no inverse`);
    }
    const edited = wrappedContent(content, span, matrix);

    // READ BACK BEFORE IT IS KEPT: the same objects of every kind and the same text, this one under the new matrix, and
    // the windows it was carried with placed as it was — wherever the wrap went, the object lands under ctm·P.
    const after = drawnObjects(edited, kinds);
    const moved = after.filter((object) => object.kind === command.object)[command.ordinal];
    const expected = multiply(own, found.ctm);
    const page = pageMatrix(command);
    const near = (a: readonly (readonly [number, number])[], b: readonly (readonly [number, number])[]): boolean =>
      a.length === b.length && a.every(([x, y], at) => Math.abs(x - (b[at]?.[0] ?? Number.NaN)) < READ_BACK_TOLERANCE && Math.abs(y - (b[at]?.[1] ?? Number.NaN)) < READ_BACK_TOLERANCE);
    const windowsPlaced =
      moved?.windows.length === found.windows.length &&
      found.windows.every((window, at) => {
        const carried = span.window !== undefined && at >= span.window;
        const points = carried ? window.points.map(([x, y]) => [x * page[0] + y * page[2] + page[4], x * page[1] + y * page[3] + page[5]] as const) : window.points;
        return near(moved.windows[at]?.points ?? [], points);
      });
    const same =
      after.length === drawn.length &&
      after.every((object, at) => object.kind === drawn[at]?.kind) &&
      moved !== undefined &&
      moved.ctm.every((value, at) => Math.abs(value - (expected[at] ?? 0)) < READ_BACK_TOLERANCE) &&
      windowsPlaced &&
      showOperators(edited).length === showOperators(content).length;
    if (!same) throw new Error(`placing ${command.object} ${String(command.ordinal)} did not read back as one object moved`);
    const stream = document.addStream(edited, document.newDictionary());
    leaf.put('Contents', stream);
  });
}

/** The checkpoint IS the undo, `editTextOperators`' rule (ADR-0240 Decision 5). */
export function capturePlaceDrawnObject(): Promise<CaptureResult<never>> {
  return Promise.resolve({
    captured: false,
    reason: 'a drawn object placed in its content stream is undone by its checkpoint (ADR-0240 Decision 5)',
  } as const);
}

/** Unreachable: a command that never captures has no inverse to apply. */
export const invertPlaceDrawnObject: Invert<'mupdf', 'placeDrawnObject'> = (): Promise<void> => {
  throw new Error('a drawn object placed in its content stream has no inverse; undo restores the checkpoint (ADR-0240)');
};
