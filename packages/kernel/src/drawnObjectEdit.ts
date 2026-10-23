import type { CommandOfKind, DrawnEdit } from '@monstera/contract/host';

import type { CaptureResult } from './commandLog.js';
import { type PageBox, boxOfPoints, inverse, written } from './contentCarry.js';
import type { Invert, MupdfSession } from './engineSeam.js';
import type { PDFObject } from './mupdfRaw.js';
import { withDocument } from './mupdfWriter.js';
import { pageContentStreams } from './pageContent.js';
import { EditRefusedError } from './textEditRefusals.js';
import { type DrawnObject, type Matrix, type XObjectKind, drawnObjects, joinedContent, multiply, showOperators } from './textOperators.js';

/**
 * `editDrawnObject` in the MuPDF session
 * ([ADR-0264](../../../docs/DECISIONS/0264-edit-object-returns-and-an-edit-changes-only-the-bytes-of-the-object-it-names.md)):
 * a picture, a shape or a group edited by changing, moving or removing ITS OWN BYTES in the page's content, every other
 * byte copied as it is. No text on the page is written again and no font is asked anything, which is what refused the
 * owner's brochure when PDFium regenerated the page after every edit (R20).
 *
 * ## Found by kind and ordinal, and checked against the listed box
 *
 * `textOperators.ts` numbers what a page draws as PDFium does (measured, ADR-0240). The command names the object by its
 * kind and its place among that kind, and carries the box PDFium's listing gave; the object found must land on it, or
 * the page is not the one the listing read and the edit is refused at the step `object` rather than applied to
 * something else.
 *
 * ## Read back before it is kept
 *
 * Every edit is checked against the content it was made from before the page's content is replaced: the same text
 * operators showing the same codes, the same drawn objects in the same kinds, and the edited one where the edit put it.
 * A splice that would read back otherwise is a defect here, never a page written.
 *
 * ## The page's streams become ONE stream, ADR-0176's rule
 */

/** How far a listed box may differ from the found one: a stroke's half width with its mitre, rounded up. */
const STROKE_ALLOWANCE = 6;
/** How far an image's listed box may differ from its unit square under its matrix: the listing's own rounding. */
const IMAGE_ALLOWANCE = 0.5;
/** How far a point read back may differ from the one meant: a ten-thousandth of a point, far below a pixel. */
const READ_BACK_TOLERANCE = 1e-4;

