import type { PdfSanitizePart } from '@monstera/contract';
import type * as mupdf from './mupdfRaw.js';

import type { CaptureResult } from './commandLog.js';
import type { Apply, MupdfSession } from './engineSeam.js';
import { withDocument, withDocumentRemoving } from './mupdfWriter.js';

/**
 * Making a document inert — Stage 7's sanitize/flatten row.
 *
 * ## What it removes is the format's own list, and every entry has a reason
 *
 * Invariant 24 says this application runs none of it: no embedded JavaScript,
 * no automatic action, no external fetch, no embedded file to disk. That is
 * about what **we** do with a document somebody hands us. This command is about
 * the document a person hands to **somebody else**, whose reader makes its own
 * choices — so the same list, taken out of the file rather than ignored.
 *
 * ## The unlinking is the removal, and the collection is what finishes it
 *
 * Deleting a key from the catalogue unlinks the object; a plain save writes it
 * back out, readable to anything walking the cross-reference table rather than
 * the catalog — measured on `flattenFormFields` and recorded in
 * [ADR-0045](../../../docs/DECISIONS/0045-a-removals-garbage-collection-belongs-to-the-command.md)
 * as the object count *growing* 49 to 55. So this is a `purpose: 'removal'`
 * command and uses `withDocumentRemoving`; without that the JavaScript is still
 * in the file, and a scan for it would find it.
 *
 * ## Where an action can sit is ONE walk, which stripping and counting both take
 *
 * An action sits under the catalogue's `/OpenAction`, under an annotation's or a field's or an outline item's `/A`,
 * and after any of those in its own `/Next` chain; a trigger dictionary `/AA` sits on the catalogue, a page, an
 * annotation or a field. {@link actionPlaces} names them once, so the counter cannot learn a place the stripper does
 * not, which is how the walk missed parent fields, outline items and every `/Next` (CR-DOC-13) without either half
 * looking wrong (B3a).
 */

/** Whether `object` is a dictionary this build can read keys from. */
function dictionary(object: mupdf.PDFObject): boolean {
  return object.isDictionary();
}

/**
 * Every annotation dictionary on a page, read from `/Annots` itself.
 *
 * **NOT `getAnnotations()`**, and the difference is this row's sharpest
 * measurement. MuPDF filters `/Link` out of that reader — measured 2026-09-12:
 * a Link created through `createAnnotation` is `[7 0 R]` in the saved page's
 * `/Annots` and `getAnnotations()` answers **0**. The codebase already knew the
 * reader filters *widgets*; links are the second class it hides.
 *
 * A link is exactly where an `/A` action lives, so a sanitiser walking the
 * convenience reader would never visit the object it exists to clean — and
 * would report success. The object model is the walk.
 */
function annotationObjects(page: mupdf.PDFPage): mupdf.PDFObject[] {
  const annots = page.getObject().get('Annots');
  if (annots.isNull()) return [];
  const objects: mupdf.PDFObject[] = [];
  annots.forEach((value) => {
    if (dictionary(value)) objects.push(value);
  });
  return objects;
}

/**
 * The action types each part removes, by what the part's own words promise.
 *
 * - **`javascript`**, *embedded JavaScript and automatic actions*: what runs something. `/Rendition` may carry its own
 *   `/JS`, `/RichMediaExecute` runs a command inside rich media, and `/Launch` starts a program.
 * - **`external-actions`**, *actions that submit or fetch data*: `/SubmitForm` and `/ImportData`.
 * - **`embedded-files`**, *attached files*: `/GoToE` opens one, and points at nothing once they are gone.
 *
 * CR-DOC-13 named `/Rendition`, `/RichMediaExecute` and `/GoToE` as types the one list this replaced missed. **`/URI`,
 * `/GoTo` and `/GoToR` are deliberately in no part**: a link a person clicks is content, and a sanitise that silently
 * broke every cross-reference and every web link would be taking away the document rather than making it inert.
 */
const RUNS = new Set(['/JavaScript', '/Launch', '/Rendition', '/RichMediaExecute']);
const REACHES = new Set(['/SubmitForm', '/ImportData']);
const OPENS_ATTACHMENT = new Set(['/GoToE']);

/** A walk of a `/Next` chain, an outline or a field tree stops at this many objects: a malformed file may nest without end. */
const MAX_WALK = 10_000;

/** Whether a walk has been here: an indirect object's number, recorded on the first visit. A direct object has none. */
function seenBefore(object: mupdf.PDFObject, seen: Set<number>): boolean {
  if (!object.isIndirect()) return false;
  const number = object.asIndirect();
  if (seen.has(number)) return true;
  seen.add(number);
  return false;
}

