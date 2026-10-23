import type { ArrangeNeighbour, CommandOfKind, DrawnEdit } from '@monstera/contract/host';

import type { CaptureResult } from './commandLog.js';
import { PLAIN_STATE, type PageBox, boxOfPoints, carried, inverse, written } from './contentCarry.js';
import type { Invert, MupdfSession } from './engineSeam.js';
import type { PDFObject } from './mupdfRaw.js';
import { withDocument } from './mupdfWriter.js';
import { pageContentStreams } from './pageContent.js';
import { EditRefusedError } from './textEditRefusals.js';
import {
  type ContentLayout,
  type DrawnObject,
  type Matrix,
  type XObjectKind,
  contentLayout,
  drawnObjects,
  joinedContent,
  multiply,
  showOperators,
} from './textOperators.js';

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
function refused(step: 'object' | 'read-back' | 'cropped', what: string): EditRefusedError {
  return new EditRefusedError(step, 0, what);
}

/** What an edit of a drawn object makes of the page's content. */
export interface DrawnEditResult {
  readonly content: Uint8Array;
  /** Whether the content names the plain graphics state, which the page's resources must then hold (an arrange's). */
  readonly plain?: boolean;
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

/** The painting operators that fill, and those that stroke (`B`, `B*`, `b`, `b*` do both). */
const FILLS = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);
const STROKES = new Set(['S', 's', 'B', 'B*', 'b', 'b*']);

/**
 * A recolour: the path drawn inside `q <colour> … Q`, the colour set for the channels its paint uses. A shape that also
 * sets the clip is drawn twice: painted in its colour inside the `q … Q` without the clip, then said again as `W n`, so
 * the clip it sets for what follows is the one it set before (Decision 3).
 */
function recolor(
  content: Uint8Array,
  kinds: (name: string) => XObjectKind,
  drawn: readonly DrawnObject[],
  found: DrawnObject,
  command: CommandOfKind<'editDrawnObject'>,
  edit: Extract<DrawnEdit, { op: 'recolor' }>,
): Uint8Array {
  const paint = found.paint;
  if (found.kind !== 'path' || paint === undefined) throw refused('object', `${command.object} ${String(command.ordinal)} is not a shape`);
  const values = [edit.colour.r, edit.colour.g, edit.colour.b].map((channel) => written(channel / 255)).join(' ');
  const colour = [...(FILLS.has(paint.op) ? [`${values} rg`] : []), ...(STROKES.has(paint.op) ? [`${values} RG`] : [])].join(' ');
  const latin1 = new TextDecoder('latin1');
  const clip = found.clip;
  const edited =
    clip === undefined
      ? spliced(content, [
          { start: found.start, end: found.start, text: `q ${colour}\n` },
          { start: found.end, end: found.end, text: '\nQ' },
        ])
      : spliced(content, [
          {
            start: found.start,
            end: found.end,
            text: (() => {
              const path = latin1.decode(content.subarray(found.start, clip.start)).trimEnd();
              return `q ${colour}\n${path} ${paint.op}\nQ\n${path} ${clip.op} n`;
            })(),
          },
        ]);

  // READ BACK: the same objects and text, the shape's points where they were, and its clip the clip it set before.
  const after = drawnObjects(edited, kinds);
  const shape = after.filter((object) => object.kind === 'path')[command.ordinal];
  /** The clip every object is drawn through, by its windows' points: what a recolour must leave as it was. */
  const windowsOf = (objects: readonly DrawnObject[]): readonly (readonly (readonly [number, number])[])[] =>
    objects.flatMap((object) => object.windows.map((window) => window.points));
  if (
    shape === undefined ||
    !samePoints(shape.points, found.points) ||
    !sameObjects(drawn, after) ||
    !sameText(content, edited) ||
    JSON.stringify(windowsOf(after)) !== JSON.stringify(windowsOf(drawn))
  ) {
    throw refused('read-back', `recolouring path ${String(command.ordinal)} did not read back as one shape recoloured`);
  }
  return edited;
}

/**
 * A removal: the object's instructions go, one space left so the tokens either side cannot run together. A shape that
 * also sets the clip keeps its path and loses only its paint, which becomes `n`, so what follows is clipped as before.
 */
