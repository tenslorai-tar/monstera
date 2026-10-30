import { type FormPath, type FormsLeftOut, MAX_FORM_DEPTH, MAX_FORM_PLACEMENTS, formPathSchema, sameFormPath } from '@monstera/contract/host';

import type { MupdfSession } from './engineSeam.js';
import type { PDFDocument, PDFObject } from './mupdfRaw.js';
import { bufferBytes, newDocument, withDocument } from './mupdfWriter.js';
import { pageContentStreams, xobjectKinds } from './pageContent.js';
import { freeName, resourceDictionaryOf } from './pageResources.js';
import { savedBuffer } from './saveDepth.js';
import { type PageBox, boxOfPoints, inverse, written as numberWritten } from './contentCarry.js';
import { type ClipWindow, type DrawnObject, type Matrix, type Setting, drawnObjects, joinedContent, multiply, showOperators } from './textOperators.js';

/**
 * Text inside a form XObject, edited in the form's own content as text on the page is
 * ([ADR-0269](../../../docs/DECISIONS/0269-text-inside-a-form-is-edited-in-the-forms-own-content.md)).
 *
 * ## A placement, and the page it is read as
 *
 * A form is drawn where a `Do` names it — in the page's content or in another form's — under the CTM in effect there,
 * times its own `/Matrix`. A PLACEMENT is the path of such `Do`s from the page down, each a resource name and which
 * occurrence of that name in the stream that holds it, and the chain of matrices that places the form's stream on the
 * page. Read as a page of its own — the page's boxes, the form's resources, and as content the form's stream inside
 * `q <the chain> cm … Q` ({@link wrappedForm}) — PDFium numbers its text objects as it numbers a page's, in the page's
 * user space, and the operator writer edits that wrapped content and gives back the form's stream with the wrapper taken
 * off again, unchanged.
 *
 * ## One builder for both ends
 *
 * The page PDFium reads ({@link formPagesDocument}) and the content the writer edits ({@link wrappedForm}) are made by
 * the same functions from the same document, so PDFium's numbering names the operators the writer finds.
 */

/** One place a form showing text is drawn: its path from the page, the matrices that place it, its stream and holder. */
export interface FormPlacement {
  readonly path: FormPath;
  readonly chain: readonly Matrix[];
  /**
   * For each step of the path, the instructions in effect at its `Do` that the form inherits and that name nothing in
   * the stream's resources (`inherited`), as written: one string per step, replayed before that step's matrices.
   */
  readonly states: readonly string[];
  /** The form XObject, as its holder's resources name it: what its stream is read from and written to. */
  readonly form: PDFObject;
  /** The page leaf or form whose content draws it: a form as its holder's resources name it, so its stream can be read. */
  readonly holder: PDFObject;
  /** The form's own content, decoded. */
  readonly content: Uint8Array;
  /** Where its `Do` sits in the holder's content, which a copy renames. */
  readonly operand: { readonly start: number; readonly end: number };
  /**
   * The clip windows in force at its `Do` that frame it alone — nothing else drawn between a window's path and the `Q`
   * that ends it — in the holder's space: what an edit grows with the form's box ({@link growFrames}).
   */
  readonly frames: readonly ClipWindow[];
}

const LATIN1 = new TextDecoder('latin1');

