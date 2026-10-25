import { type CommandOfKind, blocksOfEdit } from '@monstera/contract/host';

import type { CaptureResult } from './commandLog.js';
import type { DrawnBoxes, Invert, MupdfSession } from './engineSeam.js';
import { editFaces, editFacesBound, loadEditFaces } from './editFaces.js';
import type { FaceSource } from './fontCatalogue.js';
import { withDocument } from './mupdfWriter.js';
import type { PageFont } from './pageFonts.js';
import { type OperatorRefusal, type PageRuns, checkOperatorEdit, editOperators, pageFontsAsRead } from './operatorEdit.js';
import { addPlainState, plainStateName } from './drawnObjectEdit.js';
import { pageContentStreams, xobjectKinds } from './pageContent.js';
import { type StandardFontTables, loadStandardFonts, pageFonts } from './pageFonts.js';
import { resourceDictionaryOf } from './pageResources.js';
import { BlockUnchangedError, EditRefusedError, TextNotWritableError } from './textEditRefusals.js';
import { sentAsShown } from './blockAsShown.js';
import { joinedContent } from './textOperators.js';
import { type FormPlacement, charactersDrawn, growFormBox, growFrames, ownPlacement, placementAt, unwrappedForm, wrappedForm } from './formText.js';
import type { PDFDocument, PDFObject } from './mupdfRaw.js';

/**
 * `editTextOperators` in the MuPDF session
 * ([ADR-0176](../../../docs/DECISIONS/0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md)):
 * the page's own content stream, edited by `operatorEdit.ts`, written back as the page's one stream, and read back twice.
 * Everything that decides what the bytes are is in `operatorEdit.ts`; this module reads the page, writes the answer, and
 * keeps it ([ADR-0270](../../../docs/DECISIONS/0270-edit-text-writes-what-the-person-typed-and-never-refuses-it.md), the
 * owner's *write what the person typed*): what either read-back finds is answered as a writer defect for the
 * diagnostics log (`noted`), never a refusal of the person's typing.
 *
 * ## The page's streams become ONE stream
 *
 * The edit is made to the streams joined as ISO 32000 joins them, so the answer is one stream, and it replaces the
 * page's `/Contents` whether that was one stream or an array. The old streams stay in the file's history under an
 * incremental save and are referenced by nothing. Splitting the answer back into the old boundaries would be a second
 * opinion about where a token ends, which the join exists to make unnecessary.
 *
 * ## A refusal is decided before anything is written
 *
 * The session is live. Every refusal left (the four stops of ADR-0270 Decision 4, a block with nothing to write) is the
 * writer's answer before the page is touched, so a refused edit leaves the document MuPDF holds as the command found it.
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

/** What MuPDF reads a glyph as when it cannot name it. */
const UNNAMED = '�';

/**
 * Whether MuPDF's reading of the page holds `words` unbroken, white space aside
 * ([ADR-0266](../../../docs/DECISIONS/0266-edit-text-writes-only-the-edited-blocks-own-instructions.md) Decision 4). A
 * character MuPDF reads as U+FFFD stands for any one character: it is MuPDF saying it cannot name a glyph, not a glyph
 * missing. Measured 2026-10-24 on the owner's document 2: a glyph PDFium reads as U+0019, which the edit sets again in
 * the run's own font with the run's own code, reads back from MuPDF as U+FFFD, and the edit was refused for it. AND ONE
 * IN THE WORDS stands for any one character MuPDF reads: a glyph whose text only PDFium's reading gave
 * (`asAnotherReaderMay`), which MuPDF names as it likes — U+F4BC where PDFium reads `=` and U+073C (the same document).
 */