/**
 * Every field dictionary in the `/AcroForm` tree, parents included.
 *
 * A parent field holds the keystroke, format, validate and calculate scripts in its `/AA` and is on no page, so a walk
 * of `/Annots` alone never reaches them (CR-DOC-13). A field merged with its widget is reached here and as an
 * annotation, which is harmless: removing is idempotent, and counting reads each object once through its `seen`.
 */
function fieldObjects(document: mupdf.PDFDocument): mupdf.PDFObject[] {
  const acroForm = document.getTrailer().get('Root').get('AcroForm');
  if (!dictionary(acroForm)) return [];
  const found: mupdf.PDFObject[] = [];
  const seen = new Set<number>();
  const pending: mupdf.PDFObject[] = [];
  acroForm.get('Fields').forEach((value) => pending.push(value));
  while (pending.length > 0 && found.length < MAX_WALK) {
    const field = pending.pop();
    if (field === undefined || !dictionary(field) || seenBefore(field, seen)) continue;
    found.push(field);
    field.get('Kids').forEach((kid) => pending.push(kid));
  }
  return found;
}

/** Every outline item, whose `/A` can be any action, JavaScript included (CR-DOC-13). */
function outlineItems(document: mupdf.PDFDocument): mupdf.PDFObject[] {
  const outlines = document.getTrailer().get('Root').get('Outlines');
  if (!dictionary(outlines)) return [];
  const found: mupdf.PDFObject[] = [];
  const seen = new Set<number>();
  const pending: mupdf.PDFObject[] = [outlines.get('First')];
  while (pending.length > 0 && found.length < MAX_WALK) {
    const item = pending.pop();
    if (item === undefined || !dictionary(item) || seenBefore(item, seen)) continue;
    found.push(item);
    pending.push(item.get('Next'), item.get('First'));
  }
  return found;
}

/** Where actions and trigger dictionaries sit, named once for every part and for the counter. */
interface ActionPlaces {
  /** Each `(holder, key)` under which one action, the head of its own `/Next` chain, can sit. */
  readonly actions: readonly (readonly [mupdf.PDFObject, 'A' | 'OpenAction'])[];
  /** Each dictionary that can hold an `/AA`. */
  readonly triggers: readonly mupdf.PDFObject[];
}

/** Every place an action sits, and every holder of an `/AA` trigger dictionary. */
function actionPlaces(document: mupdf.PDFDocument): ActionPlaces {
  const root = document.getTrailer().get('Root');
  const actions: (readonly [mupdf.PDFObject, 'A' | 'OpenAction'])[] = [[root, 'OpenAction']];
  const triggers: mupdf.PDFObject[] = [root];
  for (let index = 0; index < document.countPages(); index += 1) {
    const page = document.loadPage(index);
    triggers.push(page.getObject());
    for (const object of annotationObjects(page)) {
      actions.push([object, 'A']);
      triggers.push(object);
    }
  }
  for (const field of fieldObjects(document)) {
    actions.push([field, 'A']);
    triggers.push(field);
  }
  for (const item of outlineItems(document)) actions.push([item, 'A']);
  return { actions, triggers };
}

/** Whether this action dictionary's `/S` is one of `kinds`. */
function isOneOf(action: mupdf.PDFObject, kinds: ReadonlySet<string>): boolean {
  return dictionary(action) && kinds.has(String(action.get('S')));
}

/** The actions that follow `action`, in order: its `/Next` is one action or an array of them. */
function followers(action: mupdf.PDFObject): mupdf.PDFObject[] {
  const next = action.get('Next');
  if (dictionary(next)) return [next];
  const list: mupdf.PDFObject[] = [];
  if (next.isArray()) {
    next.forEach((value) => {
      if (dictionary(value)) list.push(value);
    });
  }
  return list;
}

/**
 * One action that runs `list` in order, or null for none: the first, or for several a copy of the first whose `/Next`
 * is its own followers and then the rest. A COPY, because the first may be shared by another holder whose chain must
 * not change.
 */
function sequence(document: mupdf.PDFDocument, list: readonly mupdf.PDFObject[]): mupdf.PDFObject | null {
  const [first, ...rest] = list;
  if (first === undefined) return null;
  if (rest.length === 0) return first;
  const head = document.newDictionary();
  first.forEach((value, key) => {
    if (key !== 'Next') head.put(key, value);
  });
  const next = document.newArray();
  for (const action of [...followers(first), ...rest]) next.push(action);
  head.put('Next', next);
  return head;
}

/**
 * Removes every action of `kinds` from the chain under `key`, and keeps every other one in the order it ran.
 *
 * **A removed action's followers take its place** rather than going with it: a `/JavaScript` head whose `/Next` is a
 * `/GoTo` leaves the `/GoTo`, because a person's link is content. And **a kept action's followers are walked too**,
 * which is the gap CR-DOC-13 found: a `/GoTo` a person clicks whose `/Next` runs JavaScript kept the script, because
 * only the head was read. `seen` stops a chain that loops back on itself, and a removed action met a second time goes.
 */