/** A name as its resources hold it: a `#xx` escape is the byte it stands for (ISO 32000-2, 7.3.5). */
function decodedName(written: string): string {
  return written.replace(/#([0-9A-Fa-f]{2})/gu, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/** A `Do`'s operand in `content[start, end)`, decoded, with where the operand itself sits; `undefined` for none. */
function doOperand(content: Uint8Array, start: number, end: number): { readonly name: string; readonly start: number; readonly end: number } | undefined {
  const text = LATIN1.decode(content.subarray(start, end));
  const found = /\/([^\s/<>[\]()%{}]+)\s+Do\b/u.exec(text);
  if (found?.[1] === undefined) return undefined;
  return { name: decodedName(found[1]), start: start + found.index, end: start + found.index + 1 + found[1].length };
}

/** The XObject `holder`'s resources name `name`, or `undefined`. */
function xobjectNamed(holder: PDFObject, name: string): PDFObject | undefined {
  const resources = holder.getInheritable('Resources');
  if (resources.isNull()) return undefined;
  const listed = resources.resolve().get('XObject');
  if (listed.isNull()) return undefined;
  const found = listed.resolve().get(name);
  return found.isNull() ? undefined : found;
}

/** Names an instruction may carry that are not resources: the device colour spaces and the rendering intents. */
const NOT_RESOURCES = new Set(['DeviceGray', 'DeviceRGB', 'DeviceCMYK', 'Perceptual', 'RelativeColorimetric', 'AbsoluteColorimetric', 'Saturation']);

/**
 * What a form drawn under `settings` inherits from its holder, as instructions to replay before it: a form is drawn in
 * the graphics state in effect at its `Do` (ISO 32000-2, 8.10.1), and its text's place and colour depend on that state —
 * measured 2026-10-25 on the brochure fixture, whose page sets `0.3 Tc` before its pull quote's `Do`, so the quote is
 * drawn wider than the same content read on a page of its own, and an edit laid out against the narrower reading moved
 * its last letter. An instruction that names a resource of the holder is left out (`Tf`, `gs`, a colour space by name,
 * and the colours set in a space left out): the form's own resources need not hold that name, and those the form uses it
 * sets itself.
 */
function inherited(content: Uint8Array, settings: readonly Setting[]): string {
  const kept: string[] = [];
  const dropped = new Set<string>();
  for (const setting of settings) {
    const text = LATIN1.decode(content.subarray(setting.start, setting.end));
    const names = [...text.matchAll(/\/([^\s/<>[\]()%{}]+)/gu)].map((match) => match[1] ?? '');
    const resource = setting.slot === null || setting.slot === 'Tf' || names.some((name) => !NOT_RESOURCES.has(name));
    // A COLOUR IN A SPACE LEFT OUT would be read in another space, so it goes with it.
    const spaceGone = (setting.slot === 'fill' && dropped.has('fill space')) || (setting.slot === 'stroke' && dropped.has('stroke space'));
    if (resource || spaceGone) {
      if (setting.slot !== null) dropped.add(setting.slot);
      continue;
    }
    dropped.delete(setting.slot);
    kept.push(text);
  }
  return kept.join(' ');
}

/** A form's `/Matrix`, or the identity where it states none. */
function formMatrix(form: PDFObject): Matrix {
  const stated = form.resolve().get('Matrix');
  if (!stated.isArray() || stated.length !== 6) return [1, 0, 0, 1, 0, 0];
  const at = (index: number): number => stated.get(index).asNumber();
  return [at(0), at(1), at(2), at(3), at(4), at(5)];
}

/** The object number an indirect reference names, or -1 for a direct object. */
function objectNumber(object: PDFObject): number {
  return object.isIndirect() ? object.asIndirect() : -1;
}

/**
 * The most placements the walk visits on one page, text or not: as many as the steps of every path it may offer, so a
 * page whose forms all show text is read to its last offerable placement, and a form graph that draws one form many
 * times inside another costs no more than that. Derived from the two bounds, never a third figure.
 */
export const MAX_FORM_VISITS = MAX_FORM_PLACEMENTS * MAX_FORM_DEPTH;

/** A form's content as the walk reads it: once per form object per walk, however many times the form is drawn. */
interface ReadForm {
  readonly content: Uint8Array;
  readonly drawn: readonly DrawnObject[];
  readonly showsText: boolean;
}

/** One page's walk: what it found, in the order found, and why it stopped short. */
interface Walk {
  readonly placements: FormPlacement[];
  readonly read: Map<number, ReadForm>;
  visits: number;
  texts: number;
  deeper: boolean;
  more: boolean;
  unnamed: boolean;
}

/** `holder`'s content read for the walk, from the walk's own reading where the same form object was read before. */
function readFor(walk: Walk, holder: PDFObject): ReadForm {
  const id = objectNumber(holder);
  const known = id === -1 ? undefined : walk.read.get(id);
  if (known !== undefined) return known;
  const content = bufferBytes(holder.readStream());
  const read = { content, drawn: drawnObjects(content, xobjectKinds(holder)), showsText: showOperators(content).some((op) => op.object !== null) };
  if (id !== -1) walk.read.set(id, read);
  return read;
}

/**
 * Every placement of a form under `holder` (a page leaf or a form) whose content is `content`, depth first in content
 * order, each with its chain from the page, added to `walk` — and BOUNDED AS IT GOES: a placement past
 * {@link MAX_FORM_DEPTH} is not entered, and the walk stops at {@link MAX_FORM_PLACEMENTS} placements showing text or
 * {@link MAX_FORM_VISITS} in all, saying which in `walk`. So nothing is visited that the read will not keep, and a form
 * drawn twice inside a form drawn twice, sixteen levels down, is read once and visited no more often than the bound.
 *
 * A form already entered on THIS path is not entered again: a form that draws itself, directly or through others,
 * would otherwise be a path without end, and its text is already offered at the placement that entered it. That is not
 * a placement left out, so it is not said. A form drawn twice on two DIFFERENT paths is two placements, and both count.
 *
 * @returns false once the walk has stopped, so every caller up the path stops with it
 */
function walkUnder(
  walk: Walk,
  holder: PDFObject,
  read: Pick<ReadForm, 'content' | 'drawn'>,
  chain: readonly Matrix[],
  states: readonly string[],
  path: FormPath | readonly [],
  entered: ReadonlySet<number>,
): boolean {
  const { content, drawn: everything } = read;
  const seen = new Map<string, number>();
  for (const drawn of everything) {
    if (drawn.kind !== 'form') continue;
    const operand = doOperand(content, drawn.start, drawn.end);
    if (operand === undefined) continue;
    // COUNTED BEFORE ANY BOUND, so an occurrence names the same `Do` whatever the walk skips before it.
    const occurrence = seen.get(operand.name) ?? 0;
    seen.set(operand.name, occurrence + 1);
    const form = xobjectNamed(holder, operand.name);
    if (form === undefined) continue;
    const id = objectNumber(form);
    if (entered.has(id)) continue;
    const step = { name: operand.name, occurrence };
    // ONE STEP JUDGED BY THE PATH'S OWN SCHEMA, so the name's bound is the contract's and not a copy here (B3a).
    if (!formPathSchema.safeParse([step]).success) {
      walk.unnamed = true;
      continue;
    }
    // PAST THE DEPTH, not entered: said only where the form could hold text — it shows some, or draws a form.
    if (path.length >= MAX_FORM_DEPTH) {
      const unread = readFor(walk, form);
      if (unread.showsText || unread.drawn.some((each) => each.kind === 'form')) walk.deeper = true;
      continue;
    }
    if (walk.visits >= MAX_FORM_VISITS) {
      walk.more = true;
      return false;
    }
    const own = readFor(walk, form);
    if (own.showsText && walk.texts >= MAX_FORM_PLACEMENTS) {
      walk.more = true;
      return false;
    }
    walk.visits += 1;
    if (own.showsText) walk.texts += 1;
    const placement: FormPlacement = {
      path: [...path, step],
      chain: [...chain, drawn.ctm, formMatrix(form)],
      states: [...states, inherited(content, drawn.settings)],
      form,
      holder,
      content: own.content,
      operand: { start: operand.start, end: operand.end },
      frames: drawn.windows.filter((window) => everything.filter((other) => other.start >= window.start && other.start < window.end).length === 1),
    };
    walk.placements.push(placement);
    // THE HOLDING FORM AS ITS REFERENCE, which its stream is read from and written to: resolved, it answers its
    // dictionary, and a stream's dictionary has no stream.
    if (!walkUnder(walk, form, own, placement.chain, placement.states, placement.path, new Set([...entered, id]))) return false;
  }
  return true;
}

/** The page's walk: every placement of a form on it within the bounds, whether it shows text or not, and what it left. */
function walkPage(leaf: PDFObject): Walk {
  const walk: Walk = { placements: [], read: new Map(), visits: 0, texts: 0, deeper: false, more: false, unnamed: false };
  const content = joinedContent(pageContentStreams(leaf));
  walkUnder(walk, leaf, { content, drawn: drawnObjects(content, xobjectKinds(leaf)) }, [], [], [], new Set());
  return walk;
}

/** Whether a placement's form shows text of its own. */
function showsText(placement: FormPlacement): boolean {
  return showOperators(placement.content).some((op) => op.object !== null);
}

/** Every placement on the page of a form whose own content shows text, in the order {@link formPagesDocument} pages them. */
export function textPlacements(leaf: PDFObject): readonly FormPlacement[] {
  return walkPage(leaf).placements.filter(showsText);
}

/** The placement `path` names on the page now, or `undefined` where it names none. */
export function placementAt(leaf: PDFObject, path: FormPath): FormPlacement | undefined {
  return walkPage(leaf).placements.find((placement) => sameFormPath(placement.path, path));
}

/** A number as a content stream writes it: six places, no exponent, no negative zero. */
function written(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return rounded === 0 ? '0' : String(rounded);
}

/**
 * The form's content as the page it is read as: inside `q … Q`, each step from the page down opening with the state the
 * form inherits there and the step's two matrices — the CTM at its `Do`, then the form's own — and how many bytes either
 * side are the wrapper.
 */
export function wrappedForm(placement: Pick<FormPlacement, 'chain' | 'content' | 'states'>): {
  readonly bytes: Uint8Array;
  readonly prefix: number;
  readonly suffix: number;
} {
  const encoder = new TextEncoder();
  const cm = (matrix: Matrix | undefined): string => (matrix === undefined ? '' : `${matrix.map(written).join(' ')} cm`);
  const steps = placement.states.map((state, at) => [state, cm(placement.chain[2 * at]), cm(placement.chain[2 * at + 1])].filter((part) => part !== '').join(' '));
  const prefix = encoder.encode(`q ${steps.join(' ')}\n`);
  const suffix = encoder.encode('\nQ\n');
  const bytes = new Uint8Array(prefix.length + placement.content.length + suffix.length);
  bytes.set(prefix, 0);
  bytes.set(placement.content, prefix.length);
  bytes.set(suffix, prefix.length + placement.content.length);
  return { bytes, prefix: prefix.length, suffix: suffix.length };
}

/**
 * The form's own content again from an edit of {@link wrappedForm}'s bytes: the wrapper taken off, after checking it is
 * still there byte for byte — the operator writer leaves every byte outside the edited operators as it was, so a
 * wrapper that changed is a writer defect, thrown rather than written into the form.
 */
export function unwrappedForm(edited: Uint8Array, wrapped: ReturnType<typeof wrappedForm>): Uint8Array {
  const same = (from: number, to: number, at: number): boolean => {
    for (let k = from; k < to; k += 1) if (edited[at + k - from] !== wrapped.bytes[k]) return false;
    return true;
  };
  const tail = wrapped.bytes.length - wrapped.suffix;
  if (edited.length < wrapped.prefix + wrapped.suffix || !same(0, wrapped.prefix, 0) || !same(tail, wrapped.bytes.length, edited.length - wrapped.suffix)) {
    throw new Error('an edit of a form changed the wrapper that places it, which the operator writer never writes');
  }
  return edited.slice(wrapped.prefix, edited.length - wrapped.suffix);
}

/**
 * A document of one page per placement of a form showing text on page `page` of `document`, in {@link textPlacements}'
 * order: what PDFium reads a form's text from. Built in memory and answered as bytes; nothing of `document` changes.
 * A form with no `/Resources` of its own draws with its holder's, as a reader resolves it.
 */
export function formPagesDocument(document: PDFDocument, page: number): FormPages {
  const leaf = document.findPage(page);
  // ONLY PATHS THE WIRE TAKES, because the walk enters nothing else, and WHY THE REST WAS LEFT, so the page says some of
  // its text is not outlined and for which reason (ADR-0273 Decision 6) rather than nothing.
  const walk = walkPage(leaf);
  const placements = walk.placements.filter(showsText);
  const left: FormsLeftOut = { deeper: walk.deeper, more: walk.more, unnamed: walk.unnamed };
  if (placements.length === 0) return { bytes: new Uint8Array(), paths: [], left };
  const pages = newDocument();
  try {
    const box = leaf.getInheritable('MediaBox');
    const mediabox: [number, number, number, number] = [box.get(0).asNumber(), box.get(1).asNumber(), box.get(2).asNumber(), box.get(3).asNumber()];
    const turned = leaf.getInheritable('Rotate');
    const rotate = (turned.isNull() ? 0 : ((turned.asNumber() % 360) + 360) % 360) as 0 | 90 | 180 | 270;
    for (const placement of placements) {
      const resources = placement.form.resolve().get('Resources');
      const grafted = pages.graftObject(resources.isNull() ? placement.holder.getInheritable('Resources') : resources);
      pages.insertPage(-1, pages.addPage(mediabox, rotate, grafted, wrappedForm(placement).bytes));
    }
    return { bytes: bufferBytes(savedBuffer(pages, '')), paths: placements.map((placement) => placement.path), left };
  } finally {
    pages.destroy();
  }
}

/** A page's form placements read as pages, and why the walk left any out. */
export interface FormPages {
  readonly bytes: Uint8Array;
  readonly paths: readonly FormPath[];
  readonly left: FormsLeftOut;
}

/** {@link formPagesDocument} of a session's document: what the MuPDF host answers `engine/form-pages` with. */
export function readFormPages(session: MupdfSession, page: number): Promise<FormPages> {
  return withDocument(session, (document) => formPagesDocument(document, page));
}

/** The largest page ISO 32000-2 allows (Annex C, 14,400 units), each way from the origin: the room a form is read in. */
const READ_EXTENT = 14_400;

/**
 * Every character a form's content draws, as one box in the form's own space, each side outward to the whole point; or
 * `undefined` for content that draws none. Read by MuPDF from the content alone, on a page reaching {@link READ_EXTENT}
 * each way.
 *
 * @param resources the resources the content draws with: the form's own, or its holder's where it has none
 */
export function charactersDrawn(content: Uint8Array, resources: PDFObject): PageBox | undefined {
  // A RECORD, written by the walk's callback, so its sides are read after the walk as it left them.
  const box = { x0: Number.POSITIVE_INFINITY, y0: Number.POSITIVE_INFINITY, x1: Number.NEGATIVE_INFINITY, y1: Number.NEGATIVE_INFINITY };
  const reading = newDocument();
  try {
    const grafted = resources.isNull() ? reading.newDictionary() : reading.graftObject(resources);
    reading.insertPage(-1, reading.addPage([-READ_EXTENT, -READ_EXTENT, READ_EXTENT, READ_EXTENT], 0, grafted, content));
    // MuPDF'S PAGE SPACE runs down from the page's top-left, so a point (x, y) of it is (x − EXTENT, EXTENT − y) here.
    reading.loadPage(0).toStructuredText('clip=no').walk({
      onChar: (_character, _origin, _font, _size, quad) => {
        for (let at = 0; at + 1 < quad.length; at += 2) {
          const x = (quad[at] ?? 0) - READ_EXTENT;
          const y = READ_EXTENT - (quad[at + 1] ?? 0);
          box.x0 = Math.min(box.x0, Math.floor(x));
          box.x1 = Math.max(box.x1, Math.ceil(x));
          box.y0 = Math.min(box.y0, Math.floor(y));
          box.y1 = Math.max(box.y1, Math.ceil(y));
        }
      },
    });
  } finally {
    reading.destroy();
  }
  return box.x0 > box.x1 ? undefined : { left: box.x0, bottom: box.y0, right: box.x1, top: box.y1 };
}

/**
 * The form's `/BBox` grown to hold `characters`, in the form's own space
 * ([ADR-0269](../../../docs/DECISIONS/0269-text-inside-a-form-is-edited-in-the-forms-own-content.md)'s correction of
 * 2026-10-25): a form draws nothing outside its box, so words an edit wrapped below a box drawn round one line were
 * written and not shown. The box only grows, to the union of what it was and those characters; a box nothing outgrew is
 * not rewritten.
 */
export function growFormBox(form: PDFObject, characters: PageBox): void {
  const own = form.resolve();
  const stated = own.get('BBox');
  if (!stated.isArray() || stated.length !== 4) return;
  const [ax = 0, ay = 0, bx = 0, by = 0] = [0, 1, 2, 3].map((at) => stated.get(at).asNumber());
  const was = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
  const grown = [Math.min(was[0] ?? 0, characters.left), Math.min(was[1] ?? 0, characters.bottom), Math.max(was[2] ?? 0, characters.right), Math.max(was[3] ?? 0, characters.top)];
  if (grown.some((side, at) => side !== was[at])) own.put('BBox', grown);
}

/** `box` carried through `matrix`, as the box of its four corners. */
function boxThrough(box: PageBox, matrix: Matrix): PageBox {
  const corners = [
    [box.left, box.bottom],
    [box.right, box.bottom],
    [box.right, box.top],
    [box.left, box.top],
  ] as const;
  return boxOfPoints(corners.map(([x, y]) => {
    const moved = multiply([1, 0, 0, 1, x, y], matrix);
    return [moved[4], moved[5]] as const;
  }));
}

/** A path of one rectangle, as a content stream writes `x y w h re`, its four numbers apart from the bytes round them. */
const ONE_RECTANGLE = /^(\s*)([-+]?(?:\d+\.?\d*|\.\d+))(\s+)([-+]?(?:\d+\.?\d*|\.\d+))(\s+)([-+]?(?:\d+\.?\d*|\.\d+))(\s+)([-+]?(?:\d+\.?\d*|\.\d+))(\s+re\s*)$/u;

/**
 * The frames of placement `path` on page `page` grown with its box (ADR-0269's correction of 2026-10-25, *the clips that
 * frame a placement grow with its box*): a placement is drawn through the clips in force at each `Do` along its path, and
 * those are its holders' content, outside the wrapper it is read and edited in, so a line written below the box was
 * written and not shown however far the box grew. From the edited form outward, each step's frames
 * ({@link FormPlacement.frames}) whose path is one rectangle grow to hold `characters`, carried into the space the
 * rectangle is built in, and each holding form's `/BBox` grows by {@link growFormBox}. A frame's four numbers are the
 * only bytes of a holder's content it writes, and a frame that already holds them is left as it was.
 *
 * @param characters what the edited form draws, in its own space ({@link charactersDrawn})
 */
export function growFrames(document: PDFDocument, page: number, path: FormPath, characters: PageBox): void {
  let inForm = characters;
  for (let depth = path.length; depth >= 1; depth -= 1) {
    const leaf = document.findPage(page);
    const step = placementAt(leaf, path.slice(0, depth));
    if (step === undefined) return;
    // A HOLDING FORM draws nothing outside its own box either.
    if (depth < path.length) growFormBox(step.form, inForm);
    const doCtm = step.chain[2 * (depth - 1)];
    const formMatrixHere = step.chain[2 * (depth - 1) + 1];
    if (doCtm === undefined || formMatrixHere === undefined) return;
    const inHolder = boxThrough(inForm, multiply(formMatrixHere, doCtm));
    const holderContent = depth === 1 ? joinedContent(pageContentStreams(leaf)) : bufferBytes(step.holder.readStream());
    const splices: { readonly start: number; readonly end: number; readonly text: string }[] = [];
    for (const frame of step.frames) {
      const rectangle = ONE_RECTANGLE.exec(LATIN1.decode(holderContent.subarray(frame.start, frame.segmentsEnd)));
      const back = inverse(frame.ctm);
      if (rectangle === null || back === null) continue;
      const [x = 0, y = 0, w = 0, h = 0] = [2, 4, 6, 8].map((at) => Number(rectangle[at]));
      const wanted = boxThrough(inHolder, back);
      const left = Math.min(x, x + w, wanted.left);
      const bottom = Math.min(y, y + h, wanted.bottom);
      const right = Math.max(x, x + w, wanted.right);
      const top = Math.max(y, y + h, wanted.top);
      if (left === Math.min(x, x + w) && bottom === Math.min(y, y + h) && right === Math.max(x, x + w) && top === Math.max(y, y + h)) continue;
      const [lead = '', , one = ' ', , two = ' ', , three = ' ', , tail = ' re'] = rectangle.slice(1);
      const numbers = [left, bottom, right - left, top - bottom].map(numberWritten);
      splices.push({ start: frame.start, end: frame.segmentsEnd, text: `${lead}${numbers[0] ?? ''}${one}${numbers[1] ?? ''}${two}${numbers[2] ?? ''}${three}${numbers[3] ?? ''}${tail}` });
    }
    if (splices.length > 0) {
      const encoder = new TextEncoder();
      const parts: Uint8Array[] = [];
      let from = 0;
      for (const splice of [...splices].sort((one, two) => one.start - two.start)) {
        parts.push(holderContent.subarray(from, splice.start), encoder.encode(splice.text));
        from = splice.end;
      }
      parts.push(holderContent.subarray(from));
      const grown = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
      let at = 0;
      for (const part of parts) {
        grown.set(part, at);
        at += part.length;
      }
      if (depth === 1) leaf.put('Contents', document.addStream(grown, document.newDictionary()));
      else step.holder.writeStream(grown);
    }
    inForm = inHolder;
  }
}

/**
 * How many placements across the whole document draw `form`'s object: more than one means it is used elsewhere.
 *
 * A PAGE WHOSE WALK LEFT FORMS UNREAD counts as one use more: an unread form may draw this one, and an edit that took
 * the form for this placement's alone would change a placement nobody looked at. Copying a form only this placement
 * draws costs a copy; editing one drawn elsewhere changes text the person did not touch.
 */
function usesOf(document: PDFDocument, form: PDFObject): number {
  const id = objectNumber(form);
  if (id === -1) return 1;
  let uses = 0;
  for (let page = 0; page < document.countPages(); page += 1) {
    const walk = walkPage(document.findPage(page));
    for (const placement of walk.placements) if (objectNumber(placement.form) === id) uses += 1;
    if (walk.deeper || walk.more || walk.unnamed) uses += 1;
  }
  return uses;
}

/**
 * The placement `path` names on page `page`, made THIS placement's own first (Decision 3): every form along the path
 * that is drawn anywhere else is copied — a new stream with the same dictionary and content, under a fresh name in the
 * resources of the stream that places it — and that one `Do`'s operand renamed to it. The rename is the only byte
 * written outside the form; a holder that is itself shared was copied a step before, so no other placement changes.
 *
 * @returns the placement to edit, its path naming the copies; `undefined` where the path names nothing on the page now
 */
export function ownPlacement(document: PDFDocument, page: number, path: FormPath): FormPlacement | undefined {
  let current: FormPath = path;
  for (let depth = 1; depth <= path.length; depth += 1) {
    const leaf = document.findPage(page);
    const step = placementAt(leaf, current.slice(0, depth));
    if (step === undefined) return undefined;
    if (usesOf(document, step.form) <= 1) continue;
    const dictionary = document.newDictionary();
    step.form.resolve().forEach((value, key) => {
      // THE STREAM'S OWN KEYS ARE THE NEW STREAM'S: its content is written decoded, so no filter or length carries over.
      if (typeof key === 'string' && key !== 'Length' && key !== 'Filter' && key !== 'DecodeParms') dictionary.put(key, value);
    });
    const copy = document.addStream(step.content, dictionary);
    const listed = resourceDictionaryOf(document, step.holder.isIndirect() ? step.holder : step.holder.resolve(), 'XObject');
    const name = freeName(listed, 'MonsteraForm');
    listed.put(name, copy);
    // THE ONE `Do` RENAMED, in the stream that holds it: the page's content as one stream, or the holding form's.
    const holderContent = depth === 1 ? joinedContent(pageContentStreams(leaf)) : bufferBytes(step.holder.readStream());
    const renamed = new Uint8Array(holderContent.length - (step.operand.end - step.operand.start) + 1 + name.length);
    renamed.set(holderContent.subarray(0, step.operand.start), 0);
    renamed.set(new TextEncoder().encode(`/${name}`), step.operand.start);
    renamed.set(holderContent.subarray(step.operand.end), step.operand.start + 1 + name.length);
    if (depth === 1) leaf.put('Contents', document.addStream(renamed, document.newDictionary()));
    else step.holder.writeStream(renamed);
    current = [...current.slice(0, depth - 1), { name, occurrence: 0 }, ...current.slice(depth)];
  }
  return placementAt(document.findPage(page), current);
}
