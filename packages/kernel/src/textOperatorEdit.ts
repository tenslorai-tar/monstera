import { type CommandOfKind, blocksOfEdit } from '@monstera/contract/host';

import type { CaptureResult } from './commandLog.js';
import type { DrawnBoxes, Invert, MupdfSession } from './engineSeam.js';
import { editFaces, editFacesBound } from './editFaces.js';
import type { FaceSource } from './fontCatalogue.js';
import type { PDFDocument, PDFObject } from './mupdfRaw.js';
import { withDocument } from './mupdfWriter.js';
import { OperatorFaceSet } from './operatorFaces.js';
import type { PageFont } from './pageFonts.js';
import { type OperatorRefusal, type PageRuns, checkOperatorEdit, editOperators } from './operatorEdit.js';
import { pageContentStreams } from './pageContent.js';
import { pageFonts } from './pageFonts.js';
import { EditRefusedError, TextNotWritableError } from './textEditRefusals.js';
import { joinedContent } from './textOperators.js';

/**
 * `editTextOperators` in the MuPDF session
 * ([ADR-0176](../../../docs/DECISIONS/0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md)):
 * the page's own content stream, edited by `operatorEdit.ts`, written back as the page's one stream, and read back
 * twice before it is kept (Decision 6). Everything that decides what the bytes are is in `operatorEdit.ts`; this
 * module reads the page, writes the answer, and puts the page back as it came when either read-back fails.
 *
 * ## The page's streams become ONE stream
 *
 * The edit is made to the streams joined as ISO 32000 joins them, so the answer is one stream, and it replaces the
 * page's `/Contents` whether that was one stream or an array. The old streams stay in the file's history under an
 * incremental save and are referenced by nothing. Splitting the answer back into the old boundaries would be a second
 * opinion about where a token ends, which the join exists to make unnecessary.
 *
 * ## A refusal leaves the session as it came
 *
 * The session is live, so a refusal after the write would otherwise leave the edit in it. The old `/Contents` is put
 * back and the stream this added is deleted, so the document MuPDF holds is the one the command was handed.
 */

/** Why a refusal that is the page's, not the person's, was made: logged, never shown (the owner's sentence is). */
function refusalOf(refusal: Exclude<OperatorRefusal, { reason: 'needs-a-face' | 'unchanged' }>): EditRefusedError {
  const detail =
    refusal.reason === 'numbering'
      ? refusal.detail
      : refusal.reason === 'unknown-width'
        ? `font ${refusal.font} states no width this edit needs`
        : 'its text is set under transforms one inserted object cannot reproduce';
  // `read-back` IS THE STEP THE OWNER'S SENTENCE NAMES: *This page uses a font Monstera can't rewrite yet, so nothing
  // was changed* — the same refusal a PDFium read-back makes of such a page, from the writer that replaces it.
  return new EditRefusedError('read-back', 0, `the operator edit refused the page: ${detail}`);
}

/** The words MuPDF's own reading of the page holds, every white space removed, for a containment test. */
function squeezed(text: string): string {
  return text.replace(/\s/gu, '');
}

