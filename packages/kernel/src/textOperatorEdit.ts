import { type CommandOfKind, blocksOfEdit } from '@monstera/contract/host';

import type { CaptureResult } from './commandLog.js';
import type { DrawnBoxes, Invert, MupdfSession } from './engineSeam.js';
import { editFaces, editFacesBound, loadEditFaces } from './editFaces.js';
import type { FaceSource } from './fontCatalogue.js';
import { withDocument } from './mupdfWriter.js';
import type { PageFont } from './pageFonts.js';
import { type OperatorRefusal, type PageRuns, checkOperatorEdit, editOperators } from './operatorEdit.js';
import { addPlainState, plainStateName } from './drawnObjectEdit.js';
import { pageContentStreams, xobjectKinds } from './pageContent.js';
import { pageFonts } from './pageFonts.js';
import { resourceDictionaryOf } from './pageResources.js';
import { BlockUnchangedError, EditRefusedError, TextNotWritableError } from './textEditRefusals.js';
import { sentAsShown } from './blockAsShown.js';
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
  // AN ARRANGE ITS NEW PLACE WOULD CROP is said in its own one line (ADR-0264 Decision 4), not the page's.
  if (refusal.reason === 'cropped') return new EditRefusedError('cropped', 0, 'the block would be cut off past the object it was arranged past');
  const detail =
    refusal.reason === 'numbering'
      ? refusal.detail
      : refusal.reason === 'unknown-width'
        ? `font ${refusal.font} states no width this edit needs`
        : `its text is set under transforms one inserted object cannot reproduce (${refusal.where})`;
  // `read-back` IS THE STEP THE OWNER'S ONE PLAIN LINE NAMES (R13, Q3): the rest of the page could not be kept, so it is
  // left as it was — the same refusal a PDFium read-back makes of such a page, from the writer that replaces it.
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
  // THE FACE WRITER ON FIRST NEED, by a literal `import()` as the host loads pdf-lib (ADR-0121 Decision 3): it brings
  // HarfBuzz, +6.4 MB of resident set at import (measured 2026-10-06, Node 22.22.0 on Linux, three runs against a control
  // that imports nothing), which every MuPDF host would otherwise pay at start against a 100 MB fixed-cost budget.
  // Loaded only when the page's own fonts cannot carry the edit and this process was given a catalogue.
  const needed = editFacesBound() && (await needsAFace(session, command, read));
  // THE CATALOGUE'S MODULE TOO, where the host bound its folders (`bindEditFolders`): it brings HarfBuzz as well.
  if (needed) await loadEditFaces();
  const faceSet = needed ? (await import('./operatorFaces.js')).OperatorFaceSet : null;
  return await withDocument(session, (document) => {
    const leaf = document.findPage(command.page);
    const content = joinedContent(pageContentStreams(leaf));
    const fonts = pageFonts(leaf);
    // THE RESOLVER'S FACES AND THE BOX (ADR-0177): read on the first word that needs one, so an edit the page's own
    // fonts carry never reads a font file.
    const faces = faceSet === null ? null : new faceSet(document, lazyFaces(), fonts);
    // WHAT AN ARRANGE NEEDS (ADR-0264): the page's XObjects, so a drawn neighbour is found, and a free name for the plain
    // graphics state, added below only where the edit names it.
    const plainState = plainStateName(leaf);
    const made = editOperators(content, fonts, read, blocksOfEdit(command), faces?.faces ?? null, command.fit, command.inserts ?? [], {
      kinds: xobjectKinds(leaf),
      plainState,
    });
    if (!made.ok) {
      const refusal = made.error;
      if (refusal.reason === 'needs-a-face') throw new TextNotWritableError(refusal.characters.join(''));
      // NOTHING TO WRITE, split by the PDFium writer's rule (ADR-0260): the words the page shows and nothing else is the
      // answer the editor closes on; anything else was a change none of which could be written, and the editor keeps it.
      if (refusal.reason === 'unchanged') {
        const shown = new Map(read.runs.map((run) => [run.index, run.text] as const));
        if ((command.inserts ?? []).length === 0 && sentAsShown(blocksOfEdit(command), (run) => shown.get(run))) {
          throw new BlockUnchangedError();
        }
        throw new EditRefusedError('set-text', 0, `an operator edit on page ${String(command.page)} asked for a change and wrote none of it`);
      }
      throw refusalOf(refusal);
    }
    const edit = made.value;
    const added = faces?.pageFonts ?? new Map<string, PageFont>();
    const structural = checkOperatorEdit(content, edit, new Map([...fonts, ...added]));
    if (!structural.ok) throw new EditRefusedError('read-back', 0, `the operator edit did not read back: ${structural.error}`);

    // THE ADDED FONTS FIRST, named in the page's own `/Font`, so the content written next names fonts that exist.
    const fontDictionary = added.size === 0 ? null : resourceDictionaryOf(document, leaf, 'Font');
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
      putBack(document, leaf, { before, stream, fontDictionary, names });
      throw new EditRefusedError('read-back', 0, `MuPDF's reading of the page does not hold ${String(missing.length)} edited block(s)`);
    }
    // THE PLAIN GRAPHICS STATE an arrange carried a block with, once the edit is kept (ADR-0264): a refusal above then adds
    // nothing the page would not use.
    if (edit.plain) addPlainState(document, leaf, plainState);
    // EVERY CHARACTER DRAWN AS THE BOX, uncapped: the host names the first ones and counts the rest at the pipe
    // (`cappedBoxes`), as the PDFium writer's apply does (ADR-0177 Decision 7).
    const boxed = (faces?.boxed ?? []).map((character) => ({ character, page: command.page }));
    // AND THE BLOCKS IT MOVED DOWN (ADR-0249), whose markup `main` moves with them.
    return { boxed, more: 0, moved: edit.moved };
  });
}