/** What each XObject the page's resources name is. */
export function xobjectKinds(leaf: PDFObject): (name: string) => XObjectKind {
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

/** Where a found object is on the page, as far as its instructions say: an image's square, a path's points. */
export function foundBox(found: DrawnObject): PageBox | undefined {
  if (found.kind === 'image') return boxOfPoints(unitSquare(found.ctm));
  if (found.kind === 'path' && found.points.length > 0) return boxOfPoints(found.points);
  return undefined;
}

/** Whether the found object is the listed one: an image exactly, a path within a stroke, a form or shading by its origin. */
function landsOn(found: DrawnObject, box: PageBox): boolean {
  const near = (computed: PageBox, allowance: number): boolean =>
    Math.abs(computed.left - box.left) <= allowance &&
    Math.abs(computed.bottom - box.bottom) <= allowance &&
    Math.abs(computed.right - box.right) <= allowance &&
    Math.abs(computed.top - box.top) <= allowance;
  const computed = foundBox(found);
  if (computed !== undefined) return near(computed, found.kind === 'image' ? IMAGE_ALLOWANCE : STROKE_ALLOWANCE);
  // A FORM'S OR A SHADING'S BOX is PDFium's union of what it draws, which this pass does not enter; its origin under the
  // CTM is in it, or within a stroke of it.
  const [, , , , e, f] = found.ctm;
  return e >= box.left - STROKE_ALLOWANCE && e <= box.right + STROKE_ALLOWANCE && f >= box.bottom - STROKE_ALLOWANCE && f <= box.top + STROKE_ALLOWANCE;
}

/** The placement in PAGE space: a scale on each axis about the listed box's lower-left corner, then the move. */
export function pageMatrix(box: PageBox, edit: Extract<DrawnEdit, { op: 'place' }>): Matrix {
  const { x: sx, y: sy } = edit.scaleBy;
  return [sx, 0, 0, sy, box.left * (1 - sx) + edit.moveBy.x, box.bottom * (1 - sy) + edit.moveBy.y];
}

/** The page-space change expressed in the space an object is drawn in (`CTM × T × CTM⁻¹`), or `null` for a collapsed CTM. */
export function placementIn(ctm: Matrix, page: Matrix): Matrix | null {
  const undo = inverse(ctm);
  return undo === null ? null : multiply(multiply(ctm, page), undo);
}

/**
 * What a placement wraps (ADR-0240's E3 addendum, kept by ADR-0264): the object's own instructions, or, where it is drawn
 * through a clip window that holds NOTHING ELSE, the window with it — the outermost such window, so a picture and the
 * window it shows through move as one. A window that also holds another object or any text stays where it is.
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

/** One splice: the bytes from `start` to `end` replaced by `text`. */
interface Splice {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** The content with its splices made, in the order they sit in the bytes; every other byte as it was. */
export function spliced(content: Uint8Array, splices: readonly Splice[]): Uint8Array {
  const encoder = new TextEncoder();
  const ordered = [...splices].sort((a, b) => a.start - b.start || a.end - b.end);
  const pieces: Uint8Array[] = [];
  let read = 0;
  for (const splice of ordered) {
    if (splice.start < read) throw new Error('two splices of one edit overlap');
    pieces.push(content.subarray(read, splice.start), encoder.encode(splice.text));
    read = splice.end;
  }
  pieces.push(content.subarray(read));
  const out = new Uint8Array(pieces.reduce((total, piece) => total + piece.length, 0));
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return out;
}

/** A segment said again with its points taken through `m`, in the space it is built in: an `re` that `m` shears is four lines. */
function segmentThrough(segment: DrawnObject['segments'][number], m: Matrix): string {
  const [a, b, c, d, e, f] = m;
  const point = (x: number, y: number): string => `${written(x * a + y * c + e)} ${written(x * b + y * d + f)}`;
  const values = segment.values;
  if (segment.op === 're') {
    const [x = 0, y = 0, w = 0, h = 0] = values;
    if (Math.abs(b) < 1e-12 && Math.abs(c) < 1e-12) return `${point(x, y)} ${written(w * a)} ${written(h * d)} re`;
    return `${point(x, y)} m ${point(x + w, y)} l ${point(x + w, y + h)} l ${point(x, y + h)} l h`;
  }
  const pairs: string[] = [];
  for (let at = 0; at + 1 < values.length; at += 2) pairs.push(point(values[at] ?? 0, values[at + 1] ?? 0));
  return [...pairs, segment.op].join(' ');
}

/** Whether two lists of points are the same within the read-back's tolerance. */
function samePoints(a: readonly (readonly [number, number])[], b: readonly (readonly [number, number])[]): boolean {
  return (
    a.length === b.length &&
    a.every(([x, y], at) => Math.abs(x - (b[at]?.[0] ?? Number.NaN)) < READ_BACK_TOLERANCE && Math.abs(y - (b[at]?.[1] ?? Number.NaN)) < READ_BACK_TOLERANCE)
  );
}

/** Points taken through a page-space matrix. */
function through(points: readonly (readonly [number, number])[], m: Matrix): (readonly [number, number])[] {
  return points.map(([x, y]) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]] as const);
}

/** Whether two matrices are the same within the read-back's tolerance. */
function sameMatrix(a: Matrix, b: Matrix): boolean {
  return a.every((value, at) => Math.abs(value - (b[at] ?? Number.NaN)) < READ_BACK_TOLERANCE);
}

/** Why an edit is refused at a step a person is told about (ADR-0264 Decision 4); the engine number is none, MuPDF has none. */
function refused(step: 'object' | 'read-back', what: string): EditRefusedError {
  return new EditRefusedError(step, 0, what);
}

/** What an edit of a drawn object makes of the page's content. */
export interface DrawnEditResult {
  readonly content: Uint8Array;
}

