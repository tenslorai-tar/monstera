import { type FormPath, MAX_FORM_PLACEMENTS, formPathSchema, sameFormPath } from '@monstera/contract/host';

import type { MupdfSession } from './engineSeam.js';
import type { PDFDocument, PDFObject } from './mupdfRaw.js';
import { bufferBytes, newDocument, withDocument } from './mupdfWriter.js';
import { pageContentStreams, xobjectKinds } from './pageContent.js';
import { freeName, resourceDictionaryOf } from './pageResources.js';
import { type Matrix, drawnObjects, joinedContent, showOperators } from './textOperators.js';

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
  /** The form XObject, as its holder's resources name it: what its stream is read from and written to. */
  readonly form: PDFObject;
  /** The page leaf or form whose content draws it. */
  readonly holder: PDFObject;
  /** The form's own content, decoded. */
  readonly content: Uint8Array;
  /** Where its `Do` sits in the holder's content, which a copy renames. */
  readonly operand: { readonly start: number; readonly end: number };
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
 * Every placement of a form under `holder` (a page leaf or a form) whose content is `content`, depth first in content
 * order, each with its chain from the page. A form that draws itself, directly or not, is not entered twice.
 */
function placementsUnder(
  holder: PDFObject,
  content: Uint8Array,
  chain: readonly Matrix[],
  path: FormPath | readonly [],
  entered: ReadonlySet<number>,
): FormPlacement[] {
  const found: FormPlacement[] = [];
  const seen = new Map<string, number>();
  for (const drawn of drawnObjects(content, xobjectKinds(holder))) {
    if (drawn.kind !== 'form') continue;
    const operand = doOperand(content, drawn.start, drawn.end);
    if (operand === undefined) continue;
    const occurrence = seen.get(operand.name) ?? 0;
    seen.set(operand.name, occurrence + 1);
    const form = xobjectNamed(holder, operand.name);
    if (form === undefined) continue;
    const id = objectNumber(form);
    if (entered.has(id)) continue;
    const own = bufferBytes(form.readStream());
    const placement: FormPlacement = {
      path: [...path, { name: operand.name, occurrence }],
      chain: [...chain, drawn.ctm, formMatrix(form)],
      form,
      holder,
      content: own,
      operand: { start: operand.start, end: operand.end },
    };
    found.push(placement, ...placementsUnder(form.resolve(), own, placement.chain, placement.path, new Set([...entered, id])));
  }
  return found;
}

/** Every placement of a form on the page, whether it shows text or not. */
function placementsOn(leaf: PDFObject): FormPlacement[] {
  return placementsUnder(leaf, joinedContent(pageContentStreams(leaf)), [], [], new Set());
}

/** Every placement on the page of a form whose own content shows text, in the order {@link formPagesDocument} pages them. */
export function textPlacements(leaf: PDFObject): readonly FormPlacement[] {
  return placementsOn(leaf).filter((placement) => showOperators(placement.content).some((op) => op.object !== null));
}

/** The placement `path` names on the page now, or `undefined` where it names none. */
export function placementAt(leaf: PDFObject, path: FormPath): FormPlacement | undefined {
  return placementsOn(leaf).find((placement) => sameFormPath(placement.path, path));
}

/** A number as a content stream writes it: six places, no exponent, no negative zero. */
function written(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return rounded === 0 ? '0' : String(rounded);
}

/** The form's content as the page it is read as: inside `q <chain> cm … Q`, and how many bytes either side are the wrapper. */
export function wrappedForm(placement: Pick<FormPlacement, 'chain' | 'content'>): {
  readonly bytes: Uint8Array;
  readonly prefix: number;
  readonly suffix: number;
} {
  const encoder = new TextEncoder();
  const prefix = encoder.encode(`q ${placement.chain.map((matrix) => `${matrix.map(written).join(' ')} cm`).join(' ')}\n`);
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
export function formPagesDocument(document: PDFDocument, page: number): { readonly bytes: Uint8Array; readonly paths: readonly FormPath[] } {
  const leaf = document.findPage(page);
  // ONLY PATHS THE WIRE TAKES, and the first `MAX_FORM_PLACEMENTS` of them: a placement deeper, or named longer, than the
  // contract's bounds is left unoffered rather than answered with a path the schema refuses, which would fail the read.
  const placements = textPlacements(leaf)
    .filter((placement) => formPathSchema.safeParse(placement.path).success)
    .slice(0, MAX_FORM_PLACEMENTS);
  if (placements.length === 0) return { bytes: new Uint8Array(), paths: [] };
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
    return { bytes: bufferBytes(pages.saveToBuffer('')), paths: placements.map((placement) => placement.path) };
  } finally {
    pages.destroy();
  }
}

/** {@link formPagesDocument} of a session's document: what the MuPDF host answers `engine/form-pages` with. */
export function readFormPages(session: MupdfSession, page: number): Promise<{ readonly bytes: Uint8Array; readonly paths: readonly FormPath[] }> {
  return withDocument(session, (document) => formPagesDocument(document, page));
}

/** How many placements across the whole document draw `form`'s object: more than one means it is used elsewhere. */
function usesOf(document: PDFDocument, form: PDFObject): number {
  const id = objectNumber(form);
  if (id === -1) return 1;
  let uses = 0;
  for (let page = 0; page < document.countPages(); page += 1) {
    for (const placement of placementsOn(document.findPage(page))) if (objectNumber(placement.form) === id) uses += 1;
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