/**
 * The page as it was before a write MuPDF's reading refused: its old `/Contents`, the new stream deleted, and the fonts
 * the edit named removed from the page's `/Font`. A function of its own so the undoing can be proven by a case
 * (SSSSSSS-15): the branch that calls it is reached only when this module's structural check passes and MuPDF's
 * reading disagrees, and no input that does so is known.
 */
export function putBack(
  document: { deleteObject(object: unknown): void },
  leaf: { put(key: string, value: unknown): void },
  wrote: {
    readonly before: unknown;
    readonly stream: unknown;
    readonly fontDictionary: { delete(name: string): void } | null;
    readonly names: readonly string[];
  },
): void {
  leaf.put('Contents', wrote.before);
  document.deleteObject(wrote.stream);
  for (const name of wrote.names) wrote.fontDictionary?.delete(name);
}

/**
 * Whether the page's own fonts leave a word of this edit uncarried: `editOperators` with no faces, refusing for that
 * reason alone. A pure pass over the page's content, so asking twice changes nothing.
 */
function needsAFace(session: MupdfSession, command: CommandOfKind<'editTextOperators'>, read: PageRuns): Promise<boolean> {
  return withDocument(session, (document) => {
    const leaf = document.findPage(command.page);
    const made = editOperators(
      joinedContent(pageContentStreams(leaf)),
      pageFonts(leaf),
      read,
      blocksOfEdit(command),
      null,
      command.fit,
      command.inserts ?? [],
      // THE SAME ARRANGE the apply will make, so a block arranged past a picture is asked about as it will be written.
      { kinds: xobjectKinds(leaf), plainState: plainStateName(leaf) },
    );
    return !made.ok && made.error.reason === 'needs-a-face';
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
 * The checkpoint IS the undo for this command, by the owner's decision of 2026-10-06 (ADR-0176 Decision 7, corrected):
 * the whole-document copy the bus takes restores the page's content and the fonts the edit added and loses nothing an
 * inverse would have put back, so Decision 7's content-and-fonts prior is kept as the rejected alternative, not built.
 */
export const CHECKPOINTED = {
  captured: false,
  reason: 'an operator edit is undone by its checkpoint, the whole-document copy the owner chose over a recorded prior',
} as const satisfies CaptureResult<never>;

export function captureEditTextOperators(): Promise<CaptureResult<never>> {
  return Promise.resolve(CHECKPOINTED);
}

/** Unreachable, for `invertAddAnnotation`'s reason: a command that never captures has no inverse to apply. */
export const invertEditTextOperators: Invert<'mupdf', 'editTextOperators'> = (): Promise<void> => {
  throw new Error('an operator edit has no inverse; undo restores the checkpoint the bus took (ADR-0176 Decision 7, owner 2026-10-06)');
};