function clearChain(
  document: mupdf.PDFDocument,
  holder: mupdf.PDFObject,
  key: string | number,
  kinds: ReadonlySet<string>,
  seen: Set<number>,
): void {
  for (let steps = 0; steps < MAX_WALK; steps += 1) {
    const action = holder.get(key);
    if (!dictionary(action)) return;
    const repeat = seenBefore(action, seen);
    if (isOneOf(action, kinds)) {
      // A follower this chain already ran is the loop back to it, and taking it as the next head would close the
      // loop on itself rather than end it.
      const ahead = followers(action).filter((next) => !(next.isIndirect() && seen.has(next.asIndirect())));
      const rest = repeat ? null : sequence(document, ahead);
      if (rest === null) {
        holder.delete(key);
        return;
      }
      holder.put(key, rest);
      continue;
    }
    if (repeat || seen.size > MAX_WALK) return;
    const next = action.get('Next');
    if (next.isArray()) {
      for (let at = next.length - 1; at >= 0; at -= 1) clearChain(document, next, at, kinds, seen);
      if (next.length === 0) action.delete('Next');
    } else {
      clearChain(document, action, 'Next', kinds, seen);
    }
    return;
  }
}

/** How many actions of `kinds` the chain under `key` holds, walked as {@link clearChain} walks it. */
function countInChain(
  holder: mupdf.PDFObject,
  key: string | number,
  kinds: ReadonlySet<string>,
  seen: Set<number>,
): number {
  const action = holder.get(key);
  if (!dictionary(action) || seenBefore(action, seen) || seen.size > MAX_WALK) return 0;
  let count = isOneOf(action, kinds) ? 1 : 0;
  const next = action.get('Next');
  if (next.isArray()) {
    for (let at = 0; at < next.length; at += 1) count += countInChain(next, at, kinds, seen);
  } else {
    count += countInChain(action, 'Next', kinds, seen);
  }
  return count;
}

/**
 * Removes every action of `kinds` from every place an action sits.
 *
 * **A walk per place**, where the count keeps one for the document: here `seen` only has to end a loop. Shared across
 * places, it would read an action a second link also runs as that link's loop back, and drop it from the second chain.
 */
function clearActions(document: mupdf.PDFDocument, places: ActionPlaces, kinds: ReadonlySet<string>): void {
  for (const [holder, key] of places.actions) clearChain(document, holder, key, kinds, new Set());
}

/** How many actions of `kinds` the document holds, over every place an action sits. */
function countActions(places: ActionPlaces, kinds: ReadonlySet<string>): number {
  const seen = new Set<number>();
  let count = 0;
  for (const [holder, key] of places.actions) count += countInChain(holder, key, kinds, seen);
  return count;
}

/** Whether an annotation is a file attachment, which carries its file in `/FS` rather than in the name tree. */
function isAttachment(annotation: mupdf.PDFObject): boolean {
  return String(annotation.get('Subtype')) === '/FileAttachment';
}

/**
 * Removes JavaScript and the automatic actions.
 *
 * **Every `/AA` goes whole**, unlike an `/A`: every entry in a trigger dictionary is a trigger — page open, page close,
 * field focus, a field's keystroke and format scripts — and none of them is content a reader follows, so there is
 * nothing in one to keep. An `/A` is read first, because on a link it is usually a `/URI`.
 */
function stripJavaScript(document: mupdf.PDFDocument): void {
  const places = actionPlaces(document);
  clearActions(document, places, RUNS);
  for (const holder of places.triggers) {
    if (!holder.get('AA').isNull()) holder.delete('AA');
  }
  const names = document.getTrailer().get('Root').get('Names');
  if (dictionary(names) && !names.get('JavaScript').isNull()) names.delete('JavaScript');
}

/**
 * Removes the attached files: the catalogue's name tree, every file attachment annotation, and every action that
 * opens one.
 *
 * **The attachment annotation goes through `deleteAnnotation`**, not out of `/Annots` by hand, so MuPDF's own list of
 * the page's annotations agrees with the dictionary — a flatten later in the same command bakes from that list, and a
 * stale entry there would draw the attachment's icon into the page it was removed from. MuPDF's reader hides links and
 * widgets, never an attachment, so this reader sees every one `/Annots` holds.
 */
function stripEmbeddedFiles(document: mupdf.PDFDocument): void {
  const names = document.getTrailer().get('Root').get('Names');
  if (dictionary(names) && !names.get('EmbeddedFiles').isNull()) names.delete('EmbeddedFiles');
  for (let index = 0; index < document.countPages(); index += 1) {
    const page = document.loadPage(index);
    for (const annotation of [...page.getAnnotations()]) {
      if (isAttachment(annotation.getObject())) page.deleteAnnotation(annotation);
    }
  }
  clearActions(document, actionPlaces(document), OPENS_ATTACHMENT);
}