function remove(
  content: Uint8Array,
  kinds: (name: string) => XObjectKind,
  drawn: readonly DrawnObject[],
  found: DrawnObject,
  command: CommandOfKind<'editDrawnObject'>,
): Uint8Array {
  const paint = found.paint;
  const edited =
    found.clips && paint !== undefined
      ? spliced(content, [{ start: paint.start, end: paint.end, text: 'n' }])
      : spliced(content, [{ start: found.start, end: found.end, text: ' ' }]);

  // READ BACK: every other object in its kind and order, the text as it was, and every clip as it was.
  const after = drawnObjects(edited, kinds);
  const others = drawn.filter((object) => object !== found);
  const windowsOf = (objects: readonly DrawnObject[]): string => JSON.stringify(objects.map((object) => object.windows.map((window) => window.points)));
  if (!sameObjects(others, after) || !sameText(content, edited) || windowsOf(after) !== windowsOf(others)) {
    throw refused('read-back', `removing ${command.object} ${String(command.ordinal)} did not read back as one object removed`);
  }
  return edited;
}

/** Where the object an arrange goes past is drawn: its instructions, or its text object's `BT … ET`. */
function neighbourSpan(layout: ContentLayout, past: ArrangeNeighbour): { readonly start: number; readonly end: number } | undefined {
  if (past.kind === 'text') {
    const op = layout.operators.find((each) => each.object === past.object);
    const end = op === undefined ? undefined : layout.textObjects.get(op.textObject);
    return op === undefined || end === undefined ? undefined : { start: op.textObject, end };
  }
  return layout.drawn.filter((object) => object.kind === past.kind)[past.ordinal];
}

/** Where a drawn object reads back on the page: its points for a path, its CTM for everything else. */
function geometryOf(object: DrawnObject): string {
  const round = (value: number): number => Math.round(value / READ_BACK_TOLERANCE) * READ_BACK_TOLERANCE;
  return JSON.stringify(object.kind === 'path' ? object.points.map(([x, y]) => [round(x), round(y)]) : object.ctm.map(round));
}

/**
 * An arrange: the object's UNIT lifted out and put just after the neighbour's unit (forward) or just before it
 * (backward), inside a `q … Q` that carries the state it was drawn under (`contentCarry.ts`). What its unit set for
 * what follows stays where it stood: a setting at the unit's own depth, and the clip of a shape that sets one, whose
 * paint alone moves. Refused at `cropped` where the new place clips to an area that does not hold the object's box.
 */
function arrange(
  content: Uint8Array,
  kinds: (name: string) => XObjectKind,
  drawn: readonly DrawnObject[],
  found: DrawnObject,
  command: CommandOfKind<'editDrawnObject'>,
  edit: Extract<DrawnEdit, { op: 'arrange' }>,
  plainState: string,
): DrawnEditResult {
  const layout = contentLayout(content, kinds);
  const own = layout.unitOf(found);
  const span = neighbourSpan(layout, edit.past);
  if (span === undefined) throw refused('object', `page ${String(command.page)} holds no ${edit.past.kind} the arrange names`);
  const neighbour = layout.unitOf(span);
  const forward = edit.to === 'forward';
  // THE NEIGHBOUR IS ON THE SIDE THE ARRANGE GOES, and outside the object's own unit.
  if (forward ? neighbour.start < own.end : neighbour.end > own.start) {
    throw refused('object', `the ${edit.past.kind} named is not ${forward ? 'after' : 'before'} ${command.object} ${String(command.ordinal)}`);
  }
  const at = forward ? neighbour.end : neighbour.start;
  const [first, second] = contentLayout(content, kinds, forward ? [own.start, at] : [at, own.start]).states;
  const from = forward ? first : second;
  const to = forward ? second : first;
  if (from === undefined || to === undefined) throw new Error('the content pass answered no state at an offset it was asked for');
  const carry = carried(content, from, to, command.box, plainState);
  if (carry === 'cropped') throw refused('cropped', `${command.object} ${String(command.ordinal)} would be cut off past the ${edit.past.kind}`);

  const latin1 = new TextDecoder('latin1');
  const bytes = (start: number, end: number): string => latin1.decode(content.subarray(start, end));
  const paint = found.paint;
  const clip = found.clip;
  // A SHAPE THAT SETS THE CLIP, lifted bare, leaves its clip where it stood: what follows it is still clipped by it, and
  // only its paint moves.
  const leavesClip = clip !== undefined && paint !== undefined && own.start === found.start && own.end === found.end;
  const moved = leavesClip ? `${bytes(found.start, clip.start).trimEnd()} ${paint.op}` : bytes(own.start, own.end);
  const left = [
    ...own.leaks.map((leak) => bytes(leak.start, leak.end)),
    ...(leavesClip ? [`${bytes(found.start, clip.end)} n`] : []),
  ].join('\n');
  const edited = spliced(content, [
    { start: own.start, end: own.end, text: left === '' ? ' ' : left },
    { start: at, end: at, text: `\n${carry.before}${moved}${carry.after}` },
  ]);

  // READ BACK: the same text and the same objects of each kind, the object drawn where it was drawn, on the other side of
  // its neighbour, through every clip it stood in.
  const after = drawnObjects(edited, kinds);
  const count = (objects: readonly DrawnObject[], kind: DrawnObject['kind']): number => objects.filter((object) => object.kind === kind).length;
  const placed = after.filter((object) => object.kind === found.kind && geometryOf(object) === geometryOf(found));
  // THE NEIGHBOUR AFTER THE EDIT: a text object keeps its number (the text is the same), a drawn one its geometry.
  const past = edit.past;
  const neighbourAt =
    past.kind === 'text'
      ? showOperators(edited).find((op) => op.object === past.object)?.start
      : after.find((object) => {
          const before = drawn.filter((each) => each.kind === past.kind)[past.ordinal];
          return before !== undefined && object.kind === past.kind && geometryOf(object) === geometryOf(before);
        })?.start;
  const copy = neighbourAt === undefined ? undefined : placed.find((object) => (forward ? object.start > neighbourAt : object.start < neighbourAt));
  const windowsKept =
    copy !== undefined &&
    found.windows.every((window) => copy.windows.some((each) => JSON.stringify(each.points) === JSON.stringify(window.points)));
  if (
    !sameText(content, edited) ||
    after.length !== drawn.length ||
    DRAWN_KINDS.some((kind) => count(after, kind) !== count(drawn, kind)) ||
    placed.length !== drawn.filter((object) => object.kind === found.kind && geometryOf(object) === geometryOf(found)).length ||
    !windowsKept
  ) {
    throw refused('read-back', `arranging ${command.object} ${String(command.ordinal)} did not read back as one object moved in the order`);
  }
  return { content: edited, plain: carry.plain };
}