/** A place: the wrap, or a clipping shape's own coordinates rewritten in place, read back as one object moved. */
function place(
  content: Uint8Array,
  kinds: (name: string) => XObjectKind,
  drawn: readonly DrawnObject[],
  found: DrawnObject,
  command: CommandOfKind<'editDrawnObject'>,
  edit: Extract<DrawnEdit, { op: 'place' }>,
): Uint8Array {
  const page = pageMatrix(command.box, edit);
  const own = placementIn(found.ctm, page);
  if (own === null) throw refused('object', `${command.object} ${String(command.ordinal)} is drawn under a matrix with no inverse`);
  let edited: Uint8Array;
  let window: number | undefined;
  if (found.clips) {
    // A SHAPE THAT ALSO SETS THE CLIP is not wrapped: `Q` would end the clip early for everything after it. Its own
    // coordinates are rewritten in place, so the shape and the clip it sets move together (Decision 3).
    edited = spliced(
      content,
      found.segments.map((segment) => ({ start: segment.start, end: segment.end, text: segmentThrough(segment, own) })),
    );
    window = undefined;
  } else {
    const span = placedSpan(content, drawn, found);
    const matrix = placementIn(span.ctm, page);
    if (matrix === null) throw refused('object', `${command.object} ${String(command.ordinal)} is drawn under a matrix with no inverse`);
    edited = spliced(content, [
      { start: span.start, end: span.start, text: `q ${matrix.map(written).join(' ')} cm\n` },
      { start: span.end, end: span.end, text: '\nQ' },
    ]);
    window = span.window;
  }

  // READ BACK: the same objects of every kind and the same text, this one where the placement put it, and the windows it
  // was carried with placed as it was.
  const after = drawnObjects(edited, kinds);
  const moved = after.filter((object) => object.kind === command.object)[command.ordinal];
  const placedWell =
    moved !== undefined &&
    (found.kind === 'path'
      ? samePoints(moved.points, through(found.points, page))
      : sameMatrix(moved.ctm, multiply(found.ctm, page)));
  const windowsPlaced =
    moved?.windows.length === found.windows.length &&
    found.windows.every((each, at) => {
      const carried = window !== undefined && at >= window;
      return samePoints(moved.windows[at]?.points ?? [], carried ? through(each.points, page) : each.points);
    });
  if (!placedWell || !windowsPlaced || !sameObjects(drawn, after) || !sameText(content, edited)) {
    throw refused('read-back', `placing ${command.object} ${String(command.ordinal)} did not read back as one object placed`);
  }
  return edited;
}

/** The same drawn objects in the same kinds, in order. */
function sameObjects(before: readonly DrawnObject[], after: readonly DrawnObject[]): boolean {
  return after.length === before.length && after.every((object, at) => object.kind === before[at]?.kind);
}

/** The same text operators showing the same codes, in order: nothing an object edit does may touch a word. */
function sameText(before: Uint8Array, after: Uint8Array): boolean {
  const was = showOperators(before);
  const now = showOperators(after);
  return (
    was.length === now.length &&
    was.every((op, at) => {
      const other = now[at];
      return other?.object === op.object && other.codes.length === op.codes.length && other.codes.every((code, k) => code === op.codes[k]);
    })
  );
}

/** The edit of `command` made to `content`, read back; the page's other bytes as they were. */
export function editDrawnContent(
  content: Uint8Array,
  kinds: (name: string) => XObjectKind,
  command: CommandOfKind<'editDrawnObject'>,
): DrawnEditResult {
  const drawn = drawnObjects(content, kinds);
  const found = drawn.filter((object) => object.kind === command.object)[command.ordinal];
  if (found === undefined || !landsOn(found, command.box)) {
    throw refused('object', `page ${String(command.page)} holds no ${command.object} ${String(command.ordinal)} where the listing put it`);
  }
  return { content: place(content, kinds, drawn, found, command, command.edit) };
}

export async function applyEditDrawnObject(session: MupdfSession, command: CommandOfKind<'editDrawnObject'>): Promise<void> {
  await withDocument(session, (document) => {
    const leaf = document.findPage(command.page);
    const content = joinedContent(pageContentStreams(leaf));
    const result = editDrawnContent(content, xobjectKinds(leaf), command);
    leaf.put('Contents', document.addStream(result.content, document.newDictionary()));
  });
}

/** The checkpoint IS the undo, `editTextOperators`' rule (ADR-0264 Decision 6). */
export function captureEditDrawnObject(): Promise<CaptureResult<never>> {
  return Promise.resolve({
    captured: false,
    reason: 'a drawn object edited in its content stream is undone by its checkpoint (ADR-0264 Decision 6)',
  } as const);
}

/** Unreachable: a command that never captures has no inverse to apply. */
export const invertEditDrawnObject: Invert<'mupdf', 'editDrawnObject'> = (): Promise<void> => {
  throw new Error('a drawn object edited in its content stream has no inverse; undo restores the checkpoint (ADR-0264)');
};