/**
 * Removes the entries that reach OUTSIDE the document.
 *
 * `/XFA` is here rather than under flattening, and that is worth a sentence: an
 * XFA form is a second document in XML with its own submit targets, and a
 * reader that honours it ignores the `/AcroForm` fields a flatten would have
 * baked. Removing it is what makes the flattened page the whole truth.
 */
function stripExternalActions(document: mupdf.PDFDocument): void {
  const acroForm = document.getTrailer().get('Root').get('AcroForm');
  if (dictionary(acroForm) && !acroForm.get('XFA').isNull()) acroForm.delete('XFA');
  clearActions(document, actionPlaces(document), REACHES);
}

/**
 * Bakes annotations AND widgets into the page content.
 *
 * `bake(true, true)`. `flattenFormFields` bakes `(false, true)` — widgets only
 * — because that row is about forms; this one is about a document nothing can
 * change, so the annotations go in too.
 */
function flatten(document: mupdf.PDFDocument): void {
  document.bake(true, true);
}

/** Each part's own work, so a part added to the contract is a compile error. */
const STRIP: Readonly<Record<PdfSanitizePart, (document: mupdf.PDFDocument) => void>> = {
  javascript: stripJavaScript,
  'embedded-files': stripEmbeddedFiles,
  'external-actions': stripExternalActions,
  flatten,
};

/**
 * Runs the chosen parts, in the order the payload names them.
 *
 * **`withDocumentRemoving`**, which is what makes the next serialise collect —
 * without it every unlinked object is written back out and the JavaScript is
 * still in the file.
 */
export const applySanitizeDocument: Apply<'mupdf', 'sanitizeDocument'> = (session, command) =>
  withDocumentRemoving(session, (document) => {
    for (const part of command.parts) STRIP[part](document);
  });

/**
 * Reports that a sanitise's prior state is not recorded.
 *
 * `flattenFormFields`' reason, one step wider: this unlinks catalogue subtrees
 * whose size is the document's, and a flatten rewrites the content stream of
 * every page an annotation sat on. There is no bounded prior state, and the
 * checkpoint the bus mints is the whole of the undo.
 */
export const captureSanitizeDocument = (session: MupdfSession): Promise<CaptureResult<never>> =>
  withDocument(session, () => ({
    captured: false,
    reason:
      'a sanitised document cannot be recorded as prior state: the removals are catalogue ' +
      'subtrees whose size is the document’s, and flattening rewrites the content stream of ' +
      'every page an annotation sat on',
  }));

/** Refuses to invert, for {@link captureSanitizeDocument}'s reason. */
export const invertSanitizeDocument = (): never => {
  throw new Error(
    'sanitizeDocument is declared non-invertible. Undo restores the checkpoint.',
  );
};

/**
 * What a document still carries, for a caller that wants to check.
 *
 * **Exported for the proof and for nothing else today**, and that is stated
 * rather than left as an orphan: the case that matters reads a *saved*
 * document, so it needs a reader that walks the same places the stripper walks.
 * A reader written inside the test would be a second opinion about where
 * JavaScript lives in a PDF, agreeing with this module until one of them
 * learned a new place (B3a). Each count is what its part removes: `javascript`
 * counts the running actions, every holder of an `/AA` and the catalogue's
 * script tree; `external` the submitting actions and an XFA form; `embeddedFiles`
 * the catalogue's file tree, each attachment annotation and each action opening one.
 */
export function activeContentIn(document: mupdf.PDFDocument): {
  readonly javascript: number;
  readonly embeddedFiles: number;
  readonly external: number;
  readonly annotations: number;
} {
  const root = document.getTrailer().get('Root');
  const names = root.get('Names');
  const places = actionPlaces(document);

  let javascript = countActions(places, RUNS);
  const holders = new Set<number>();
  for (const holder of places.triggers) {
    if (!holder.get('AA').isNull() && !seenBefore(holder, holders)) javascript += 1;
  }
  if (dictionary(names) && !names.get('JavaScript').isNull()) javascript += 1;

  let external = countActions(places, REACHES);
  const acroForm = root.get('AcroForm');
  if (dictionary(acroForm) && !acroForm.get('XFA').isNull()) external += 1;

  let embeddedFiles = countActions(places, OPENS_ATTACHMENT);
  if (dictionary(names) && !names.get('EmbeddedFiles').isNull()) embeddedFiles += 1;

  let annotations = 0;
  for (let index = 0; index < document.countPages(); index += 1) {
    for (const object of annotationObjects(document.loadPage(index))) {
      annotations += 1;
      if (isAttachment(object)) embeddedFiles += 1;
    }
  }
  return { javascript, embeddedFiles, external, annotations };
}
