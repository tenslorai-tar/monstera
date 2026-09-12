import type { PdfSanitizePart } from '@monstera/contract';
import type * as mupdf from 'mupdf';

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
 * Actions whose `/S` this build strips wherever it finds one.
 *
 * `/JavaScript` and `/Launch` run something; `/ImportData` and `/SubmitForm`
 * reach outside the document. **`/URI` and `/GoTo` are deliberately absent**: a
 * link a person clicks is content, and a sanitise that silently broke every
 * cross-reference and every web link would be taking away the document rather
 * than making it inert.
 */
const REMOVED_ACTIONS = new Set(['/JavaScript', '/Launch', '/ImportData', '/SubmitForm']);

/** Whether this action dictionary is one of {@link REMOVED_ACTIONS}. */
function isActive(action: mupdf.PDFObject): boolean {
  if (!dictionary(action)) return false;
  return REMOVED_ACTIONS.has(String(action.get('S')));
}

/**
 * Clears `key` from `holder` when the action under it is an active one.
 *
 * **It reads before it deletes**, rather than deleting unconditionally, because
 * `/A` on a link annotation is usually a `/URI` — the content case above. A
 * blanket delete would strip every link in the document under a command whose
 * name promises to remove active content.
 */
function clearActiveAction(holder: mupdf.PDFObject, key: string): void {
  const action = holder.get(key);
  if (isActive(action)) holder.delete(key);
}

/**
 * Clears an `/AA` additional-actions dictionary entirely.
 *
 * Unlike `/A`, **every entry in `/AA` is a trigger** — page open, page close,
 * field focus, mouse enter — and none of them is content a reader follows.
 * There is nothing here to keep, so this is the one place a key goes without
 * being read first.
 */
function clearTriggers(holder: mupdf.PDFObject): void {
  if (!holder.get('AA').isNull()) holder.delete('AA');
}

/** Removes the catalogue and per-page entries that carry JavaScript. */
function stripJavaScript(document: mupdf.PDFDocument): void {
  const root = document.getTrailer().get('Root');
  clearActiveAction(root, 'OpenAction');
  clearTriggers(root);
  const names = root.get('Names');
  if (dictionary(names) && !names.get('JavaScript').isNull()) names.delete('JavaScript');

  for (let index = 0; index < document.countPages(); index += 1) {
    const page = document.loadPage(index);
    clearTriggers(page.getObject());
    for (const object of annotationObjects(page)) {
      clearActiveAction(object, 'A');
      clearTriggers(object);
    }
  }
}

/** Removes the catalogue's embedded-file tree. */
function stripEmbeddedFiles(document: mupdf.PDFDocument): void {
  const names = document.getTrailer().get('Root').get('Names');
  if (dictionary(names) && !names.get('EmbeddedFiles').isNull()) names.delete('EmbeddedFiles');
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

  for (let index = 0; index < document.countPages(); index += 1) {
    for (const object of annotationObjects(document.loadPage(index))) {
      // The same read-before-delete as `stripJavaScript`: `/SubmitForm` and
      // `/ImportData` are in `REMOVED_ACTIONS` and `/URI` is not.
      clearActiveAction(object, 'A');
    }
  }
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
 * learned a new place (B3a).
 */
export function activeContentIn(document: mupdf.PDFDocument): {
  readonly javascript: number;
  readonly embeddedFiles: number;
  readonly external: number;
  readonly annotations: number;
} {
  const root = document.getTrailer().get('Root');
  const names = root.get('Names');
  let javascript = 0;
  let external = 0;
  let annotations = 0;

  if (isActive(root.get('OpenAction'))) javascript += 1;
  if (!root.get('AA').isNull()) javascript += 1;
  if (dictionary(names) && !names.get('JavaScript').isNull()) javascript += 1;

  const acroForm = root.get('AcroForm');
  if (dictionary(acroForm) && !acroForm.get('XFA').isNull()) external += 1;

  for (let index = 0; index < document.countPages(); index += 1) {
    const page = document.loadPage(index);
    if (!page.getObject().get('AA').isNull()) javascript += 1;
    for (const object of annotationObjects(page)) {
      annotations += 1;
      if (!object.get('AA').isNull()) javascript += 1;
      if (isActive(object.get('A'))) external += 1;
    }
  }

  const embeddedFiles =
    dictionary(names) && !names.get('EmbeddedFiles').isNull() ? 1 : 0;
  return { javascript, embeddedFiles, external, annotations };
}