export async function applyEditTextOperators(
  session: MupdfSession,
  command: CommandOfKind<'editTextOperators'>,
  read: PageRuns,
): Promise<DrawnBoxes> {
  return await withDocument(session, (document) => {
    const leaf = document.findPage(command.page);
    const content = joinedContent(pageContentStreams(leaf));
    const fonts = pageFonts(leaf);
    // THE RESOLVER'S FACES AND THE BOX (ADR-0177), where this process was given a catalogue: read on the first word
    // that needs one, so an edit the page's own fonts carry never reads a font file.
    const faces = editFacesBound() ? new OperatorFaceSet(document, lazyFaces(), fonts) : null;
    const made = editOperators(content, fonts, read, blocksOfEdit(command), faces?.faces ?? null);
    if (!made.ok) {
      const refusal = made.error;
      if (refusal.reason === 'needs-a-face') throw new TextNotWritableError(refusal.characters.join(''));
      if (refusal.reason === 'unchanged') {
        throw new Error(`An operator edit on page ${String(command.page)} changed nothing, so nothing was written.`);
      }
      throw refusalOf(refusal);
    }
    const edit = made.value;
    const added = faces?.pageFonts ?? new Map<string, PageFont>();
    const structural = checkOperatorEdit(content, edit, new Map([...fonts, ...added]));
    if (!structural.ok) throw new EditRefusedError('read-back', 0, `the operator edit did not read back: ${structural.error}`);

    // THE ADDED FONTS FIRST, named in the page's own `/Font`, so the content written next names fonts that exist.
    const fontDictionary = added.size === 0 ? null : fontDictionaryOf(document, leaf);
    const names = faces === null || fontDictionary === null ? [] : faces.finish(fontDictionary);
    const before = leaf.get('Contents');
    const stream = document.addStream(edit.content, document.newDictionary());
    leaf.put('Contents', stream);
    // MuPDF'S OWN READING of the page as it now is, the second read-back: each block's words where the block was.
    // `clip=no` READS PAST THE PAGE'S EDGE. MuPDF's text device drops every glyph outside the page by default
    // (`FZ_STEXT_CLIP`, MuPDF 1.28.0), so a word wider than the page lost its end to the reading and the edit was
    // refused, where the owner's rule keeps the text and says it no longer fits (Q7). The question here is whether the
    // content holds the words, not whether they are on the page.
    const page = document.loadPage(command.page);
    const reading = squeezed(page.toStructuredText('clip=no').asText());
    const missing = edit.written.filter((words) => !reading.includes(squeezed(words)));
    if (missing.length > 0) {
      leaf.put('Contents', before);
      document.deleteObject(stream);
      for (const name of names) fontDictionary?.delete(name);
      throw new EditRefusedError('read-back', 0, `MuPDF's reading of the page does not hold ${String(missing.length)} edited block(s)`);
    }
    // EVERY CHARACTER DRAWN AS THE BOX, uncapped: the host names the first ones and counts the rest at the pipe
    // (`cappedBoxes`), as the PDFium writer's apply does (ADR-0177 Decision 7).
    const boxed = (faces?.boxed ?? []).map((character) => ({ character, page: command.page }));
    return { boxed, more: 0 };
  });
}

/** The bound catalogue, read when a word first asks for a face rather than when the edit begins. */
function lazyFaces(): FaceSource {
  let read: FaceSource | null = null;
  const source = (): FaceSource => {
    read ??= editFaces();
    if (read === null) throw new Error('an operator edit asked for the bundled fonts in a process given none');
    return read;
  };
  return {
    get faces() {
      return source().faces;
    },
    read: (path) => source().read(path),
  };
}

/**
 * The `/Font` dictionary the page's content names its fonts in: its own `/Resources`' or the one it inherits, made
 * where there is none. An inherited one is shared by the pages that inherit it, and a name added there is one those
 * pages' content never uses.
 */
function fontDictionaryOf(document: PDFDocument, leaf: PDFObject): PDFObject {
  let resources = leaf.getInheritable('Resources');
  if (!resources.isNull()) resources = resources.resolve();
  if (!resources.isDictionary()) {
    resources = document.newDictionary();
    leaf.put('Resources', resources);
  }
  let fonts = resources.get('Font');
  if (!fonts.isNull()) fonts = fonts.resolve();
  if (!fonts.isDictionary()) {
    fonts = document.newDictionary();
    resources.put('Font', fonts);
  }
  return fonts;
}

/**
 * Decision 7's prior is the page's content and the fonts the edit added, and it is not built yet: until it is, the
 * bus takes a checkpoint, which restores the whole document and loses nothing an inverse would have put back.
 */
export const CHECKPOINTED = {
  captured: false,
  reason: 'an operator edit is undone by its checkpoint until its prior (the page content and added fonts) is recorded',
} as const satisfies CaptureResult<never>;

export function captureEditTextOperators(): Promise<CaptureResult<never>> {
  return Promise.resolve(CHECKPOINTED);
}

/** Unreachable, for `invertAddAnnotation`'s reason: a command that never captures has no inverse to apply. */
export const invertEditTextOperators: Invert<'mupdf', 'editTextOperators'> = (): Promise<void> => {
  throw new Error('an operator edit has no inverse yet; undo restores the checkpoint the bus took (ADR-0176 Decision 7)');
};