export function readingHolds(reading: string, words: string): boolean {
  const page = Array.from(squeezed(reading));
  const wanted = Array.from(squeezed(words));
  if (wanted.length === 0) return true;
  for (let start = 0; start + wanted.length <= page.length; start += 1) {
    if (wanted.every((character, at) => page[start + at] === character || page[start + at] === UNNAMED || character === UNNAMED)) return true;
  }
  return false;
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
  // THE STANDARD-FONT TABLES the page's fonts are read with, on first need for the same reason: they bring pdf-lib.
  const standard = await loadStandardFonts();
  const needed = editFacesBound() && (await needsAFace(session, command, read, standard));
  // THE CATALOGUE'S MODULE TOO, where the host bound its folders (`bindEditFolders`): it brings HarfBuzz as well.
  if (needed) await loadEditFaces();
  const faceSet = needed ? (await import('./operatorFaces.js')).OperatorFaceSet : null;
  return await withDocument(session, (document) => {
    // THE CONTENT THE EDIT IS IN: the page's own, or a form's, made this placement's own first (ADR-0269 Decision 3).
    const target = targetOf(document, command, true);
    const { content, holder } = target;
    // THE PAGE'S FONTS AS PDFium READ THEM (`pageFontsAsRead`): a glyph the page draws with a code its font names no text
    // for is still the page's own font's to set, and the check below reads the same fonts.
    const fonts = pageFontsAsRead(pageFonts(holder, standard), content, read);
    // THE RESOLVER'S FACES AND THE BOX (ADR-0177): read on the first word that needs one, so an edit the page's own
    // fonts carry never reads a font file.
    const faces = faceSet === null ? null : new faceSet(document, lazyFaces(), fonts);
    // WHAT AN ARRANGE NEEDS (ADR-0264): the page's XObjects, so a drawn neighbour is found, and a free name for the plain
    // graphics state, added below only where the edit names it.
    const plainState = plainStateName(holder);
    const made = editOperators(content, fonts, read, blocksOfEdit(command), faces?.faces ?? null, command.fit, command.inserts ?? [], {
      kinds: xobjectKinds(holder),
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
    // THE WRITE IS KEPT WHATEVER THE CHECKS FIND (ADR-0270, the owner's *write what the person typed*): each still runs on
    // every write, and what it finds is a writer defect for the diagnostics log, never a refusal of the person's typing.
    const noted: string[] = [];
    const structural = checkOperatorEdit(content, edit, new Map([...fonts, ...added]));
    if (!structural.ok) noted.push(`page ${String(command.page)}: the structural read-back found ${structural.error}`);

    // THE ADDED FONTS FIRST, named in the `/Font` of the stream that names them, so the content written next names fonts
    // that exist.
    const fontDictionary = added.size === 0 ? null : resourceDictionaryOf(document, holder, 'Font');
    if (faces !== null && fontDictionary !== null) faces.finish(fontDictionary);
    target.write(edit.content);
    // MuPDF'S OWN READING of the page as it now is, the second read-back: each line whose words the edit set, unbroken
    // (ADR-0266 Decision 4), its difference noted and never a refusal (ADR-0270). Not the lines it left or carried: their
    // bytes are the page's, held byte for byte above. `clip=no` READS PAST THE PAGE'S EDGE: MuPDF's text device drops every
    // glyph outside the page by default (`FZ_STEXT_CLIP`, MuPDF 1.28.0), and the question here is whether the content
    // holds the words, not whether they are on the page.
    const page = document.loadPage(command.page);
    const reading = page.toStructuredText('clip=no').asText();
    const missing = edit.checked.filter((words) => !readingHolds(reading, words));
    if (missing.length > 0) noted.push(`page ${String(command.page)}: MuPDF's reading does not hold ${String(missing.length)} line(s) the edit set`);
    // THE PLAIN GRAPHICS STATE an arrange carried a block with (ADR-0264), since the edit is kept.
    if (edit.plain) addPlainState(document, holder, plainState);
    // EVERY CHARACTER DRAWN AS THE BOX, uncapped: the host names the first ones and counts the rest at the pipe
    // (`cappedBoxes`), as the PDFium writer's apply does (ADR-0177 Decision 7).
    const boxed = (faces?.boxed ?? []).map((character) => ({ character, page: command.page }));
    // AND THE BLOCKS IT MOVED DOWN (ADR-0249), whose markup `main` moves with them; and what its checks noted.
    return { boxed, more: 0, moved: edit.moved, noted };
  });
}

/**
 * Whether the page's own fonts leave a word of this edit uncarried: `editOperators` with no faces, refusing for that
 * reason alone. A pure pass over the page's content, so asking twice changes nothing.
 */
function needsAFace(session: MupdfSession, command: CommandOfKind<'editTextOperators'>, read: PageRuns, standard: StandardFontTables): Promise<boolean> {
  return withDocument(session, (document) => {
    // READ ONLY: the placement as it is, copied by nothing, since this pass writes nothing.
    const { content, holder } = targetOf(document, command, false);
    const made = editOperators(
      content,
      pageFontsAsRead(pageFonts(holder, standard), content, read),
      read,
      blocksOfEdit(command),
      null,
      command.fit,
      command.inserts ?? [],
      // THE SAME ARRANGE the apply will make, so a block arranged past a picture is asked about as it will be written.
      { kinds: xobjectKinds(holder), plainState: plainStateName(holder) },
    );
    return !made.ok && made.error.reason === 'needs-a-face';
  });
}

/**
 * Where an edit's operators are: the content `editOperators` reads, the object whose `/Resources` its names resolve in,
 * and how the edited content is written back. The page's own content and its leaf, or a form placement's content wrapped
 * as the page PDFium read it ([ADR-0269](../../../docs/DECISIONS/0269-text-inside-a-form-is-edited-in-the-forms-own-content.md)
 * Decision 2) and the form — or, for a form with no `/Resources` of its own, the stream it draws with, as a reader
 * resolves it.
 */
interface EditTarget {
  readonly content: Uint8Array;
  readonly holder: PDFObject;
  write(edited: Uint8Array): void;
}

/**
 * The {@link EditTarget} `command` names. `own` makes a form placement this placement's own first (`ownPlacement`), which
 * only the apply does.
 *
 * @throws where the command names a form the page no longer draws there: the document moved since the read
 */
function targetOf(document: PDFDocument, command: CommandOfKind<'editTextOperators'>, own: boolean): EditTarget {
  const leaf = document.findPage(command.page);
  if (command.form === undefined) {
    return {
      content: joinedContent(pageContentStreams(leaf)),
      holder: leaf,
      write: (edited) => {
        leaf.put('Contents', document.addStream(edited, document.newDictionary()));
      },
    };
  }
  const placement = own ? ownPlacement(document, command.page, command.form) : placementAt(leaf, command.form);
  if (placement === undefined) {
    throw new EditRefusedError('set-text', 0, `an operator edit names a form page ${String(command.page)} does not draw there`);
  }
  const wrapped = wrappedForm(placement);
  // OUTWARD TO THE FIRST STREAM THAT HAS `/Resources`, each placement's holder in turn, ending at the page's leaf.
  let holder = placement.form.resolve();
  let drawnBy: FormPlacement | undefined = placement;
  while (holder.get('Resources').isNull() && drawnBy !== undefined) {
    holder = drawnBy.holder;
    drawnBy = drawnBy.path.length > 1 ? placementAt(leaf, drawnBy.path.slice(0, -1)) : undefined;
  }
  return {
    content: wrapped.bytes,
    holder,
    write: (edited) => {
      const own = unwrappedForm(edited, wrapped);
      placement.form.writeStream(own);
      // AND ITS BOX AND ITS FRAMES, grown to hold what it now draws, or words wrapped past them are written and not shown
      // (ADR-0269's corrections of 2026-10-25). Read with the resources the content names, the added fonts among them.
      const characters = charactersDrawn(own, holder.getInheritable('Resources'));
      if (characters !== undefined) {
        growFormBox(placement.form, characters);
        growFrames(document, command.page, placement.path, characters);
      }
    },
  };
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