const DRAWN_KINDS = ['path', 'image', 'form', 'shading'] as const;

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

/**
 * The edit of `command` made to `content`, read back; the page's other bytes as they were.
 *
 * @param plainState the name the page's resources will hold the plain graphics state under, where an arrange needs one
 */
export function editDrawnContent(
  content: Uint8Array,
  kinds: (name: string) => XObjectKind,
  command: CommandOfKind<'editDrawnObject'>,
  plainState = PLAIN_STATE_NAME,
): DrawnEditResult {
  const drawn = drawnObjects(content, kinds);
  const found = drawn.filter((object) => object.kind === command.object)[command.ordinal];
  if (found === undefined || !landsOn(found, command.box)) {
    throw refused('object', `page ${String(command.page)} holds no ${command.object} ${String(command.ordinal)} where the listing put it`);
  }
  const { edit } = command;
  switch (edit.op) {
    case 'place':
      return { content: place(content, kinds, drawn, found, command, edit) };
    case 'recolor':
      return { content: recolor(content, kinds, drawn, found, command, edit) };
    case 'arrange':
      return arrange(content, kinds, drawn, found, command, edit, plainState);
    case 'delete':
      return { content: remove(content, kinds, drawn, found, command) };
  }
}

/** The name an arrange's plain graphics state takes first; a page whose resources already use it takes the next free one. */
const PLAIN_STATE_NAME = 'MonPlain';

export async function applyEditDrawnObject(session: MupdfSession, command: CommandOfKind<'editDrawnObject'>): Promise<void> {
  await withDocument(session, (document) => {
    const leaf = document.findPage(command.page);
    const content = joinedContent(pageContentStreams(leaf));
    // THE PAGE'S OWN RESOURCES, or the ones it inherits: where the content's names are looked up.
    let resources = leaf.getInheritable('Resources');
    if (!resources.isNull()) resources = resources.resolve();
    const states = resources.isDictionary() ? resources.get('ExtGState').resolve() : resources;
    let name = PLAIN_STATE_NAME;
    for (let suffix = 1; states.isDictionary() && !states.get(name).isNull(); suffix += 1) name = `${PLAIN_STATE_NAME}${String(suffix)}`;
    const result = editDrawnContent(content, xobjectKinds(leaf), command, name);
    if (result.plain === true) {
      // A PAGE WITH NO RESOURCES AT ALL is given a dictionary. One that inherits its resources has the entry added where
      // it inherits them from: a name its siblings do not use, so it changes nothing they draw.
      if (!resources.isDictionary()) {
        resources = document.newDictionary();
        leaf.put('Resources', resources);
      }
      let target = resources.get('ExtGState');
      if (target.isNull()) {
        target = document.newDictionary();
        resources.put('ExtGState', target);
      } else {
        target = target.resolve();
      }
      target.put(name, document.addObject(PLAIN_STATE));
    }
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
