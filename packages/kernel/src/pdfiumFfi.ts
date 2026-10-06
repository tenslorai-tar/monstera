import {
  type BlockMark,
  type BlockMarkSet,
  type BlockPlace,
  MAX_BLOCK_FONTS,
  type PageInsert,
  type ParagraphProps,
} from '@monstera/contract/host';
import type { EditStep } from '@monstera/shared';
import koffi, { type KoffiFunc, type TypeObject } from 'koffi';

import { editFaces, editFacesBound } from './editFaces.js';
import { arabicForms, lettersOfForms } from './arabicForms.js';
import { drawnOrder, drawnRightToLeft, drewTheGlyphs, isBidirectional, logicalOf, readBackOf } from './bidiOrder.js';
import { resolveRuns } from './fontResolver.js';
import { type EditPiece, editPieces } from './editPieces.js';
import { inDrawingOrder } from './visualPieces.js';
import type { BoxedInEdit, ByteImage, EngineWriter, ImageSession, PdfiumSession } from './engineSeam.js';
import type { CatalogueFace, FaceSource } from './fontCatalogue.js';
import type { PageRuns } from './operatorEdit.js';
import { type FlowLine, type Measure, NO_MARK, planBlock } from './paragraphFlow.js';
import { type Alignment, blockShape, paragraphSpacing } from './paragraphShape.js';
import { type ProgramFace, faceOf, programFace } from './fontFace.js';
import { readFace } from './fontFaces.js';
import { BOX, boxFont } from './boxFont.js';
import { namedSubset } from './fontSubset.js';
import { type DrawnGlyph, runFontFor } from './runFont.js';
import { withoutSubsetTag } from './subsetName.js';
import { ShapingFace } from './textShaping.js';
import { PDFIUM_FONT_NAME_MAX } from './host/pdfiumChannels.js';
import { type RunBox, replacementsMovingTheirLine } from './replaceLineRule.js';
import { EditRefusedError, ReplaceMovesLineError, TextNotWritableError, unwritableCharacters } from './textEditRefusals.js';
import { type JoinedRun, joinRuns, membersOf } from './textRunJoin.js';

/**
 * The PDFium native boundary.
 *
 * ## Why this exists at all, when MuPDF is the structural writer of record
 *
 * `BUILD-PROMPT.md`:257 assigns **in-place text editing (line/run rewriting),
 * styled runs and HD render** to PDFium in both columns, and ADR-0006 kept that
 * row. MuPDF is not a second opinion about it: its own text API is extraction,
 * and rewriting a run through the page-tree writer would be re-encoding a
 * content stream this project does not own.
 *
 * ## It is told where the library is; it never decides
 *
 * `scripts/provision/pdfium.mjs` already owns *where `pdfium.dll` lives* —
 * `pdfiumLibrary(root)` is that answer — and a second answer here would be the
 * B3a defect this project has paid for three times. The kernel cannot import a
 * script, so the resolution stays with the caller that can: the host factory
 * passes a path in through {@link openPdfium}, and this module has no fallback,
 * no search and no default. A wrong path is then a loud failure at one call
 * site rather than a quiet disagreement between two resolvers.
 *
 * ## Not reachable from the barrel
 *
 * [ADR-0026](../../../docs/DECISIONS/0026-a-declaration-is-not-an-implementation.md)
 * clause 2 governs this file the moment `packages/kernel/src/index.ts` reaches
 * it, and `proof:kernelload` is what enforces it. Nothing here is exported from
 * the barrel: the host entry imports it directly, the way `mupdfWriter.js` is
 * reached, so importing the kernel from `main` still loads no native binding.
 */

/** PDFium's page-object type for text. `FPDFPageObj_GetType`'s answer. */
const TEXT_OBJECT = 1;

/**
 * `FPDFPageObj_GetType`'s answer for a Form XObject.
 *
 * Named beside {@link TEXT_OBJECT} rather than derived from `OBJECT_KINDS`
 * below: that array is a display order for a renderer, and a promotion keyed on
 * a name's position in a list somebody may reorder is a defect nothing would
 * catch — the walk would simply find no forms, which is what a page with none
 * also answers.
 */
const OBJECT_FORM = 5;

/** `FPDF_FONT_TRUETYPE`, the `font_type` `FPDFText_LoadFont` takes for a TrueType program (`fpdf_edit.h`). */
const FONT_TRUETYPE = 2;

/**
 * A bound C function, as this file is willing to describe one.
 *
 * koffi types its own `func()` as returning a callable whose result is `any`,
 * which is honest — a C signature is a **string** resolved at run time and there
 * is no declaration for TypeScript to read. `unknown` is the same honesty with
 * the propagation removed: every call below has to narrow before it can use the
 * answer, so a wrong signature surfaces at the boundary instead of travelling.
 *
 * **This is where B7's untypedness dies**, and it dies in ONE cast rather than a
 * file-level disable. `BUILD-PROMPT.md`:115 permits the file to carry one; it
 * does not require it, and a disable covering three hundred lines would also
 * cover the code that has nothing to do with the boundary.
 */
type Native = (...args: unknown[]) => unknown;

/** Everything bound at the boundary. */
interface Bound {
  readonly writeBlock: TypeObject;
  readonly initialise: Native;
  readonly lastError: Native;
  readonly loadDocument: Native;
  readonly closeDocument: Native;
  readonly pageCount: Native;
  readonly loadPage: Native;
  readonly closePage: Native;
  readonly newPage: Native;
  readonly deletePage: Native;
  readonly countObjects: Native;
  readonly getObject: Native;
  readonly objectType: Native;
  readonly setText: Native;
  readonly generateContent: Native;
  readonly saveAsCopy: Native;
  readonly loadTextPage: Native;
  readonly closeTextPage: Native;
  readonly countChars: Native;
  readonly getText: Native;
  readonly setCharcodes: Native;
  readonly textObjectText: Native;
  readonly charObject: Native;
  readonly charGenerated: Native;
  readonly charBox: Native;
  readonly looseCharBox: Native;
  readonly objectBounds: Native;
  readonly getMatrix: Native;
  readonly setMatrix: Native;
  readonly transform: Native;
  readonly getFillColour: Native;
  readonly setFillColour: Native;
  readonly getRenderMode: Native;
  readonly setRenderMode: Native;
  readonly getStrokeColour: Native;
  readonly setStrokeColour: Native;
  readonly getStrokeWidth: Native;
  readonly setStrokeWidth: Native;
  readonly newRect: Native;
  readonly setDrawMode: Native;
  readonly removeObject: Native;
  readonly destroyObject: Native;
  readonly countFormObjects: Native;
  readonly formObject: Native;
  readonly removeFormObject: Native;
  readonly insertObject: Native;
  readonly insertObjectAt: Native;
  readonly textFont: Native;
  readonly textFontSize: Native;
  readonly createTextObject: Native;
  readonly fontFlags: Native;
  readonly fontWeight: Native;
  readonly fontBaseName: Native;
  readonly fontIsEmbedded: Native;
  readonly fontData: Native;
  readonly fontAscent: Native;
  readonly fontDescent: Native;
  readonly glyphWidth: Native;
  readonly glyphPath: Native;
  readonly glyphPathSegments: Native;
  readonly glyphPathSegment: Native;
  readonly segmentPoint: Native;
  readonly loadStandardFont: Native;
  readonly loadFont: Native;
  readonly pageBox: Native;
  readonly closeFont: Native;
  readonly createBitmap: Native;
  readonly fillRect: Native;
  readonly renderPage: Native;
  readonly bitmapBuffer: Native;
  readonly bitmapStride: Native;
  readonly destroyBitmap: Native;
}

/**
 * The one place koffi's `any` stops, and it is an ASSERTION rather than a check.
 *
 * `library.func()` answers a callable typed `(...args: any[]) => any`, and `any`
 * is assignable in both directions — so declaring the parameter `KoffiFunc<Native>`
 * does not verify anything about the binding. What it does is put the conversion
 * at one named line instead of at nineteen call sites, so the file below can be
 * ordinary strict TypeScript and a reader has exactly one place to disbelieve.
 *
 * **B7's file-level disable turned out not to be needed here.** The founding
 * record anticipates one for this file (`BUILD-PROMPT.md`:115) because the koffi
 * edge is untypeable; it is permitted, not required, and koffi 3.1.5 ships types
 * good enough that the boundary carries no `any` keyword at all. What the
 * exception exists for is still true — nothing downstream of this line is
 * checked against a C declaration — and {@link numberFrom} is where each answer
 * is narrowed at the point it crosses.
 */
function native(bound: KoffiFunc<Native>): Native {
  return bound;
}

/** A C `int`-ish answer, narrowed at the boundary rather than trusted. */
function numberFrom(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`PDFium answered ${String(value)} where ${what} expects a number.`);
  }
  return value;
}

/**
 * A native call's refusal at `step`, carrying what `FPDF_GetLastError` answers NOW — so it is built at the point of
 * the refusal, before another call can overwrite the error (ADR-0169 Decision 3). `what` is this file's own sentence
 * about the call, never PDFium's words about the document.
 */
function refusedAt(step: EditStep, what: string): EditRefusedError {
  return new EditRefusedError(step, numberFrom(api().lastError(), 'FPDF_GetLastError'), what);
}

/**
 * The bound library, or `undefined` before {@link openPdfium} has run.
 *
 * Module state rather than a parameter threaded through every call, because
 * PDFium's own state is process-global: `FPDF_InitLibrary` initialises the
 * process, not a handle, and calling it twice is undefined. One binding per
 * process is what the C API actually offers, so modelling two would be a
 * fiction the type system would then have to defend.
 */
let bound: Bound | undefined;

/**
 * Binds `pdfium.dll` and initialises the library. Idempotent.
 *
 * @param libraryPath the absolute path the caller resolved. See the note above
 * on why this is a parameter and not a lookup.
 */
export function openPdfium(libraryPath: string): void {
  if (bound !== undefined) return;

  const library = koffi.load(libraryPath);

  // FPDF_FILEWRITE is a struct whose second field is a callback PDFium calls
  // once per block. It is the ONLY way FPDF_SaveAsCopy emits bytes — the public
  // API has no save-to-path — so the struct is part of the binding rather than
  // a detail of the save. The struct is REGISTERED and then named by string in
  // the signature below; koffi resolves it from its own type table.
  const writeBlock = koffi.proto(
    'int WriteBlockCallback(void *self, const void *data, unsigned long size)',
  );
  koffi.struct('FPDF_FILEWRITE', {
    version: 'int',
    WriteBlock: koffi.pointer(writeBlock),
  });

  // FS_MATRIX is passed and returned BY VALUE through a pointer, so koffi needs
  // the layout rather than six loose floats. Registered here beside
  // FPDF_FILEWRITE, and named by string in the signatures below, because
  // koffi resolves a struct from its own type table by name.
  koffi.struct('FS_MATRIX', {
    a: 'float',
    b: 'float',
    c: 'float',
    d: 'float',
    e: 'float',
    f: 'float',
  });
  // FS_RECTF, the same way, for the page's bounding box in its own coordinates — where a CropBox
  // origin is not zero, the page's left edge is not zero either.
  koffi.struct('FS_RECTF', { left: 'float', top: 'float', right: 'float', bottom: 'float' });

  const api: Bound = {
    writeBlock,
    initialise: native(library.func('void FPDF_InitLibrary()')),
    lastError: native(library.func('unsigned long FPDF_GetLastError()')),
    // THE 64-BIT LOAD, whose length is a `size_t` (CR-NAT-13). `FPDF_LoadMemDocument` takes an `int`, and koffi wraps
    // a number past 2^31 - 1 into one rather than refusing it — measured 2026-10-04 against libc's `abs`: 3 GiB
    // arrives as 1 GiB — so a document that large would be parsed from its first gigabyte as though that were all of
    // it. A document past `main`'s memory ceiling opens since ADR-0165, which makes that length reachable.
    loadDocument: native(
      library.func('void *FPDF_LoadMemDocument64(const void *data, size_t size, const char *password)'),
    ),
    closeDocument: native(library.func('void FPDF_CloseDocument(void *document)')),
    pageCount: native(library.func('int FPDF_GetPageCount(void *document)')),
    loadPage: native(library.func('void *FPDF_LoadPage(void *document, int index)')),
    closePage: native(library.func('void FPDF_ClosePage(void *page)')),
    // A SCRATCH PAGE for a block edit's font probes, appended and deleted within the edit (ADR-0097):
    // PDFium's text-page builder aborts on an object far outside its page, so a probe is read on a
    // blank page of its own rather than off the edge of the one being edited.
    newPage: native(library.func('void *FPDFPage_New(void *document, int index, double width, double height)')),
    deletePage: native(library.func('void FPDFPage_Delete(void *document, int index)')),
    countObjects: native(library.func('int FPDFPage_CountObjects(void *page)')),
    getObject: native(library.func('void *FPDFPage_GetObject(void *page, int index)')),
    objectType: native(library.func('int FPDFPageObj_GetType(void *object)')),
    setText: native(library.func('int FPDFText_SetText(void *object, const void *text)')),
    generateContent: native(library.func('int FPDFPage_GenerateContent(void *page)')),
    saveAsCopy: native(
      library.func('int FPDF_SaveAsCopy(void *document, FPDF_FILEWRITE *writer, int flags)'),
    ),
    loadTextPage: native(library.func('void *FPDFText_LoadPage(void *page)')),
    closeTextPage: native(library.func('void FPDFText_ClosePage(void *textPage)')),
    countChars: native(library.func('int FPDFText_CountChars(void *textPage)')),
    getText: native(
      library.func('int FPDFText_GetText(void *textPage, int start, int count, _Out_ uint16_t *buffer)'),
    ),
    // TEXT SET BY CODE, for a piece in a face we loaded: its codes are the subset's glyph ids, and `FPDFText_SetText`
    // draws a character past the BMP as code 0 (ADR-0173's correction, measured 2026-10-05).
    setCharcodes: native(library.func('int FPDFText_SetCharcodes(void *object, const uint32_t *codes, size_t count)')),
    // ONE OBJECT'S TEXT, and it needs the page's TEXT PAGE as well as the
    // object. That second parameter is why this is not the same read as
    // `getText` above with a range: PDFium answers a text object's own string
    // by looking it up in a text page it was given, and the mapping from an
    // object to a character range is not something the C API offers.
    //
    // The length is in BYTES, not characters, and the answer includes the
    // terminator — both differ from `FPDFText_GetText` beside it, which counts
    // characters and excludes it. Two conventions in one header, so each call
    // site narrows at the point it crosses rather than sharing a helper that
    // would have to hold both.
    textObjectText: native(
      library.func(
        'unsigned long FPDFTextObj_GetText(void *object, void *textPage, _Out_ uint16_t *buffer, unsigned long length)',
      ),
    ),
    // THE OBJECT A CHARACTER CAME FROM, which is the whole basis of line-level
    // editing ([ADR-0049](../../../docs/DECISIONS/0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md)).
    // It answers a `FPDF_PAGEOBJECT`, and the caller turns that into an INDEX by
    // comparing it against the objects `getObject` hands back — PDFium offers no
    // index for an object, so the address table is the only route and it is
    // built from this page's own objects, never assumed.
    //
    // Measured 2026-09-09: 40 of 45 characters resolve. The other five are
    // PDFium's GENERATED characters — spaces it believes are implied by spacing
    // rather than drawn — which belong to no object at all.
    charObject: native(
      library.func('void *FPDFText_GetTextObject(void *textPage, int index)'),
    ),
    // WHICH CHARACTERS PDFIUM INVENTED. Without it a generated space is a
    // character whose object lookup fails, and *this character belongs to no
    // object* and *the lookup is broken* are the same observation.
    charGenerated: native(library.func('int FPDFText_IsGenerated(void *textPage, int index)')),
    // ONE CHARACTER'S BOX, in page space. The grouping reads only the vertical
    // extent — `bottom` and `top` — because ADR-0049 groups by overlap and a
    // horizontal position decides nothing there.
    charBox: native(
      library.func(
        'int FPDFText_GetCharBox(void *textPage, int index, _Out_ double *left, _Out_ double *right, _Out_ double *bottom, _Out_ double *top)',
      ),
    ),
    // ONE CHARACTER'S ADVANCE, as a box from its origin across its width in the font, whatever its ink: where the next
    // character starts. `replaceLineRule.ts` measures a run's end by it, since ink ends differently letter by letter.
    looseCharBox: native(library.func('int FPDFText_GetLooseCharBox(void *textPage, int index, _Out_ FS_RECTF *rect)')),
    // ONE OBJECT'S BOX, in PAGE space and after its matrix — measured, and it is
    // what a surface draws a handle on. Note the parameter ORDER differs from
    // `charBox` above: left, bottom, right, top here against left, right,
    // bottom, top there. Two conventions in one header again, and getting it
    // wrong swaps a height for a width silently.
    objectBounds: native(
      library.func(
        'int FPDFPageObj_GetBounds(void *object, _Out_ float *left, _Out_ float *bottom, _Out_ float *right, _Out_ float *top)',
      ),
    ),
    // THE OBJECT'S OWN MATRIX, read so that it can be PUT BACK. That pair is the
    // whole inverse of a move or a scale: measured 2026-09-10, a `SetMatrix` of
    // the matrix read before a transform returns the bounds to exactly what they
    // were, which is a RESTORE and not an inverse computed from the intent
    // (ADR-0009 §3).
    getMatrix: native(library.func('int FPDFPageObj_GetMatrix(void *object, _Out_ FS_MATRIX *matrix)')),
    setMatrix: native(library.func('int FPDFPageObj_SetMatrix(void *object, const FS_MATRIX *matrix)')),
    // AND IT COMPOSES rather than replacing — measured the same day: two +30
    // translations moved an object 60. So a move is a transform of the identity
    // plus an offset, and nothing here has to read the existing matrix to
    // apply one.
    //
    // **A scale is about the PAGE's origin, not the object's.** Measured: a
    // rectangle at x=200..320 scaled by 2 landed at 400..640, off a 400pt page.
    // Anything that wants to scale an object in place composes the translation
    // itself; this binding is the raw call and says so.
    transform: native(
      library.func(
        'void FPDFPageObj_Transform(void *object, double a, double b, double c, double d, double e, double f)',
      ),
    ),
    // FILL COLOUR, and it answers for a TEXT object as well as a path —
    // measured, both returning 1 and both surviving a save and reopen. The row
    // says *any page object* and this is the call that makes that true.
    getFillColour: native(
      library.func(
        'int FPDFPageObj_GetFillColor(void *object, _Out_ unsigned int *r, _Out_ unsigned int *g, _Out_ unsigned int *b, _Out_ unsigned int *a)',
      ),
    ),
    setFillColour: native(
      library.func(
        'int FPDFPageObj_SetFillColor(void *object, unsigned int r, unsigned int g, unsigned int b, unsigned int a)',
      ),
    ),
    // HOW A TEXT OBJECT IS PAINTED (`Tr`), and the stroke a mode of 1 or 2 paints with: a line set again must be painted
    // as the line it replaces, or an invisible layer (mode 3, an OCR'd scan's words) becomes visible text over its own
    // picture, and outlined text loses its outline (ADR-0179's keep list).
    getRenderMode: native(library.func('int FPDFTextObj_GetTextRenderMode(void *object)')),
    setRenderMode: native(library.func('int FPDFTextObj_SetTextRenderMode(void *object, int mode)')),
    getStrokeColour: native(
      library.func(
        'int FPDFPageObj_GetStrokeColor(void *object, _Out_ unsigned int *r, _Out_ unsigned int *g, _Out_ unsigned int *b, _Out_ unsigned int *a)',
      ),
    ),
    setStrokeColour: native(
      library.func(
        'int FPDFPageObj_SetStrokeColor(void *object, unsigned int r, unsigned int g, unsigned int b, unsigned int a)',
      ),
    ),
    getStrokeWidth: native(library.func('int FPDFPageObj_GetStrokeWidth(void *object, _Out_ float *width)')),
    setStrokeWidth: native(library.func('int FPDFPageObj_SetStrokeWidth(void *object, float width)')),
    // A FILLED RECTANGLE, for the line under underlined words: a page has no underline of its own to set on text, so it is
    // what every producer draws (ADR-0180 Decision 4).
    newRect: native(library.func('void *FPDFPageObj_CreateNewRect(float x, float y, float w, float h)')),
    setDrawMode: native(library.func('int FPDFPath_SetDrawMode(void *path, int fillmode, int stroke)')),
    // REMOVE UNLINKS AND HANDS OWNERSHIP BACK; `FPDFPageObj_Destroy` is what
    // frees it. Calling the first without the second leaks the object for the
    // life of the process, and calling the second on an object still on a page
    // frees memory the page will use.
    removeObject: native(library.func('int FPDFPage_RemoveObject(void *page, void *object)')),
    destroyObject: native(library.func('void FPDFPageObj_Destroy(void *object)')),
    // THE FORM XOBJECT'S CONTENTS, and the three calls normalize-then-edit is
    // made of. `FPDFPage_GetObject` does not descend into a form — measured,
    // 36 of 60 characters on a fixture belonged to objects only these reach —
    // so a page whose text was pasted in as a block has nothing an editing
    // command can name.
    //
    // OWNERSHIP IS THE PART THE HEADER IS EXPLICIT ABOUT, and it is why the
    // promotion is expressible at all: `FPDFFormObj_RemoveObject` transfers the
    // child to the caller, and `FPDFPage_InsertObject` takes it. Neither copies,
    // so a child that is removed and not inserted is a leak and a child
    // inserted twice is a double free.
    countFormObjects: native(library.func('int FPDFFormObj_CountObjects(void *object)')),
    formObject: native(
      library.func('void *FPDFFormObj_GetObject(void *object, unsigned long index)'),
    ),
    removeFormObject: native(library.func('int FPDFFormObj_RemoveObject(void *form, void *object)')),
    insertObject: native(library.func('int FPDFPage_InsertObject(void *page, void *object)')),
    // AT A POSITION IN THE PAGE'S ORDER, which is the order generation writes and every reader
    // extracts text in. A line an edit makes goes right after the line it continues, or a page's
    // copied, searched and read-aloud text ends with its wrapped words — measured 2026-09-24 on a
    // live translation, whose continuation lines read after the page's last block.
    insertObjectAt: native(library.func('int FPDFPage_InsertObjectAtIndex(void *page, void *object, size_t index)')),
    // WHAT A BLOCK EDIT WRITES WITH ([ADR-0096](../../../docs/DECISIONS/0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md)).
    // A line that grows past its block needs a line the page did not have, in
    // the font of the run it continues — so the font is read off an existing
    // object and handed to `CreateTextObj`. Measured 2026-09-23
    // (`scripts/research/pdfiumReflow.mjs`): that pairing round-trips for 426 of
    // 457 corpus runs, and every one of these is exported by the pinned build.
    //
    // THE FONT HANDLE IS THE PAGE'S, not ours: `FPDFTextObj_GetFont` answers the
    // font the object already uses and nothing here closes it. `FPDFFont_Close`
    // is for fonts a caller LOADED, and closing a page's own font would free
    // what the document still draws with.
    textFont: native(library.func('void *FPDFTextObj_GetFont(void *object)')),
    // THE SIZE AS THE OBJECT STATES IT, before its matrix. The size the page
    // draws at is this times the matrix's scale, and that product is what an
    // editor over the page is set in.
    textFontSize: native(library.func('int FPDFTextObj_GetFontSize(void *object, _Out_ float *size)')),
    createTextObject: native(
      library.func('void *FPDFPageObj_CreateTextObj(void *document, void *font, float size)'),
    ),
    // THE FONT DESCRIPTOR'S FLAGS: bit 1 fixed pitch, bit 2 serif, bit 7
    // italic (ISO 32000 §9.8.2). The editor is set in a family of the same
    // KIND, because the page's own font cannot be loaded by the renderer.
    fontFlags: native(library.func('int FPDFFont_GetFlags(void *font)')),
    fontWeight: native(library.func('int FPDFFont_GetWeight(void *font)')),
    // THE BASE NAME, because a standard font's descriptor states no weight —
    // measured, Helvetica answers weight 0 — and `Helvetica-Bold` says it in
    // its name. The answer is bytes with a terminator, counted in bytes.
    fontBaseName: native(
      library.func('unsigned long FPDFFont_GetBaseFontName(void *font, _Out_ uint8_t *buffer, size_t length)'),
    ),
    // THE EMBEDDED PROGRAM, for the face it states about itself (`fontFace.ts`). Only where the font IS embedded:
    // for one that is not, `FPDFFont_GetFontData` answers the program of the substitute PDFium draws with, whose
    // weight is the substitute's and not the document's.
    fontIsEmbedded: native(library.func('int FPDFFont_GetIsEmbedded(void *font)')),
    fontData: native(
      library.func(
        'int FPDFFont_GetFontData(void *font, _Out_ uint8_t *buffer, size_t buflen, _Out_ size_t *outBuflen)',
      ),
    ),
    // ASCENT AND DESCENT AT A SIZE, which is a line's height in the font's own
    // metrics — the pitch a new line takes when its block has only one line to
    // measure a pitch from.
    fontAscent: native(library.func('int FPDFFont_GetAscent(void *font, float size, _Out_ float *ascent)')),
    fontDescent: native(library.func('int FPDFFont_GetDescent(void *font, float size, _Out_ float *descent)')),
    // WHAT PDFium DRAWS FOR A CHARACTER, the readings a run's font is checked against (ADR-0175). Both take a CODE POINT
    // where their header says "glyph", measured 2026-10-06: the path is in ems whatever the size, and the width in
    // thousandths at a size of 1000. The path is PDFium's, owned by the font, and freed with it.
    glyphWidth: native(
      library.func('int FPDFFont_GetGlyphWidth(void *font, uint32_t glyph, float size, _Out_ float *width)'),
    ),
    glyphPath: native(library.func('void *FPDFFont_GetGlyphPath(void *font, uint32_t glyph, float size)')),
    glyphPathSegments: native(library.func('int FPDFGlyphPath_CountGlyphSegments(void *path)')),
    glyphPathSegment: native(library.func('void *FPDFGlyphPath_GetGlyphPathSegment(void *path, int index)')),
    segmentPoint: native(library.func('int FPDFPathSegment_GetPoint(void *segment, _Out_ float *x, _Out_ float *y)')),
    // ONE OF THE FOURTEEN STANDARD FONTS, for a write the page's own font cannot
    // carry (ADR-0097). Loaded by name and never embedded — every conforming
    // reader supplies them. THIS handle IS ours, unlike `textFont`'s, so
    // `closeFont` releases it once the edit's objects hold their own references.
    loadStandardFont: native(library.func('void *FPDFText_LoadStandardFont(void *document, const char *font)')),
    // A FONT PROGRAM WE HAND IT, for a piece of an edit in the resolver's face (ADR-0173): a uniquely named subset,
    // loaded as a CID TrueType font (`FPDF_FONT_TRUETYPE`, `cid` 1). Ours to close, like a standard font.
    loadFont: native(
      library.func('void *FPDFText_LoadFont(void *document, const uint8_t *data, uint32_t size, int font_type, int cid)'),
    ),
    // THE PAGE'S BOX in page space — a one-line block's column is measured against it (ADR-0097).
    pageBox: native(library.func('int FPDF_GetPageBoundingBox(void *page, _Out_ FS_RECTF *rect)')),
    closeFont: native(library.func('void FPDFFont_Close(void *font)')),
    // THE RASTERISER, and it is the only part of this adapter a READER uses.
    // §6.1's setting, amended 2026-09-10: a second opinion about how a page
    // looks rather than a better one, the two engines having been measured at
    // 12.716 levels of mean difference over inked pixels.
    createBitmap: native(library.func('void *FPDFBitmap_Create(int width, int height, int alpha)')),
    fillRect: native(
      library.func(
        'void FPDFBitmap_FillRect(void *bitmap, int left, int top, int width, int height, unsigned long colour)',
      ),
    ),
    renderPage: native(
      library.func(
        'void FPDF_RenderPageBitmap(void *bitmap, void *page, int start_x, int start_y, int size_x, int size_y, int rotate, int flags)',
      ),
    ),
    bitmapBuffer: native(library.func('void *FPDFBitmap_GetBuffer(void *bitmap)')),
    // THE STRIDE IS BOUND because it is not the width. PDFium may pad a row for
    // alignment, and copying `width * 4` per row out of a `stride`-pitched
    // buffer shears the image progressively down the page — a rendering defect
    // in appearance and a copying one in fact.
    bitmapStride: native(library.func('int FPDFBitmap_GetStride(void *bitmap)')),
    destroyBitmap: native(library.func('void FPDFBitmap_Destroy(void *bitmap)')),
  };
  api.initialise();
  bound = api;
}

/** The bound library, or a named error rather than a `TypeError` on `undefined`. */
function api(): Bound {
  if (bound === undefined) {
    throw new Error(
      'PDFium has not been bound. The host that owns this adapter calls openPdfium() ' +
        'with the library path it resolved, before any session is opened.',
    );
  }
  return bound;
}

/** Whether the library has been bound in this process. */
export function pdfiumIsOpen(): boolean {
  return bound !== undefined;
}

/**
 * A live document, and **the bytes it is still reading**.
 *
 * ## `FPDF_LoadMemDocument64` DOES NOT COPY, and that is the hazard
 *
 * PDFium parses lazily: the buffer handed to `FPDF_LoadMemDocument64` must stay
 * valid and unmoved for the whole life of the document, and the API says so.
 * Node's garbage collector is free to collect a `Buffer` nothing references, and
 * koffi does not retain one on the caller's behalf — so a session that kept only
 * the pointer would work in every short test and fail when a collection landed
 * between two commands, which is the shape that reads as flakiness.
 *
 * So the bytes are held **beside** the document for exactly as long as it lives,
 * and dropped in `close`: PDFium reads the bytes for as long as the document is
 * open, and JavaScript's lifetime rules know nothing of that, so two owners of
 * one buffer agree only when this one is told explicitly.
 */
interface Live {
  readonly document: unknown;
  /** Retained for the document's lifetime. See above — this is not spare state. */
  readonly bytes: Buffer;
  /** What the document opened with, for the read-back's reopen of the bytes it saves (ADR-0171's addendum). */
  readonly password: string | undefined;
}

/**
 * The documents behind sessions this adapter opened.
 *
 * A `WeakMap` beside the token rather than a property on it, for
 * `mupdfWriter.ts`'s two reasons: `PdfiumSession` is structural, so
 * `{ engine: 'pdfium' }` satisfies it and a duck-typed check would hand a
 * fabricated object to a native call; and `close` deletes the entry, so closing
 * twice is a named error rather than a second `FPDF_CloseDocument` on freed
 * memory.
 */
const documents = new WeakMap<PdfiumSession, Live>();

/** The document behind a session this adapter opened and has not closed. */
function documentFor(session: PdfiumSession): unknown {
  const live = documents.get(session);
  if (live === undefined) {
    throw new Error(
      'This PDFium session was not produced by this adapter, or it has already been closed. ' +
        'Sessions are opened from the canonical bytes and are not transferable.',
    );
  }
  return live.document;
}

/**
 * Runs synchronous engine work as a promise, turning a **throw into a
 * rejection**.
 *
 * `mupdfWriter.ts`'s `promised`, and its reason applies unchanged: koffi's
 * binding is synchronous, the seam is async because other writers are not, and a
 * caller writing `.catch()` around a call that throws before returning a promise
 * does not catch it. Duplicated rather than shared because sharing it would put
 * a non-`import type` edge between the two adapters, and the module graph is
 * what keeps the native binding out of the barrel (ADR-0026).
 */
function promised<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/** A null-terminated UTF-16LE buffer, which is what `FPDF_WIDESTRING` is. */
function wideString(text: string): Buffer {
  const buffer = Buffer.alloc((text.length + 1) * 2);
  buffer.write(text, 'utf16le');
  return buffer;
}

/**
 * Runs `work` against a loaded page, closing it however `work` ends.
 *
 * The page is loaded and closed per call rather than cached. PDFium's page
 * handle holds the parsed page, and a cache here would be a second lifetime to
 * reason about beside the document's — the thing this file's `WeakMap` exists to
 * avoid having two of.
 */
function onPage<T>(session: PdfiumSession, page: number, work: (handle: unknown) => T): T {
  const bindings = api();
  const document = documentFor(session);
  const handle: unknown = bindings.loadPage(document, page);
  if (handle === null) throw refusedAt('page', `PDFium could not load page ${String(page)}`);
  try {
    return work(handle);
  } finally {
    bindings.closePage(handle);
  }
}

/** How many pages the session's document has. */
export function pageCount(session: PdfiumSession): Promise<number> {
  return promised(() =>
    numberFrom(api().pageCount(documentFor(session)), 'FPDF_GetPageCount'),
  );
}

/** How many drawable objects a page carries, text and otherwise. */
export function countObjects(session: PdfiumSession, page: number): Promise<number> {
  return promised(() =>
    onPage(session, page, (handle) =>
      numberFrom(api().countObjects(handle), 'FPDFPage_CountObjects'),
    ),
  );
}

/**
 * The indices of a page's **text** objects, in the page's own object order.
 *
 * Returned as indices rather than handles: a `FPDF_PAGEOBJECT` is owned by the
 * page it came from and is invalid once that page is closed, so handing one
 * across this module's boundary would export a dangling pointer as a value. An
 * index is stable for as long as nothing adds or removes an object, and every
 * caller here re-loads the page anyway.
 */
export function textObjectIndices(session: PdfiumSession, page: number): Promise<number[]> {
  return promised(() => onPage(session, page, (handle) => textObjectsOn(api(), handle)));
}

/** The page object indices of a loaded page's text objects, in order: {@link textObjectIndices}' walk, once. */
function textObjectsOn(bindings: Bound, handle: unknown): number[] {
  const total = numberFrom(bindings.countObjects(handle), 'FPDFPage_CountObjects');
  const found: number[] = [];
  for (let index = 0; index < total; index += 1) {
    const object: unknown = bindings.getObject(handle, index);
    if (object !== null && numberFrom(bindings.objectType(object), 'FPDFPageObj_GetType') === TEXT_OBJECT) {
      found.push(index);
    }
  }
  return found;
}

/**
 * The page's text, as PDFium's text page reads it.
 *
 * This is the WHOLE page rather than one object, because `FPDFText_GetText`
 * reads a character range off a text page and the mapping from an object to its
 * range is not something the C API offers. A caller that needs one run's text
 * has it from the edit it is about to make; a caller checking what a page says
 * wants all of it.
 */
export function pageText(session: PdfiumSession, page: number): Promise<string> {
  return promised(() =>
    onPage(session, page, (handle) => {
      const bindings = api();
      const textPage: unknown = bindings.loadTextPage(handle);
      if (textPage === null) throw refusedAt('page', 'PDFium could not load the page for text reading');
      try {
        const count = numberFrom(bindings.countChars(textPage), 'FPDFText_CountChars');
        if (count <= 0) return '';
        // One extra unit for the terminator FPDFText_GetText always writes.
        const buffer = new Uint16Array(count + 1);
        const written = numberFrom(
          bindings.getText(textPage, 0, count, buffer),
          'FPDFText_GetText',
        );
        // The count EXCLUDES the terminator, so slicing to `written - 1` is what
        // drops it. A caller comparing this against an expected string would
        // otherwise never match and would read as an encoding problem.
        return fromUtf16Units(buffer.subarray(0, Math.max(0, written - 1)));
      } finally {
        bindings.closeTextPage(textPage);
      }
    }),
  );
}

/**
 * The text one text object currently carries.
 *
 * ## Two conventions in one header, and this one is the odd half
 *
 * `FPDFTextObj_GetText` answers a length in **bytes** including the
 * terminator, where `FPDFText_GetText` beside it answers **characters**
 * excluding it. The two are read at their own call sites rather than through a
 * shared helper: a helper would have to carry both conventions and a caller
 * would then pick between them by reading a comment, which is the shape QQQ-3
 * is about.
 *
 * ## Sized by asking, never by guessing
 *
 * A null buffer makes PDFium answer the size it needs. Allocating a fixed
 * buffer and reading back whatever fits would silently truncate exactly the
 * long run an edit is most likely to be about — and the truncation would be
 * invisible, because a shorter string is what a shorter run also produces.
 *
 * @throws when the index is not a text object. The prior state of something
 * that is not text is not a string, and answering `''` for it would put an
 * empty prior in an undo log.
 */
export function textObjectText(
  session: PdfiumSession,
  page: number,
  index: number,
): Promise<string> {
  return promised(() =>
    onPage(session, page, (handle) => {
      const bindings = api();
      const object = textObjectAt(bindings, handle, page, index);
      const textPage: unknown = bindings.loadTextPage(handle);
      if (textPage === null) throw refusedAt('page', 'PDFium could not load the page for text reading');
      try {
        return objectTextOn(bindings, object, textPage);
      } finally {
        bindings.closeTextPage(textPage);
      }
    }),
  );
}

/**
 * What each of `objects` DRAWS on a text page — its characters, with the ones the text page
 * GENERATED left out. The read-back of an edit, in one pass over the page's characters.
 *
 * ## Why not {@link objectTextOn}
 *
 * `FPDFTextObj_GetText` answers an object's characters as the text page assigns them, and the
 * text page attributes a space it generates between two runs to the run before it. So a line an
 * edit lays out beside other text reads back with a trailing space it was never given — measured
 * 2026-09-24 on a live translation, a new line written `prochaine` read `prochaine ` once the next
 * block sat after it — and a correct write was refused. `FPDFText_IsGenerated` says which
 * characters those are; the question the read-back asks is whether the FONT carried what was
 * written, and a generated space is no font's answer.
 */
function drawnTextOn(bindings: Bound, textPage: unknown, objects: readonly unknown[]): readonly string[] {
  const slot = new Map(objects.map((object, at) => [String(koffi.address(object)), at]));
  const texts = objects.map(() => '');
  const chars = numberFrom(bindings.countChars(textPage), 'FPDFText_CountChars');
  for (let at = 0; at < chars; at += 1) {
    if (numberFrom(bindings.charGenerated(textPage, at), 'FPDFText_IsGenerated') === 1) continue;
    const index = slot.get(String(koffi.address(bindings.charObject(textPage, at))));
    if (index === undefined) continue;
    texts[index] = `${texts[index] ?? ''}${characterAt(bindings, textPage, at)}`;
  }
  return texts;
}

/**
 * The text page's UTF-16 unit at `at` — the one way a page's text is read one index at a time.
 *
 * ONE UNIT, AND THAT READS A CHARACTER PAST THE BMP WHOLE: measured 2026-10-05 on PDFium 155.0.8044.0's Linux build, a
 * text page indexes U+10140 set by glyph id as TWO characters, `D800` then `DD40`, from `FPDFText_GetText` and
 * `FPDFText_GetUnicode` alike, so the units read in order are the character (ADR-0173's correction, its note on
 * Decision 8).
 */
function characterAt(bindings: Bound, textPage: unknown, at: number): string {
  const buffer = new Uint16Array(2);
  numberFrom(bindings.getText(textPage, at, 1, buffer), 'FPDFText_GetText');
  return String.fromCharCode(buffer[0] ?? 0);
}

/**
 * What a text page reports for an object that draws `text` — the only form a read-back can be
 * compared in.
 *
 * Measured 2026-09-24 (`FPDFText_GetUnicode` over one object on a blank page): two spaces read as
 * ONE, and an object of spaces alone reads as nothing; a single leading or trailing space is kept.
 * So `…org  Plot 14`, a real document's own spacing, read back `…org Plot 14`, and a font that
 * carried it was refused. Compared raw, a read-back is testing the text page's whitespace rule
 * rather than the font; compared through this, it tests the font.
 */
function asTextPageReads(text: string): string {
  const collapsed = text.replace(/ {2,}/gu, ' ');
  return collapsed.trim() === '' ? '' : collapsed;
}

/**
 * The writes a live read-back did not give back, as the pairs {@link unwritableCharacters} names characters from: the
 * ONE comparison both read-backs make (B3a). Exact for text that runs left to right; for text with right-to-left
 * characters, by glyph, because a text page reads such an object in the direction of the line it stands in
 * ({@link drewTheGlyphs}).
 */
function misreadWrites(
  said: readonly string[],
  drawn: readonly string[],
): { readonly written: string; readonly read: string }[] {
  return said
    .map((text, at) => ({ written: asTextPageReads(text), read: drawn[at] ?? '' }))
    .filter(({ written, read }) => written !== read && !drewTheGlyphs(written, read));
}

/** One object's own string, read through a text page the caller holds. */
function objectTextOn(bindings: Bound, object: unknown, textPage: unknown): string {
  const bytes = numberFrom(bindings.textObjectText(object, textPage, null, 0), 'FPDFTextObj_GetText');
  // TWO BYTES IS THE TERMINATOR ALONE, which is what an object carrying no text
  // answers. Returning '' for it is right; allocating a zero-length buffer and
  // calling again is not, and PDFium's own refusal for that case is not
  // documented.
  if (bytes <= 2) return '';
  const buffer = new Uint16Array(bytes / 2);
  const written = numberFrom(
    bindings.textObjectText(object, textPage, buffer, bytes),
    'FPDFTextObj_GetText',
  );
  // `written` is bytes and includes the terminator, so the character count is
  // one short of half of it.
  return fromUtf16Units(buffer.subarray(0, Math.max(0, written / 2 - 1)));
}

/** How many UTF-16 units one `String.fromCharCode` call is handed: far under the limit, and few calls per page. */
const UTF16_CHUNK = 8192;

/**
 * PDFium's UTF-16 units as a string, unit for unit (CR-NAT-14).
 *
 * IN CHUNKS, because a spread passes one argument per unit and V8 refuses past its limit: measured 2026-10-04 on Node
 * 22.22, 125 000 units read and 150 000 threw `RangeError: Maximum call stack size exceeded`, so a dense page's text
 * failed whole. NOT a `TextDecoder`, which replaces a lone surrogate with U+FFFD: PDFium answers what the page's
 * encoding maps to, and a reader comparing that must get it unchanged.
 */
function fromUtf16Units(units: Uint16Array): string {
  let text = '';
  for (let at = 0; at < units.length; at += UTF16_CHUNK) {
    text += String.fromCharCode(...units.subarray(at, at + UTF16_CHUNK));
  }
  return text;
}

/**
 * How a run is set, as far as an editor drawn over it needs to know.
 *
 * ## Only what the renderer can USE, because the page's font program cannot travel
 *
 * The renderer cannot load the document's embedded program — it would be a
 * second parser of the document's bytes. It draws a run in a font the host
 * rebuilt and checked where there is one (ADR-0175, `document.runFonts`), and
 * otherwise in a family of the same KIND. These are the facts that choose the kind: the font descriptor's own flags,
 * its weight, and whether its name says bold. The size is the size the page
 * DRAWS at, the object's font size times its matrix's scale, which is what the
 * editor must match to sit over the words.
 */
export interface RunStyle {
  /** The size the run is drawn at, in points: font size times the matrix's scale. */
  readonly size: number;
  /** The fill colour its glyphs are painted in, 0–255 per channel. */
  readonly colour: { readonly r: number; readonly g: number; readonly b: number };
  /**
   * The font's base name, as PDFium answers it — which font the run is set in, for the block grouping's *a change of
   * font starts a new block* (`textLines.ts`). It never reaches a renderer, and nor does the font's program: what the
   * editor draws a run in is a font the host rebuilds from that program's checked glyphs, read on its own channel
   * (`runFont`, ADR-0175).
   */
  readonly font: string;
  /** Font descriptor flag 2 — a serif face. */
  readonly serif: boolean;
  /** Font descriptor flag 1 — fixed pitch. */
  readonly mono: boolean;
  /** Italic or oblique, from the embedded program, else the descriptor, else the name (`fontFace.ts`). */
  readonly italic: boolean;
  /** Weight 600 or more, from the embedded program, else the descriptor, else the name (`fontFace.ts`). */
  readonly bold: boolean;
  /**
   * Whether the run is set straight — no rotation, no skew, no mirror.
   *
   * An edit over rotated text cannot be placed where the words are, so a block
   * that holds any run that is not upright is not offered for editing in place.
   */
  readonly upright: boolean;
}

/**
 * One text object as the editor sees it: which object, what it says, where it
 * sits, and how it is set.
 *
 * ## The whole box, since 2026-09-23
 *
 * This carried the vertical extent alone while
 * [ADR-0049](../../../docs/DECISIONS/0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md)'s
 * grouping was its only reader and a dialog its only consumer. Text is now
 * edited in place ([ADR-0096](../../../docs/DECISIONS/0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md)):
 * a block is lines split at gaps wider than the line is tall, and outlined on
 * the page — so the horizontal extent now decides something, and it travels for
 * that and for placing the editor.
 */
export interface TextRun {
  /** The object's index in the page's object order. `textObjectIndices`' unit. The FIRST object of a joined run. */
  readonly index: number;
  /**
   * The run's last object: `index` for a run of one object, later for glyph objects joined into one run
   * (`textRunJoin.ts`, ADR-0130). A run names objects `index` to `last`, and an edit naming the run is applied to all.
   */
  readonly last: number;
  /**
   * What it currently says, WITH the spaces PDFium infers between its words.
   *
   * A document that positions its words by spacing rather than with a space
   * character reads, character by character, as `HelloWorld`. PDFium generates
   * the space it believes is implied, and a person editing the line must see
   * it; see {@link textRuns} for which generated characters are kept.
   */
  readonly text: string;
  /** The left of its characters, in PDF user space. */
  readonly left: number;
  /** The right of its characters, in PDF user space. */
  readonly right: number;
  /** The bottom of its characters, in PDF user space. */
  readonly bottom: number;
  /** The top of its characters, in PDF user space. */
  readonly top: number;
  readonly style: RunStyle;
}

/**
 * A page's editable text, and how much of its text is NOT editable.
 *
 * ## The second field exists because the first one used to lie by omission
 *
 * `textRuns` maps each character to its page object and skips the ones it
 * cannot place. Until 2026-09-10 that skip was silent, and the case it silently
 * dropped is not rare: **text inside a Form XObject**, which is how Office and
 * InDesign emit it.
 *
 * Measured (`scripts/research/pdfiumXObjects.mjs`, PDFium 155.0.8044.0): a page
 * with one ordinary run and one embedded page reports **two** objects to
 * `FPDFPage_GetObject` — a text object and a `form` — while `FPDFText` extracts
 * all sixty characters. Thirty-six of them belong to objects **inside** the
 * form, reachable only through `FPDFFormObj_GetObject` and absent from the walk
 * every editing command names. So the words are findable and unaddressable at
 * once, and a chooser built on runs alone offers a page that looks half empty
 * with nothing saying why.
 *
 * ## And the cheap way out does not work, which is also measured
 *
 * `FPDFText_SetText` on a nested object obtained through
 * `FPDFFormObj_GetObject` returns **1**, `FPDFPage_GenerateContent` returns
 * **1**, and the edit is **absent from the reopened bytes** — the page's stream
 * is regenerated and the XObject's own stream is not. Two successful return
 * values and no effect, which is why `BUILD-PROMPT.md`:278's *normalize-then-edit*
 * is the route rather than a deeper walk.
 *
 * This count is what makes that state visible while the promotion is unbuilt.
 * It is a CHARACTER count rather than a run count, because the runs it would
 * have counted are exactly the ones that could not be formed.
 */
export interface PageText {
  readonly runs: readonly TextRun[];
  /**
   * Characters PDFium extracted whose object this page's walk does not contain.
   *
   * Zero for every document whose text is drawn directly on the page. Non-zero
   * means *there is text here no command can name*, and a surface owes the
   * reader that sentence.
   */
  readonly unaddressable: number;
}

/**
 * Every text run on a page, with its text and its vertical extent.
 *
 * ## The extent comes from the CHARACTERS, not from the object's bounds
 *
 * `FPDFPageObj_GetBounds` answers the object's box, which for a text object
 * includes the font's ascent and descent whether or not any glyph in this run
 * reaches them — so two runs set in different sizes on one baseline have boxes
 * that overlap generously and two runs on adjacent lines can too. The
 * characters' own boxes are what a reader sees, and `FPDFText_GetCharBox` is
 * PDFium's answer for them.
 *
 * ## Which characters belong to which object is PDFium's answer, not a guess
 *
 * `FPDFText_GetTextObject` maps a character to its `FPDF_PAGEOBJECT`, and the
 * index comes from comparing that against this page's own objects. **PDFium
 * offers no index for an object**, so the address table below is the only
 * route — and it is built from `FPDFPage_GetObject` rather than assumed to
 * match content-stream order.
 *
 * ## Generated characters: a SPACE between two drawn characters on one line is kept
 *
 * A character PDFium **generated** belongs to no object — without
 * `FPDFText_IsGenerated`, *this character belongs to nothing* and *the lookup
 * is broken* would be the same observation, which is audit item 4b's shape
 * inside a mapping. Until 2026-09-23 every generated character was skipped, and
 * that was right for a dialog listing lines and wrong for an editor: a document
 * that spaces its words by position reads as `HelloWorld`, and a person editing
 * it in place would be shown words that are not on the page.
 *
 * So a generated SPACE is attributed to the run of the drawn character before
 * it, when the next drawn character follows on the same line. Generated line
 * breaks — PDFium's `\r\n` between lines — are dropped, because a line break is
 * the grouping's to decide, and a space before one is dropped with it. When a
 * run carrying such a space is rewritten, the space is written as a character,
 * which is what keeps the words apart once the spacing that implied it is gone.
 *
 * ## One text page for the whole walk
 *
 * `textObjectText` loads a text page per object, which is right for one object
 * and quadratic for a page of them. This walks the characters once.
 */
export function textRuns(session: PdfiumSession, page: number): Promise<PageText> {
  return promised(() =>
    onPage(session, page, (handle) => {
      const bindings = api();
      const walked = walkRuns(bindings, handle);
      // THE MEMBERS STAY HERE: the wire names a run by its first and last object, and the edit recomputes the rest.
      const runs = joinedWalk(bindings, handle, walked).map(({ members: _members, ...run }) => run);
      return { runs, unaddressable: walked.unaddressable };
    }),
  );
}

/**
 * The page's joined runs WITH their members, and its text objects' page indices: what ADR-0176's writer needs to find
 * in a content stream the objects a run is (its 2026-10-06 correction, the `pageRuns` pre-read).
 *
 * {@link textRuns}' walk and join, the same calls, so the runs the writer is handed are the runs the editor named
 * (B3a); only the members, which the editor's wire leaves here, and the text object list are added. No style: the
 * writer reads each run's state from its own operators.
 */
export function pageRuns(session: PdfiumSession, page: number): Promise<PageRuns> {
  return promised(() =>
    onPage(session, page, (handle) => {
      const bindings = api();
      const runs = joinedWalk(bindings, handle, walkRuns(bindings, handle)).map(
        ({ index, members, text, left, right, bottom, top }) => ({ index, members, text, left, right, bottom, top }),
      );
      return { textObjects: textObjectsOn(bindings, handle), runs };
    }),
  );
}

/**
 * Every text object's run on a page, NOT joined: one run per object, `last` equal to `index`.
 *
 * For a writer that works object by object — replace-all writes each object's own text back into that object, and an
 * occurrence split across two objects is left alone on purpose. Joined runs there would write a run's whole text into
 * its first object: measured 2026-10-01 when the join first went in, `proof:pdfiumcommand`'s split occurrence came out
 * as *"GADGET GET"*. The editor reads {@link textRuns}; this is the other reading, named so neither is taken for the
 * other.
 */
export function objectRuns(session: PdfiumSession, page: number): Promise<PageText> {
  return promised(() =>
    onPage(session, page, (handle) => {
      const bindings = api();
      const walked = walkRuns(bindings, handle);
      const programs = new Map<string, ProgramFace | undefined>();
      return {
        runs: [...walked.runs.entries()].map(([index, run]) => ({
          index,
          last: index,
          ...run,
          style: styleOf(bindings, bindings.getObject(handle, index), programs),
        })),
        unaddressable: walked.unaddressable,
      };
    }),
  );
}

/**
 * The walk's runs with their styles, JOINED (`textRunJoin.ts`, ADR-0130): the one answer both {@link textRuns} and an
 * edit's layout take, so the run a person is shown and the objects an edit writes are one join's answer.
 */
function joinedWalk(
  bindings: Bound,
  handle: unknown,
  walked: { readonly runs: ReadonlyMap<number, WalkedRun> },
): JoinedRun<RunStyle>[] {
  const programs = new Map<string, ProgramFace | undefined>();
  return joinRuns(
    [...walked.runs.entries()].map(([index, run]) => ({
      index,
      ...run,
      style: styleOf(bindings, bindings.getObject(handle, index), programs),
    })),
  );
}

/** One run as the walk accumulates it: text and the union of its characters' boxes. */
interface WalkedRun {
  text: string;
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/**
 * The walk {@link textRuns} answers from, on a page already loaded — shared with
 * {@link editTextBlocks}, which must read a line's text exactly as the person
 * was shown it before it diffs what they typed against it. Two walks would be
 * two opinions about which character belongs to which object.
 */
function walkRuns(
  bindings: Bound,
  handle: unknown,
): {
  readonly runs: ReadonlyMap<number, WalkedRun>;
  readonly unaddressable: number;
  /**
   * Where each run's last ADVANCE ends, by object index: the furthest right edge of its characters' loose boxes, which
   * is where text after it starts. A run's `right` is its ink's, and two strings of one width end their ink at
   * different places (measured: `WID` and `WDI` in Helvetica). Beside the runs rather than in them, since a run is
   * spread into what crosses the host's pipe and this is the line rule's alone.
   */
  readonly ends: ReadonlyMap<number, number>;
} {
  const textPage: unknown = bindings.loadTextPage(handle);
  if (textPage === null) throw refusedAt('page', 'PDFium could not load the page for text reading');
  try {
    const objects = numberFrom(bindings.countObjects(handle), 'FPDFPage_CountObjects');
    /** Address -> index, from this page's own objects. */
    const indexOf = new Map<string, number>();
    for (let at = 0; at < objects; at += 1) {
      indexOf.set(String(koffi.address(bindings.getObject(handle, at))), at);
    }

    const chars = numberFrom(bindings.countChars(textPage), 'FPDFText_CountChars');
    /** index -> the run being accumulated. Insertion order is reading order. */
    const runs = new Map<number, WalkedRun>();
    const ends = new Map<number, number>();
    let unaddressable = 0;
    /** The run the last DRAWN character joined, for a generated space to follow. */
    let previous: WalkedRun | undefined;
    /** Generated characters seen since the last drawn one. */
    let pending = '';

    for (let at = 0; at < chars; at += 1) {
      const character = characterAt(bindings, textPage, at);

      if (numberFrom(bindings.charGenerated(textPage, at), 'FPDFText_IsGenerated') === 1) {
        pending += character;
        continue;
      }
      const index = indexOf.get(String(koffi.address(bindings.charObject(textPage, at))));
      // COUNTED, NOT DROPPED IN SILENCE. A character whose object is not in this
      // page's walk is real text a person can see and no command can name — see
      // {@link PageText.unaddressable}, and the measurement that put this line
      // here.
      if (index === undefined) {
        unaddressable += 1;
        pending = '';
        continue;
      }
      // THE PENDING SPACE, resolved now that the next drawn character is known:
      // kept only when no generated line break came between them.
      if (previous !== undefined && pending.includes(' ') && !/[\r\n]/u.test(pending)) {
        previous.text += ' ';
      }
      pending = '';

      const left = [0];
      const right = [0];
      const bottom = [0];
      const top = [0];
      numberFrom(bindings.charBox(textPage, at, left, right, bottom, top), 'FPDFText_GetCharBox');
      const [x0 = 0] = left;
      const [x1 = 0] = right;
      const [low = 0] = bottom;
      const [high = 0] = top;
      // A CHARACTER WITH NO INK HAS NO BOX to add — a drawn space answers a
      // degenerate one, and a union taking it would pull a run's extent to
      // wherever PDFium put the empty rectangle.
      const inked = x1 > x0 || high > low;

      let held = runs.get(index);
      if (held === undefined) {
        held = {
          text: '',
          left: Number.POSITIVE_INFINITY,
          right: Number.NEGATIVE_INFINITY,
          bottom: Number.POSITIVE_INFINITY,
          top: Number.NEGATIVE_INFINITY,
        };
        runs.set(index, held);
      }
      held.text += character;
      const loose: Record<string, number> = {};
      if (numberFrom(bindings.looseCharBox(textPage, at, loose), 'FPDFText_GetLooseCharBox') === 1) {
        ends.set(index, Math.max(ends.get(index) ?? Number.NEGATIVE_INFINITY, loose['right'] ?? Number.NEGATIVE_INFINITY));
      }
      // THE UNION, so a run's extent covers every character in it. A run sized
      // from its first character alone would lose an ascender and stop
      // overlapping the neighbour it shares a line with.
      if (inked) {
        held.left = Math.min(held.left, x0);
        held.right = Math.max(held.right, x1);
        held.bottom = Math.min(held.bottom, low);
        held.top = Math.max(held.top, high);
      }
      previous = held;
    }

    return {
      // A RUN OF SPACES ALONE HAS NO BOX, and it has nothing to edit either:
      // leaving it out keeps an infinite extent from reaching a grouping whose
      // every comparison it would answer falsely.
      // AND IN THE ORDER TYPED: a text page reads each word of a right-to-left object reversed in place and leaves the
      // words in the order they are drawn, so the reading is turned back into the line as it was typed here, once, and
      // every reader of a run's text sees that (`logicalOf`, ADR-0181).
      runs: new Map(
        [...runs.entries()]
          .filter(([, run]) => Number.isFinite(run.left))
          .map(([index, run]) => [index, { ...run, text: logicalOf(run.text) }] as const),
      ),
      unaddressable,
      ends,
    };
  } finally {
    bindings.closeTextPage(textPage);
  }
}

/**
 * How a text object is set — {@link RunStyle}'s fields read off the object and
 * its font.
 *
 * The descriptor flags are ISO 32000 §9.8.2's: bit 1 (value 1) fixed pitch, bit
 * 2 (value 2) serif, bit 7 (value 64) italic. PDFium answers `-1` for a font it
 * cannot describe, which reads as no flags rather than as every flag set.
 */
function styleOf(bindings: Bound, object: unknown, programs: Map<string, ProgramFace | undefined>): RunStyle {
  const size = [0];
  numberFrom(bindings.textFontSize(object, size), 'FPDFTextObj_GetFontSize');
  const matrix: Record<string, number> = {};
  numberFrom(bindings.getMatrix(object, matrix), 'FPDFPageObj_GetMatrix');
  const a = matrix['a'] ?? 1;
  const b = matrix['b'] ?? 0;
  const c = matrix['c'] ?? 0;
  const d = matrix['d'] ?? 1;
  const red = [0];
  const green = [0];
  const blue = [0];
  const alpha = [0];
  numberFrom(
    bindings.getFillColour(object, red, green, blue, alpha),
    'FPDFPageObj_GetFillColor',
  );
  const font: unknown = bindings.textFont(object);
  const rawFlags = font === null ? -1 : numberFrom(bindings.fontFlags(font), 'FPDFFont_GetFlags');
  const flags = rawFlags < 0 ? 0 : rawFlags;
  const weight = font === null ? 0 : numberFrom(bindings.fontWeight(font), 'FPDFFont_GetWeight');
  const name = font === null ? '' : baseNameOf(bindings, font);
  // BOLD AND ITALIC FROM THE FIRST WITNESS THAT SPEAKS — the embedded program, then the descriptor, then the name
  // (`fontFace.ts`, where each is measured).
  const face = faceOf({
    program: font === null ? undefined : programOf(bindings, font, programs),
    weight: Math.max(0, weight),
    flags: rawFlags < 0 ? undefined : rawFlags,
    name,
  });
  return {
    size: (size[0] ?? 0) * Math.hypot(a, b),
    colour: { r: red[0] ?? 0, g: green[0] ?? 0, b: blue[0] ?? 0 },
    font: wireFontName(name),
    serif: (flags & 2) !== 0,
    mono: (flags & 1) !== 0,
    bold: face.bold,
    italic: face.italic,
    upright: isUpright(a, b, c, d),
  };
}

/**
 * The most bytes of one font program read to find its `OS/2` table. A CJK font runs to tens of megabytes and the
 * copy is the whole program, so one past this is decided by its descriptor instead — the face is still answered,
 * by the next witness. 32 MiB is past every Latin and most CJK programs.
 */
const MAX_FONT_PROGRAM_BYTES = 32 * 1024 * 1024;

/**
 * What an EMBEDDED font's program says about its face, read once per font in a walk — `programs` is keyed by the
 * font handle's address, which is the page's own font and stable while the page is open.
 */
function programOf(bindings: Bound, font: unknown, programs: Map<string, ProgramFace | undefined>): ProgramFace | undefined {
  const key = String(koffi.address(font));
  if (programs.has(key)) return programs.get(key);
  const bytes = embeddedProgramOf(bindings, font);
  const face = bytes === null ? undefined : programFace(bytes);
  programs.set(key, face);
  return face;
}

/**
 * An EMBEDDED font's program, decoded, or `null` where the font is not embedded or the program is past
 * {@link MAX_FONT_PROGRAM_BYTES}. Never a substitute's: for a font that is not embedded `FPDFFont_GetFontData` answers
 * the program PDFium draws with instead, which is PDFium's choice and not the document's.
 */
function embeddedProgramOf(bindings: Bound, font: unknown): Uint8Array | null {
  if (numberFrom(bindings.fontIsEmbedded(font), 'FPDFFont_GetIsEmbedded') !== 1) return null;
  const needed = [0];
  if (numberFrom(bindings.fontData(font, null, 0, needed), 'FPDFFont_GetFontData') !== 1) return null;
  const length = needed[0] ?? 0;
  if (length <= 0 || length > MAX_FONT_PROGRAM_BYTES) return null;
  const bytes = new Uint8Array(length);
  return numberFrom(bindings.fontData(font, bytes, length, needed), 'FPDFFont_GetFontData') === 1 ? bytes : null;
}

/** A block's run fonts: each font once, and for each run asked about its font's place among them, or `null`. */
export interface BlockFonts {
  readonly fonts: readonly Uint8Array[];
  readonly runs: readonly (number | null)[];
}

/**
 * The fonts the editor draws the runs whose first objects are `indices` in, each rebuilt from its own program
 * (ADR-0175, `runFont.ts`). ONE ANSWER PER FONT, keyed by the font handle's address, which is the page's own font and
 * stable while the page is open: the check and the rebuild depend on the font alone, so runs that share one share its
 * answer, and a run in a font past {@link MAX_BLOCK_FONTS} is answered with none.
 *
 * Each font is checked against every character drawn in it ON THE PAGE, the run's and every other object's in it: a
 * joined run spans several objects, and a letter the person types may be one another line holds.
 */
export function runFonts(session: PdfiumSession, page: number, indices: readonly number[]): Promise<BlockFonts> {
  return promised(() =>
    onPage(session, page, (handle) => {
      const bindings = api();
      const fonts: Uint8Array[] = [];
      /** Each font met, by address: its place in `fonts`, or `null` for one with none. */
      const answered = new Map<string, number | null>();
      let textPage: unknown = null;
      try {
        const runs = indices.map((index) => {
          const font: unknown = bindings.textFont(textObjectAt(bindings, handle, page, index));
          if (font === null) return null;
          const key = String(koffi.address(font));
          const known = answered.get(key);
          if (known !== undefined) return known;
          let at: number | null = null;
          if (fonts.length < MAX_BLOCK_FONTS) {
            if (textPage === null) {
              textPage = bindings.loadTextPage(handle);
              if (textPage === null) throw refusedAt('page', 'PDFium could not load the page to read a run’s characters');
            }
            const rebuilt = fontOfRun(bindings, handle, textPage, font, key);
            if (rebuilt !== null) at = fonts.push(rebuilt) - 1;
          }
          answered.set(key, at);
          return at;
        });
        return { fonts, runs };
      } finally {
        if (textPage !== null) bindings.closeTextPage(textPage);
      }
    }),
  );
}

/** One font's rebuilt program, checked against what PDFium draws for every character the page sets in it, or `null`. */
function fontOfRun(bindings: Bound, handle: unknown, textPage: unknown, font: unknown, key: string): Uint8Array | null {
  const program = embeddedProgramOf(bindings, font);
  if (program === null) return null;
  const inFont: unknown[] = [];
  const count = numberFrom(bindings.countObjects(handle), 'FPDFPage_CountObjects');
  for (let at = 0; at < count; at += 1) {
    const object: unknown = bindings.getObject(handle, at);
    if (object === null || numberFrom(bindings.objectType(object), 'FPDFPageObj_GetType') !== TEXT_OBJECT) continue;
    const own: unknown = bindings.textFont(object);
    if (own !== null && String(koffi.address(own)) === key) inFont.push(object);
  }
  const drawn = new Map<number, DrawnGlyph>();
  for (const character of drawnTextOn(bindings, textPage, inFont).join('')) {
    const point = character.codePointAt(0) ?? 0;
    if (drawn.has(point)) continue;
    const glyph = drawnGlyphOf(bindings, font, point);
    if (glyph === null) return null;
    drawn.set(point, glyph);
  }
  return runFontFor(program, drawn);
}

/**
 * What PDFium draws for `point` in `font`, in thousandths of an em: its width, and the box of its path's points, `null`
 * for a glyph with no path (a space). `null` where PDFium answers no width, which no check can stand in for.
 */
function drawnGlyphOf(bindings: Bound, font: unknown, point: number): DrawnGlyph | null {
  const width = [0];
  if (numberFrom(bindings.glyphWidth(font, point, 1000, width), 'FPDFFont_GetGlyphWidth') !== 1) return null;
  const path: unknown = bindings.glyphPath(font, point, 1000);
  const segments = path === null ? 0 : numberFrom(bindings.glyphPathSegments(path), 'FPDFGlyphPath_CountGlyphSegments');
  let box: DrawnGlyph['box'] = null;
  for (let at = 0; at < segments; at += 1) {
    const x = [0];
    const y = [0];
    if (numberFrom(bindings.segmentPoint(bindings.glyphPathSegment(path, at), x, y), 'FPDFPathSegment_GetPoint') !== 1) {
      continue;
    }
    // IN EMS, measured, so a thousand times each point is the thousandths the program's reading is in.
    const px = (x[0] ?? 0) * 1000;
    const py = (y[0] ?? 0) * 1000;
    box =
      box === null
        ? { x0: px, y0: py, x1: px, y1: py }
        : { x0: Math.min(box.x0, px), y0: Math.min(box.y0, py), x1: Math.max(box.x1, px), y1: Math.max(box.y1, py) };
  }
  return { advance: width[0] ?? 0, box };
}

/** The most bytes of one base name read: a name is a PDF name, and one this long is not a font's (CR-NAT-12). */
const MAX_FONT_NAME_BYTES = 64 * 1024;

/**
 * A font's base name — what `FPDFFont_GetBaseFontName` answers — as UTF-8, and cut to {@link PDFIUM_FONT_NAME_MAX} for
 * the wire.
 *
 * **PDFium's own two calls** (`fpdf_edit.h`): the length first, terminator counted, then a buffer of that length.
 * One fixed 128-byte buffer read a longer name as 127 NULs, because a buffer shorter than the answer is left
 * untouched while the full length is still returned (CR-NAT-12). The buffer is UTF-8 by the same header, where this
 * decoded it as Latin-1. A name past {@link MAX_FONT_NAME_BYTES} is answered as no name.
 *
 * **Cut, not refused**, at ISO 32000's own limit on a name, 127 bytes, which is the wire's bound: a document past it is
 * still a document, and the full name has already been read for its face.
 */
function baseNameOf(bindings: Bound, font: unknown): string {
  const needed = numberFrom(bindings.fontBaseName(font, null, 0), 'FPDFFont_GetBaseFontName');
  if (needed <= 1 || needed > MAX_FONT_NAME_BYTES) return '';
  const buffer = new Uint8Array(needed);
  if (numberFrom(bindings.fontBaseName(font, buffer, buffer.length), 'FPDFFont_GetBaseFontName') !== needed) return '';
  return new TextDecoder().decode(buffer.subarray(0, needed - 1));
}

/** A name cut to the wire's bound at a whole character: {@link PDFIUM_FONT_NAME_MAX} UTF-16 units, as the schema counts. */
function wireFontName(name: string): string {
  if (name.length <= PDFIUM_FONT_NAME_MAX) return name;
  let cut = '';
  for (const character of name) {
    if (cut.length + character.length > PDFIUM_FONT_NAME_MAX) break;
    cut += character;
  }
  return cut;
}

/**
 * Whether a matrix sets text straight: positive scales on the diagonal and
 * nothing off it.
 *
 * The off-diagonal test is RELATIVE to the scale rather than against zero,
 * because a matrix read back as floats carries rounding — `1e-7` beside a scale
 * of 11 is not a rotation anybody drew. One part in a million of the scale is
 * below any angle a page can show: at a page's width it is a thousandth of a
 * point.
 */
function isUpright(a: number, b: number, c: number, d: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(d));
  if (!(a > 0 && d > 0)) return false;
  return Math.abs(b) <= scale * 1e-6 && Math.abs(c) <= scale * 1e-6;
}

/** One text object's new text, named by its index in the page's object order. */
export interface TextReplacement {
  /** The object's index, as {@link textObjectIndices} reports it. */
  readonly index: number;
  /** What it should say; nothing at all removes the object ({@link removesItsObject}). */
  readonly text: string;
}

/**
 * Whether a replacement leaves its object with no text, which {@link replaceTextObjects} answers by removing the object
 * (ADR-0169 Decision 6: replacing a word with nothing deletes it).
 *
 * `FPDFText_SetText` refuses an empty string — measured 2026-10-05 on PDFium 155.0.8044.0's Linux build, a replace-all
 * of an object's whole text with nothing answered 0 at the set, with `FPDF_GetLastError` 0 — so an emptied object is
 * the editor's removed one. And a removed object renumbers the page and has no constructor, so a command that empties
 * one cannot be undone from the strings it changed: each capture asks this, and takes a checkpoint.
 */
export function removesItsObject(text: string): boolean {
  return text === '';
}

/**
 * The object at `index`, checked to be a text object.
 *
 * Shared by the read and the write because both refuse the same two things for
 * the same reason, and their messages are what a case asserts on: a wrong index
 * and a non-text object both fail somewhere, and only the message separates the
 * rule under test from the one downstream of it.
 */
function textObjectAt(bindings: Bound, handle: unknown, page: number, index: number): unknown {
  const total = numberFrom(bindings.countObjects(handle), 'FPDFPage_CountObjects');
  if (index < 0 || index >= total) {
    throw refusedAt('object', `Page ${String(page)} has ${String(total)} objects, so index ${String(index)} names none`);
  }
  const object: unknown = bindings.getObject(handle, index);
  if (
    object === null ||
    numberFrom(bindings.objectType(object), 'FPDFPageObj_GetType') !== TEXT_OBJECT
  ) {
    throw refusedAt(
      'object',
      `Object ${String(index)} on page ${String(page)} is not a text object, and FPDFText_SetText is defined only for one`,
    );
  }
  return object;
}

/**
 * Replaces the text of one or more of a page's text objects, and regenerates
 * the page's content **once**.
 *
 * ## Once, and that is a measurement rather than a tidiness
 *
 * [ADR-0047](../../../docs/DECISIONS/0047-an-in-place-text-edit-is-a-byte-image-command.md)
 * Decision 2, `npm run proof:editcost`: `FPDFText_SetText` is 0.007–0.029 ms
 * and flat, while `FPDFPage_GenerateContent` after a set runs 0.17 → 29.18 ms
 * and tracks the **document's** content rather than the edited page's. Over
 * forty replacements on one page of a 199 KB document, generating per call is
 * 199.6 ms against 14.6 ms generating once — **13.7×, growing without bound**.
 *
 * This function took one index and generated inside the same call until
 * 2026-09-09, which is correct for exactly one replacement and wrong for every
 * command that touches more than one. The plural signature is what makes the
 * expensive call impossible to write per object (B5 over a comment): there is
 * no spelling of *set one and generate* left for a caller to reach for.
 *
 * ## Every index is checked BEFORE anything is set, and what that is worth is MEASURED
 *
 * A command that cannot be completed must refuse **without having touched the
 * page** — `engine/apply`'s rule about assets and sources, one layer down.
 *
 * **Its effect is not observable from outside this module today**, and saying
 * so is the honest version of the rule. `proof:pdfiumadapter` carried a case
 * for it; the mutation that should have reddened that case — validating inside
 * the set loop, so a valid first entry lands and an invalid second throws —
 * left every case green. Read against the library on 2026-09-09, with a
 * control: a `FPDFText_SetText` never followed by `FPDFPage_GenerateContent`
 * does **not** survive `FPDF_ClosePage`. A second `FPDF_LoadPage` of the same
 * page, a different set and a generate wrote only the second pass's string —
 * the first pass's was absent from the saved bytes, and the second pass's
 * present.
 *
 * So {@link onPage}'s per-call page lifetime is what prevents the half-write,
 * and this check is a second mechanism for the same thing. It is kept rather
 * than removed because the plural signature invites the caller this does
 * protect — one that holds a page across several sets — and because the rule
 * it states is true whether or not anything can currently see it. The case was
 * removed instead, a check that cannot fail being worse than no check.
 *
 * @throws on an empty list. A replacement that names nothing would regenerate
 * a page's content stream for no change, which is the whole cost of an edit
 * paid for nothing — and a caller reaching this with an empty list has a bug
 * upstream that a silent success would hide.
 * @throws when an index is not a text object, rather than editing whatever is
 * there. `FPDFText_SetText` on a path object is undefined behaviour.
 * @throws TextNotWritableError when a write reads back as something other than what was written, and nothing is
 * generated. Where this process has the bundled fonts, a word the object's font cannot carry is written as its own
 * piece first (ADR-0173 Decision 9), so this is a font that drew wrong rather than one that lacked a letter.
 * @throws ReplaceMovesLineError under `line: 'held'` when a replacement changes its width and text follows it on its
 * line, before anything is generated: its pieces' width where it was written in pieces.
 *
 * @returns the characters it drew as boxes, with the page (ADR-0174).
 *
 * @param line `'held'` for a Replace, which has no knowledge of the line and refuses an edit that would move the text
 *   after it (`replaceLineRule.ts`); `'as-written'` where the strings are already what the line should hold: an undo
 *   putting back the strings it recorded, which also puts back their widths, and the adapter's own proofs, which
 *   measure the write rather than the line. Required, so no caller inherits either.
 */
export function replaceTextObjects(
  session: PdfiumSession,
  page: number,
  replacements: readonly TextReplacement[],
  line: 'held' | 'as-written',
): Promise<readonly BoxedInEdit[]> {
  return promised(() =>
    onPage(session, page, (handle) => {
      const bindings = api();
      if (replacements.length === 0) {
        throw new Error(
          `A replacement on page ${String(page)} named no text object. Regenerating a page's ` +
            'content stream is the whole cost of an edit, and this one would change nothing.',
        );
      }
      // RESOLVED IN FULL FIRST. See the note above: a refusal must not leave
      // the page holding part of a replacement.
      const resolved = replacements.map((replacement) => ({
        replacement,
        object: textObjectAt(bindings, handle, page, replacement.index),
      }));
      // THE LINE AS IT WAS, read before any write and only where it is held: each object's ink and advance end.
      const before = line === 'held' ? lineBoxes(walkRuns(bindings, handle)) : undefined;
      // THE BLOCK EDIT'S WRITER (ADR-0173 Decision 9): a word the object's font cannot carry is its own piece in the
      // resolver's face, and a character no face carries its box, so Replace and the editor answer one question once.
      const pen = pieceWriter(session, handle, page, 'write', charactersOf(replacements.map(({ text }) => text)));
      try {
        /** The objects each replacement now says itself in, by the index it named: one, or its pieces in order. */
        const wrote = new Map<number, readonly unknown[]>();
        for (const { replacement, object } of resolved) {
          // AN EMPTIED OBJECT IS REMOVED, never set to nothing, which PDFium refuses ({@link removesItsObject}). Removed
          // after every write, as the block edit removes, so no handle above is read after it is freed.
          if (removesItsObject(replacement.text)) {
            pen.removed.push(object);
            continue;
          }
          if (pen.inPieces) {
            wrote.set(replacement.index, pen.writePieces(object, replacement.text));
            continue;
          }
          // A PROCESS GIVEN NO FONTS sets the string in the object's own font, as Replace always has, and the read-back
          // below refuses what that font cannot draw: Replace never had the block edit's standard twin.
          if (!trySetText(bindings, object, replacement.text)) {
            throw refusedAt('set-text', `FPDFText_SetText refused the replacement for object ${String(replacement.index)}`);
          }
          pen.record(object, replacement.text);
          wrote.set(replacement.index, [object]);
        }
        // MEASURED AFTER THE WRITES AND BEFORE THE REMOVALS. A replacement ends where its LAST object ends, found by
        // handle, since pieces are inserted after the run and every index after them moved. An object with no
        // characters read back has no box here and is the read-back's to refuse.
        if (before !== undefined) {
          const now = lineBoxes(walkRuns(bindings, handle));
          const indexOf = objectIndices(bindings, handle);
          const after = new Map<number, RunBox | null>();
          for (const { replacement } of resolved) {
            const objects = wrote.get(replacement.index);
            const last = objects?.at(-1);
            const at = last === undefined ? undefined : indexOf.get(String(koffi.address(last)));
            const box = objects === undefined ? null : at === undefined ? undefined : now.get(at);
            if (box !== undefined) after.set(replacement.index, box);
          }
          if (replacementsMovingTheirLine(before, after).length > 0) throw new ReplaceMovesLineError();
        }
        for (const object of pen.removed) {
          if (numberFrom(bindings.removeObject(handle, object), 'FPDFPage_RemoveObject') !== 1) {
            throw refusedAt('object', `FPDFPage_RemoveObject refused an object a replacement removes on page ${String(page)}`);
          }
          bindings.destroyObject(object);
        }
        // EVERY WRITE IS READ BACK before anything is generated, by the block edit's rule (`editTextBlocks`): a 1 from
        // FPDFText_SetText says the string was set, not that the run's font can draw it, and a subset font missing a
        // character drew it as nothing while Replace All reported success (CR-NAT-10). A throw here leaves the document
        // as it came, since nothing has been generated and the page is discarded.
        const textPage: unknown = bindings.loadTextPage(handle);
        if (textPage === null) throw refusedAt('page', 'PDFium could not load the page to read the replacement back');
        try {
          const drawn = drawnTextOn(
            bindings,
            textPage,
            pen.written.map(({ object }) => object),
          );
          const misread = misreadWrites(
            pen.written.map(({ text }) => text),
            drawn,
          );
          if (misread.length > 0) {
            throw new TextNotWritableError(unwritableCharacters(misread));
          }
        } finally {
          bindings.closeTextPage(textPage);
        }
        generate(
          session,
          page,
          handle,
          pen.written.map(({ object }) => object),
        );
        return pen.boxed();
      } finally {
        pen.close();
      }
    }),
  );
}

/**
 * Whether every replacement stays in the object it names, rather than becoming pieces (ADR-0173 Decision 9): asked by
 * a capture before it records strings by index, since pieces renumber the page and an inverse by index would then write
 * into the wrong objects. Answered by the writer's own {@link PieceWriter.keepsItsObject} on a page that is closed
 * without being generated, which discards nothing it did not already discard. True in a process given no fonts, where
 * a replacement is never written in pieces.
 */
export function replacementsKeepTheirObjects(
  session: PdfiumSession,
  page: number,
  replacements: readonly TextReplacement[],
): Promise<boolean> {
  return promised(() =>
    onPage(session, page, (handle) => {
      const bindings = api();
      const pen = pieceWriter(session, handle, page, 'trial', charactersOf(replacements.map(({ text }) => text)));
      try {
        if (!pen.inPieces) return true;
        return replacements.every(
          ({ index, text }) => removesItsObject(text) || pen.keepsItsObject(textObjectAt(bindings, handle, page, index), text),
        );
      } finally {
        pen.close();
      }
    }),
  );
}

/** Every distinct code point the texts hold: what one subset per face must carry (ADR-0173 Decision 5). */
function charactersOf(texts: readonly string[]): number[] {
  // THE FORMS A LETTER IS DRAWN IN, not the letter (`drawing`): an Arabic letter is set as one of four code points.
  return [...new Set(texts.flatMap((text) => Array.from(arabicForms(text), (character) => character.codePointAt(0) ?? 0)))];
}

/** Each object on the page by its handle's address, to its index in the page's order now. */
function objectIndices(bindings: Bound, handle: unknown): ReadonlyMap<string, number> {
  const indices = new Map<string, number>();
  const count = numberFrom(bindings.countObjects(handle), 'FPDFPage_CountObjects');
  for (let index = 0; index < count; index += 1) indices.set(String(koffi.address(bindings.getObject(handle, index))), index);
  return indices;
}

/** Each walked run as the line rule reads it: its ink's start and height, and its advance's end. */
function lineBoxes(walked: ReturnType<typeof walkRuns>): ReadonlyMap<number, RunBox> {
  const boxes = new Map<number, RunBox>();
  for (const [index, run] of walked.runs) {
    const end = walked.ends.get(index);
    if (end !== undefined && Number.isFinite(end)) boxes.set(index, { left: run.left, end, bottom: run.bottom, top: run.top });
  }
  return boxes;
}

/**
 * One block of text as a person edited it in place.
 *
 * One entry of `editTextBlock`'s `blocks`: the block's lines as the person
 * saw them, each the indices of the runs it is made of in reading order, and
 * what they typed, lines separated by line breaks.
 */
export interface BlockEdit {
  readonly lines: readonly (readonly number[])[];
  /** Whether each line ends in a soft wrap (ADR-0179): the paragraphs the text is laid out as. */
  readonly soft: readonly boolean[];
  readonly text: string;
  /** What spans of `text` are, and how named paragraphs are set (ADR-0180). */
  readonly marks?: readonly Omit<BlockMark, 'block'>[];
  readonly paragraphs?: readonly Omit<ParagraphProps, 'block'>[];
  /** How the block is placed once laid out: moved, scaled, rotated, or set at a new measure (ADR-0180, corrected). */
  readonly place?: Omit<BlockPlace, 'block'>;
  /**
   * `reflow`: a person typing — the block grows downward (ADR-0096). `shrink`: a translation — the
   * block is scaled uniformly to end above its original last line, never below {@link MIN_FIT}
   * (ADR-0097).
   */
  readonly fit: 'reflow' | 'shrink';
}

/**
 * The smallest a fitted block is scaled to: 11-point text at 0.6 is 6.6 points, the size of fine
 * print, and smaller is not a translation anyone can read (ADR-0097 4b). A block needing more is
 * written at this and may overlap what is below it.
 */
const MIN_FIT = 0.6;

/**
 * How many bisection steps find a block's scale: the interval [0.6, 1] halved six times is 0.00625
 * wide — at 11 points, under a tenth of a point of size, which no reader sees.
 */
const FIT_STEPS = 6;

/** Characters as a person sees them, for naming the ones a font cannot carry: an accent typed as a mark stays on its letter. */
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** A named run, resolved on a loaded page. */
interface HeldRun {
  readonly index: number;
  /**
   * The object that draws it — REASSIGNED when a write the run's font cannot carry puts a
   * standard-font twin in its place (ADR-0097), so every later move and measurement of this run
   * reaches the object that is actually on the page.
   */
  object: unknown;
  /** What the person was shown it saying — the walk's text, generated spaces included. */
  readonly text: string;
  /**
   * The run's OTHER objects, when it is glyph objects joined into one run (ADR-0130): moved with it, and removed
   * when the run is written — a joined run is written whole into its first object, which is set in the run's font
   * and starts where the run starts. Written glyph by glyph instead, each object kept its old place while the text
   * moved through them: measured 2026-10-01, *"edited whole"* read back as *"edited whol e"*. Emptied here once
   * removed, so nothing later moves an object that is going.
   */
  extras: unknown[];
  /** Where the whole run's ink began and ended, before the edit: the width a write grows or shrinks from. */
  readonly span: { readonly left: number; readonly right: number };
}

/** A matrix as six numbers, read so it can be written back moved. */
interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

function matrixOn(bindings: Bound, object: unknown): Matrix {
  const raw: Record<string, unknown> = {};
  if (numberFrom(bindings.getMatrix(object, raw), 'FPDFPageObj_GetMatrix') !== 1) {
    throw refusedAt('matrix', 'FPDFPageObj_GetMatrix refused a text object this page handed back');
  }
  const read = (key: string): number => numberFrom(raw[key], `FS_MATRIX.${key}`);
  return { a: read('a'), b: read('b'), c: read('c'), d: read('d'), e: read('e'), f: read('f') };
}

function setMatrixOn(bindings: Bound, object: unknown, matrix: Matrix): void {
  if (numberFrom(bindings.setMatrix(object, matrix), 'FPDFPageObj_SetMatrix') !== 1) {
    throw refusedAt('matrix', 'FPDFPageObj_SetMatrix refused a text object this edit moved');
  }
}

/** Moves an object by `dx`, `dy` in page space, keeping its scale. */
function moveBy(bindings: Bound, object: unknown, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const matrix = matrixOn(bindings, object);
  setMatrixOn(bindings, object, { ...matrix, e: matrix.e + dx, f: matrix.f + dy });
}

/**
 * Sets an object's text, answering whether PDFium would.
 *
 * ## A refusal here IS the font's answer
 *
 * `FPDFText_SetText` refuses a string the object's font cannot encode — measured 2026-09-24 on the
 * corpus, where every first page with editable text is set in embedded subset fonts and a French
 * translation was refused at this call, on 5 of 5 pages, with `FPDF_GetLastError` 0. So a block
 * edit treats it as *this font cannot carry it*: the write goes to a standard-font twin (ADR-0097),
 * where a throw here had made it an internal error in place of the refusal the edit is designed to
 * give.
 */
function trySetText(bindings: Bound, object: unknown, text: string, rtl?: boolean): boolean {
  return numberFrom(bindings.setText(object, wideString(drawing(text, rtl).drawn)), 'FPDFText_SetText') === 1;
}

/**
 * The string an object is set to for `text`, and the string a text page reads from it
 * ([ADR-0181](../../../docs/DECISIONS/0181-right-to-left-text-is-written-in-drawing-order-and-read-back-as-typed.md)).
 *
 * A content stream is in drawing order and a text page reverses an object it takes as right to left, so what is set is
 * the drawing order and what is read is the text as typed. `rtl` is the direction of the object's span where the
 * caller cut the line by direction (`inDrawingOrder`), and absent where the object is a whole line, ordered here.
 *
 * `reads` is {@link readBackOf} the drawn string, which is the text as typed except where an edge neutral of a right to
 * left piece reads on the other side of its word, and a read-back compares against it: it asks whether the font drew
 * every character, which is the question it exists for.
 */
function drawing(text: string, rtl: boolean | undefined): { readonly drawn: string; readonly reads: string } {
  // THE LETTERS ARE SET IN THEIR JOINING FORMS first (`arabicForms`), and a text page normalises the forms back to the
  // letters before it reverses a run, so the reading is taken of the letters.
  const shaped = arabicForms(text);
  const drawn = rtl === undefined ? drawnOrder(shaped) : rtl ? drawnRightToLeft(shaped) : shaped;
  return { drawn, reads: readBackOf(lettersOfForms(drawn)) };
}

/**
 * Edits blocks of text on one page in place, reflowing a line that grows past
 * its block into new lines in the page's own fonts, and regenerates the page's
 * content **once** — for one block a person typed into, or for every block of a
 * translated page ([ADR-0097](../../../docs/DECISIONS/0097-a-page-is-translated-as-one-block-edit-and-a-font-that-cannot-carry-it-falls-back.md)).
 *
 * [ADR-0096](../../../docs/DECISIONS/0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md)
 * Decision 5, in order:
 *
 * 1. **Each typed line is diffed against the line it replaces** by
 *    `replacementsForLine`'s rule — the typed line `k` against the block's line
 *    `k`, which is the line the person's caret was in when they typed it. Only
 *    runs the diff names are written, so a word changed inside one run leaves
 *    every other run's font alone.
 * 2. **A run that grows pushes the runs after it** along its line by the
 *    difference in its own laid-out width, measured on the object after the
 *    write — PDFium's layout of the object it will draw, never arithmetic of
 *    ours (355 of 457 corpus runs against 176 for summed glyph widths).
 * 3. **A line whose right edge passes the block's WRAPS**: words come off the
 *    end of its last run, a word at a time, until it fits; they go to a new line
 *    below, made in that run's font, size, colour and matrix and started at the
 *    line's left. A new line that does not fit wraps again. A single word wider
 *    than the block is left as it is: there is nowhere to break it.
 * 4. **Lines the person added** below the block's last are made the same way,
 *    in its last line's last run's style; **lines they removed** are removed.
 * 5. **Every line below a change moves** so the block keeps its own spacing:
 *    an old line keeps the gap it had to the line above it, and a new line
 *    takes the block's pitch — the gap between its first two baselines, or the
 *    font's ascent to descent where there is one line.
 * 6. **Every write is read back** from a live text page AS IT IS MADE. One that
 *    says something other than what was written means the run's font cannot
 *    carry it, and the object is replaced by a TWIN in the nearest standard
 *    font — same size, matrix and colour — which ADR-0097 measured carrying an
 *    accented Western string for 308 of 325 runs whose own font did not. Only a
 *    twin that cannot carry it either refuses the edit, with
 *    {@link TextNotWritableError}, before generation. Every write is read back
 *    once more at the end, after the layout has moved it, and the page's
 *    generation is told which objects are writes, so the saved bytes are read
 *    back against them by `serialise` (ADR-0169).
 *
 * @throws TextNotWritableError when neither a run's font nor its standard twin
 * can carry the text, naming the characters neither carries.
 * @throws when an index is not a text object, or names a run the page's text
 * reading cannot place, or when the edit changes nothing — regenerating a
 * page's content for no change is the whole cost of an edit paid for nothing.
 */
export async function editTextBlocks(
  session: PdfiumSession,
  page: number,
  edits: readonly BlockEdit[],
  /** Boxes of new text the page is given, laid out by the same pass (ADR-0180, corrected 2026-10-06). */
  inserts: readonly PageInsert[] = [],
): Promise<readonly BoxedInEdit[]> {
  const scales = await fitScales(session, page, edits, inserts);
  // THE CHARACTERS IT DREW AS BOXES (ADR-0174): the write pass's, never a trial's, which draws on a page thrown away.
  const { boxed } = await promised(() =>
    onPage(session, page, (handle) => layOutBlocks(session, handle, page, edits, inserts, scales, 'write')),
  );
  return boxed;
}

/**
 * The scale each block is written at: 1 for `reflow`, and for `shrink` the largest that ends above
 * its original last line (ADR-0097 4b).
 *
 * ## Found on TRIAL pages, which are thrown away
 *
 * Each trial loads the page, lays every shrinking block out at a candidate scale, measures, and
 * closes the page WITHOUT generating — which discards everything it did (5 of 5 pages kept their
 * original text on reload, `pdfiumFallbackFont.mjs`). All the blocks bisect at once, one trial per
 * step, because they do not touch each other's objects; so a page costs at most `FIT_STEPS + 1`
 * trials however many blocks it has. A trial writes without reading back: it asks where the words
 * land, and whether a font can carry them is the real pass's question.
 */
async function fitScales(
  session: PdfiumSession,
  page: number,
  edits: readonly BlockEdit[],
  inserts: readonly PageInsert[],
): Promise<number[]> {
  const scales = edits.map(() => 1);
  const trial = (candidate: readonly number[]) =>
    promised(() =>
      onPage(session, page, (handle) => layOutBlocks(session, handle, page, edits, inserts, candidate, 'trial')),
    );
  if (!edits.some((edit) => edit.fit === 'shrink')) return scales;
  const first = await trial(scales);
  // KNOWN TO FIT is `low`, known not to is `high`. The floor is accepted without a trial: a block
  // that does not fit even there is written there, which is the stated limit.
  const bounds = new Map<number, { low: number; high: number }>();
  for (const [at, edit] of edits.entries()) {
    if (edit.fit === 'shrink' && first.fits[at] !== true) bounds.set(at, { low: MIN_FIT, high: 1 });
  }
  for (let step = 0; step < FIT_STEPS && bounds.size > 0; step += 1) {
    const candidate = scales.map((scale, at) => {
      const bound = bounds.get(at);
      return bound === undefined ? scale : (bound.low + bound.high) / 2;
    });
    const { fits } = await trial(candidate);
    for (const [at, bound] of bounds) {
      const tried = candidate[at] ?? 1;
      if (fits[at] === true) bound.low = tried;
      else bound.high = tried;
    }
  }
  for (const [at, bound] of bounds) scales[at] = bound.low;
  return scales;
}

/**
 * How a superscript or subscript is set (ADR-0180 Decision 4): at this fraction of the size the words would have, raised
 * or dropped by these fractions of it, the figures word processors use.
 */
const RISE_SCALE = 0.65;
const SUPERSCRIPT_RISE = 0.33;
const SUBSCRIPT_DROP = 0.12;
/** The rule under underlined words: this fraction of their size thick, this far below the baseline. */
const UNDERLINE_THICKNESS = 0.06;
const UNDERLINE_DROP = 0.12;

/**
 * What a mark asks of the face a word is set in (ADR-0180 Decision 4): a weight, a slant or a family, each only where it
 * is named. The size, the colour, the underline and the rise are applied to the objects after they are written.
 */
interface Restyle {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly family?: string;
}

/**
 * What {@link pieceWriter} hands its caller: the one way an edit's text is written into a page's objects.
 *
 * `written` and `removed` are the caller's to read and to add to: the read-back reads `written`, the generation names
 * it, and an object the caller removes for its own reason (a line the person deleted, a run the diff emptied) joins
 * `removed`, which is unlinked LAST.
 */
interface PieceWriter {
  /** Whether this process sets a word its run's font cannot carry in a catalogue face, or keeps the standard twin. */
  readonly inPieces: boolean;
  readonly written: { object: unknown; text: string }[];
  readonly removed: unknown[];
  readonly insertAfter: (object: unknown, anchor: unknown) => void;
  readonly write: (object: unknown, text: string) => unknown;
  readonly writePieces: (object: unknown, text: string, restyle?: Restyle) => unknown[];
  /** The standard font a restyled word is set in where no catalogue is bound. */
  readonly standardFontRestyled: (object: unknown, restyle: Restyle) => unknown;
  /** A new text object appended to the page for an added box, in the standard face its family names. */
  readonly seed: (spec: {
    readonly family?: string | undefined;
    readonly bold?: boolean | undefined;
    readonly italic?: boolean | undefined;
    readonly size: number;
    readonly colour?: { readonly r: number; readonly g: number; readonly b: number } | undefined;
    readonly left: number;
    readonly baseline: number;
  }) => unknown;
  /** An object's own style, as the editor reads it: what a mark is compared against. */
  readonly styleOfObject: (object: unknown) => RunStyle;
  readonly trimPieces: (objects: readonly unknown[], text: string) => unknown[];
  readonly record: (object: unknown, text: string) => void;
  readonly standardFontLike: (object: unknown) => unknown;
  readonly uncarriedIn: (source: unknown, text: string) => string;
  readonly keepsItsObject: (object: unknown, text: string) => boolean;
  /** The characters drawn as boxes that are still on the page, in the order they were drawn (ADR-0174). */
  readonly boxed: () => BoxedInEdit[];
  /** Closes the fonts this writer loaded and deletes its scratch page: before the caller generates or saves. */
  readonly close: () => void;
}

/**
 * THE ONE WRITER of an edit's text into a page's objects, the block edit's and Replace's (ADR-0173 Decision 9), so
 * which font carries which word has one answer whichever command asks it (B3a).
 *
 * @param mode `trial` lays text out without reading it back and records nothing, for a block fitted to its box
 * @param characters every character the command writes: one subset per face carries all of them (Decision 5)
 */
function pieceWriter(
  session: PdfiumSession,
  handle: unknown,
  page: number,
  mode: 'write' | 'trial',
  characters: readonly number[],
): PieceWriter {
      const bindings = api();
      const document = documentFor(session);
      /** Every object this edit wrote, and what it wrote, for the read-back. */
      const written: { object: unknown; text: string }[] = [];
      /**
       * The runs of lines the person removed, and the originals a twin replaced,
       * unlinked LAST.
       *
       * Removing an object destroys it, and a handle read after that is freed
       * memory: measured 2026-09-23, reading the matrix of a removed line's
       * first run — to find where lines typed below the block start — ended the
       * process with `0xC0000409`. So nothing is removed until every other
       * handle this edit reads has been read.
       */
      const removed: unknown[] = [];
      /** The standard fonts this edit loaded, by name — ours to close. */
      const standardFonts = new Map<string, unknown>();
      /** Each font program's face, read once for this edit (`programOf`). */
      const programs = new Map<string, ProgramFace | undefined>();
      /** The glyphs of each face this edit loaded (`faceFont`), by the address of the font PDFium answered. */
      const faceGlyphs = new Map<string, ShapingFace>();
      /**
       * Sets `text` on `object` — THE ONE SETTER of this edit's text. An object in a face this edit loaded is set by its
       * subset's glyph ids (`FPDFText_SetCharcodes`), which are the codes PDFium writes for that font, so a character
       * past the BMP draws its glyph rather than code 0; PDFium's ToUnicode for the font is its cmap, so it reads back as
       * itself (ADR-0173's correction). Any other object is set by `FPDFText_SetText`, as before. False where the font
       * has no glyph for a character, or PDFium refuses.
       */
      const setOn = (object: unknown, text: string, rtl?: boolean): boolean => {
        const font: unknown = bindings.textFont(object);
        const glyphs = font === null ? undefined : faceGlyphs.get(String(koffi.address(font)));
        if (glyphs === undefined) return trySetText(bindings, object, text, rtl);
        const codes: number[] = [];
        for (const character of drawing(text, rtl).drawn) {
          const glyph = glyphs.glyphFor(character.codePointAt(0) ?? 0);
          if (glyph === undefined || glyph === 0) return false;
          codes.push(glyph);
        }
        return (
          codes.length > 0 &&
          numberFrom(bindings.setCharcodes(object, Uint32Array.from(codes), codes.length), 'FPDFText_SetCharcodes') === 1
        );
      };

      /**
       * Inserts `object` right after `anchor` in the page's order — the line it continues, or the
       * run it replaces — so the saved page reads in the order it is seen.
       */
      const insertAfter = (object: unknown, anchor: unknown): void => {
        const wanted = String(koffi.address(anchor));
        const count = numberFrom(bindings.countObjects(handle), 'FPDFPage_CountObjects');
        let at = count - 1;
        for (let index = 0; index < count; index += 1) {
          if (String(koffi.address(bindings.getObject(handle, index))) === wanted) {
            at = index;
            break;
          }
        }
        if (numberFrom(bindings.insertObjectAt(handle, object, at + 1), 'FPDFPage_InsertObjectAtIndex') !== 1) {
          throw refusedAt('object', `FPDFPage_InsertObjectAtIndex refused a line this edit made on page ${String(page)}`);
        }
      };
      /**
       * The blank page the font probes are read on, made on first use: appended after the
       * document's last page, US Letter, and closed and DELETED in this pass's `finally` — before
       * the caller generates or serialises, so nothing of it reaches the saved file.
       */
      let scratch: { readonly handle: unknown; readonly index: number } | undefined;
      const scratchPage = (): unknown => {
        if (scratch !== undefined) return scratch.handle;
        const index = numberFrom(bindings.pageCount(document), 'FPDF_GetPageCount');
        const made: unknown = bindings.newPage(document, index, 612, 792);
        if (made === null) throw refusedAt('page', 'FPDFPage_New refused a scratch page for a block edit');
        scratch = { handle: made, index };
        return made;
      };
      /**
       * Whether `object`'s font, or `font` set like it, carries `text` — asked of a throwaway object, never of `object`.
       *
       * ## Apart from everything, because a text page reads by position
       *
       * A line is written before the layout moves it, so at the moment of writing a continuation
       * sits exactly on the line it continues; read in place, the overlap corrupted its reading and
       * a line in a font that carries it was refused (measured 2026-09-24, `pdfiumCommand.proof.mjs`'
       * fitted-block cases). The question here is the font's, not the position's: so a probe in the
       * same font and size is read alone. The checks after the layout read the real objects where
       * they end up.
       *
       * ## On a SCRATCH PAGE, never off the edge of this one
       *
       * The first version set the probe a page's height below the page, and PDFium's text-page
       * builder aborted the process on it — `FPDFText_LoadPage`, a libc++ bounds assertion, traced
       * call by call on a corpus page on 2026-09-24. So the probe goes on a blank page appended for
       * this edit and deleted before anything is generated or saved (`scratch`, below).
       */
      const carries = (
        object: unknown,
        text: string,
        font: unknown = bindings.textFont(object),
        rtl?: boolean,
      ): boolean => {
        const probe = makeTextLike(bindings, document, object, 0, font);
        if (!setOn(probe, text, rtl)) {
          bindings.destroyObject(probe);
          return false;
        }
        const matrix = matrixOn(bindings, probe);
        setMatrixOn(bindings, probe, { ...matrix, e: 72, f: 396 });
        const sheet = scratchPage();
        if (numberFrom(bindings.insertObject(sheet, probe), 'FPDFPage_InsertObject') !== 1) {
          throw refusedAt('object', 'FPDFPage_InsertObject refused a probe on the scratch page');
        }
        try {
          const textPage: unknown = bindings.loadTextPage(sheet);
          if (textPage === null) throw refusedAt('page', 'PDFium could not load the scratch page to read a probe');
          try {
            return drawnTextOn(bindings, textPage, [probe])[0] === asTextPageReads(drawing(text, rtl).reads);
          } finally {
            bindings.closeTextPage(textPage);
          }
        } finally {
          if (numberFrom(bindings.removeObject(sheet, probe), 'FPDFPage_RemoveObject') === 1) bindings.destroyObject(probe);
        }
      };
      /**
       * Whether `text` written as the run `object` heads stays in `object` alone, or becomes pieces: the one answer to
       * that question, which {@link writePieces} takes and a capture asks before it records strings by index, since
       * pieces are objects inserted after the run and renumber the page (ADR-0173 Decision 9).
       */
      const keepsItsObject = (object: unknown, text: string): boolean => carries(object, text);
      /** The standard font nearest `object`'s, loaded once per edit and closed with it. */
      const standardFontNamed = (name: string): unknown => {
        let font = standardFonts.get(name);
        if (font === undefined) {
          font = bindings.loadStandardFont(document, name);
          if (font === null) throw refusedAt('object', `FPDFText_LoadStandardFont refused ${name}`);
          standardFonts.set(name, font);
        }
        return font;
      };
      const standardFontLike = (object: unknown): unknown =>
        standardFontNamed(standardFontFor(styleOf(bindings, object, programs)));
      /**
       * The standard font a restyled word is set in where no catalogue is bound: the kind of face the family names, in the
       * weight and slant asked. A family the standard fonts have no name for keeps the run's own kind.
       */
      const standardFontRestyled = (object: unknown, restyle: Restyle): unknown => {
        const style = styleOf(bindings, object, programs);
        const { mono, serif } = kindOfFamily(restyle.family, style);
        return standardFontNamed(
          standardFontFor({ mono, serif, bold: restyle.bold ?? style.bold, italic: restyle.italic ?? style.italic }),
        );
      };
      /**
       * A text object of its own on the page, in the standard face the family names, for an added box (ADR-0180 Decision
       * 6): the one run its words are laid out from, since a layout takes its style from a run. Its single character is
       * what the box's words replace, and it is appended, so the page reads it last.
       */
      const seed = (spec: {
        readonly family?: string | undefined;
        readonly bold?: boolean | undefined;
        readonly italic?: boolean | undefined;
        readonly size: number;
        readonly colour?: { readonly r: number; readonly g: number; readonly b: number } | undefined;
        readonly left: number;
        readonly baseline: number;
      }): unknown => {
        const { mono, serif } = kindOfFamily(spec.family, { mono: false, serif: false });
        const font = standardFontNamed(standardFontFor({ mono, serif, bold: spec.bold ?? false, italic: spec.italic ?? false }));
        const object: unknown = bindings.createTextObject(document, font, spec.size);
        if (object === null) throw refusedAt('object', 'FPDFPageObj_CreateTextObj refused the font of an added box');
        setMatrixOn(bindings, object, { a: 1, b: 0, c: 0, d: 1, e: spec.left, f: spec.baseline });
        if (!trySetText(bindings, object, SEED_TEXT)) throw refusedAt('set-text', 'PDFium refused the character an added box starts from');
        const colour = spec.colour ?? { r: 0, g: 0, b: 0 };
        bindings.setFillColour(object, colour.r, colour.g, colour.b, 255);
        if (numberFrom(bindings.insertObject(handle, object), 'FPDFPage_InsertObject') !== 1) {
          throw refusedAt('object', `FPDFPage_InsertObject refused an added box on page ${String(page)}`);
        }
        return object;
      };
      /** The run's own object, as the style it is read as: the base a mark is compared against. */
      const styleOfObject = (object: unknown): RunStyle => styleOf(bindings, object, programs);
      /**
       * The characters of `text` that neither `source`'s font nor its standard twin carries, each asked ALONE — the
       * names a refusal gives (ADR-0169 Decision 4). Only reached on the way to a refusal, so its probes cost an edit
       * that is not being made; each distinct character is asked once.
       */
      const uncarriedIn = (source: unknown, text: string): string => {
        const twin = makeTextLike(bindings, document, source, 0, standardFontLike(source));
        try {
          const answers = new Map<string, boolean>();
          const carried = (character: string): boolean => {
            let answer = answers.get(character);
            if (answer === undefined) {
              answer = character.trim() === '' || carries(source, character) || carries(twin, character);
              answers.set(character, answer);
            }
            return answer;
          };
          const kept = Array.from(graphemes.segment(text), (part) => part.segment).filter(carried);
          return unwritableCharacters([{ written: text, read: kept.join('') }]);
        } finally {
          bindings.destroyObject(twin);
        }
      };
      /** Names what an object was written to say, as a text page will read it back ({@link drawing}). */
      const record = (object: unknown, said: string, rtl?: boolean): void => {
        const text = drawing(said, rtl).reads;
        const entry = written.find((write) => write.object === object);
        if (entry === undefined) written.push({ object, text });
        else entry.text = text;
      };
      /**
       * Writes `text` into an object ON THE PAGE and answers the object that now
       * says it: the same one, or a standard-font twin in its place (ADR-0097).
       *
       * Read back AS IT IS WRITTEN rather than only at the end, because the
       * answer decides which object the rest of the edit measures and moves: a
       * run whose font cannot carry `é` is replaced before its width is used to
       * push the runs after it. A twin that cannot carry it either is the
       * refusal ADR-0096 had, and it is still whole-edit and before generation.
       */
      const write = (object: unknown, text: string): unknown => {
        // THE OBJECT'S OWN FONT FIRST: set, and — on a real pass — confirmed by a probe. A TRIAL
        // skips the probe (it asks where the words land) and still takes a twin where PDFium
        // refuses the set, so it measures the font that will really be drawn.
        if (trySetText(bindings, object, text) && (mode === 'trial' || carries(object, text))) {
          if (mode === 'write') record(object, text);
          return object;
        }
        const twin = makeTextLike(bindings, document, object, matrixOn(bindings, object).e, standardFontLike(object));
        if (!trySetText(bindings, twin, text) || (mode === 'write' && !carries(twin, text))) {
          bindings.destroyObject(twin);
          throw new TextNotWritableError(uncarriedIn(object, text));
        }
        insertAfter(twin, object);
        removed.push(object);
        if (mode === 'write') {
          const at = written.findIndex((write) => write.object === object);
          if (at !== -1) written.splice(at, 1);
          record(twin, text);
        }
        return twin;
      };
      /**
       * A restyled word where no catalogue is bound: a new object in the standard font of the style asked, taking the
       * place of `object`, which goes. The twin's own refusal is `write`'s (a character the font cannot carry).
       */
      const writeRestyledTwin = (object: unknown, text: string, restyle: Restyle): unknown => {
        const twin = makeTextLike(bindings, document, object, matrixOn(bindings, object).e, standardFontRestyled(object, restyle));
        if (!trySetText(bindings, twin, text) || (mode === 'write' && !carries(twin, text))) {
          bindings.destroyObject(twin);
          throw new TextNotWritableError(uncarriedIn(object, text));
        }
        insertAfter(twin, object);
        removed.push(object);
        if (mode === 'write') {
          const at = written.findIndex((entry) => entry.object === object);
          if (at !== -1) written.splice(at, 1);
          record(twin, text);
        }
        return twin;
      };

      /**
       * Whether this process sets a word its run's font cannot carry in a catalogue face (ADR-0173 Decision 4), or
       * keeps the standard twin of before. The catalogue itself is read by the first word that needs it (`faces`).
       */
      const inPiecesHere = editFacesBound();
      const faces = (): FaceSource => {
        const read = editFaces();
        if (read === null) throw new Error('An edit asked for the bundled fonts in a process given none.');
        return read;
      };
      /** The resolver faces this edit loaded, by face and weight: ours to close, with the standard fonts. */
      const faceFonts = new Map<string, unknown>();
      /** Their programs, held for the edit's length, because PDFium is handed a pointer to them. */
      const facePrograms: Uint8Array[] = [];
      /** The text each piece object holds, so a wrap can trim a run's pieces from their end. */
      const pieceTexts = new Map<unknown, string>();
      /** Whether a run's own font, or a sibling of it, draws a segment, asked once per font and segment of this edit. */
      const ownAnswers = new Map<string, boolean>();
      /** Each font's siblings on this page, by the font's address, found once per edit. */
      const siblingFonts = new Map<string, readonly unknown[]>();
      /**
       * The run's SIBLINGS (ADR-0173 Decision 4): every other EMBEDDED font on this page whose name, less its subset tag
       * (`withoutSubsetTag`), is the run's own font's, each once, in the page's order. So `ABCDEF+Calibri` lacking `é`
       * finds `GHIJKL+Calibri` drawing it, and the word stays in the document's own font. Embedded only: a standard font
       * of the same name is the twin trap — measured 2026-09-24, Helvetica in StandardEncoding reads `é` on the live page
       * and `Ø` once saved — and would turn an edit the catalogue can make into a refusal. The page, not the document:
       * the other pages' fonts are reached only by loading them, which an edit of one page does not do.
       */
      const siblingsOf = (object: unknown): readonly unknown[] => {
        const own: unknown = bindings.textFont(object);
        if (own === null) return [];
        const key = String(koffi.address(own));
        const known = siblingFonts.get(key);
        if (known !== undefined) return known;
        const name = withoutSubsetTag(baseNameOf(bindings, own));
        const found: unknown[] = [];
        const seen = new Set([key]);
        const count = name === '' ? 0 : numberFrom(bindings.countObjects(handle), 'FPDFPage_CountObjects');
        for (let index = 0; index < count; index += 1) {
          const each: unknown = bindings.getObject(handle, index);
          if (each === null || numberFrom(bindings.objectType(each), 'FPDFPageObj_GetType') !== TEXT_OBJECT) continue;
          const font: unknown = bindings.textFont(each);
          if (font === null) continue;
          const address = String(koffi.address(font));
          if (seen.has(address)) continue;
          seen.add(address);
          if (numberFrom(bindings.fontIsEmbedded(font), 'FPDFFont_GetIsEmbedded') !== 1) continue;
          if (withoutSubsetTag(baseNameOf(bindings, font)) === name) found.push(font);
        }
        siblingFonts.set(key, found);
        return found;
      };

      /** `face` at `weight`, loaded once for this edit as a uniquely named subset, or `null` where it cannot be. */
      const faceFont = (face: CatalogueFace, weight: number): unknown => {
        const key = `${face.id}|${String(weight)}`;
        const loaded = faceFonts.get(key);
        if (loaded !== undefined) return loaded;
        const whole = faces().read(face.path);
        const named = readFace(whole, face.faceIndex).postscript;
        // A VARIABLE FACE'S NAME says which instance it is, as the composers name one (`composeFonts.ts`).
        const postscript = face.weights === null ? named : `${named === '' ? 'Font' : named}-wght${String(weight)}`;
        const subset = namedSubset(whole, postscript, {
          unicodes: characters.filter((point) => face.unicodes.has(point)),
          faceIndex: face.faceIndex,
          axes: face.weights === null ? {} : { wght: weight },
        });
        // THE WHOLE FONT only where HarfBuzz refused the subset, the licence allows it, and it is one static face
        // PDFium can load as it stands (Decision 5).
        const program =
          subset?.bytes ?? (face.embedding !== 'never' && face.weights === null && face.faceIndex === 0 ? whole : null);
        if (program === null) return null;
        const font: unknown = bindings.loadFont(document, program, program.length, FONT_TRUETYPE, 1);
        if (font === null) return null;
        facePrograms.push(program);
        faceFonts.set(key, font);
        // ITS GLYPHS, read from the very program PDFium was handed: the codes it writes are that program's glyph ids.
        faceGlyphs.set(String(koffi.address(font)), new ShapingFace(program, 0, {}));
        return font;
      };

      /**
       * The box font for `character` (ADR-0173 Decision 7 as corrected, `boxFont.ts`): the box of the piece's own face
       * where it has one, else of the first catalogue face that does, in the catalogue's order — so the box sits in the
       * face beside it where it can. Loaded once per character and command; `null` where no face has a box.
       */
      const boxFontLike = (face: CatalogueFace | null, weight: number, character: string): unknown => {
        const point = character.codePointAt(0) ?? 0;
        const candidates = [...(face === null ? [] : [face]), ...faces().faces].filter((each) => each.unicodes.has(BOX));
        for (const candidate of candidates) {
          const pin = candidate.weights === null ? candidate.weight : weight;
          const key = `box|${candidate.id}|${String(pin)}|${String(point)}`;
          const loaded = faceFonts.get(key);
          if (loaded !== undefined) return loaded;
          const whole = faces().read(candidate.path);
          const named = readFace(whole, candidate.faceIndex).postscript;
          const postscript = candidate.weights === null ? named : `${named === '' ? 'Font' : named}-wght${String(pin)}`;
          const made = boxFont(whole, candidate.faceIndex, candidate.weights === null ? {} : { wght: pin }, postscript, point);
          if (made === null) continue;
          const font: unknown = bindings.loadFont(document, made.bytes, made.bytes.length, FONT_TRUETYPE, 1);
          if (font === null) continue;
          facePrograms.push(made.bytes);
          faceFonts.set(key, font);
          faceGlyphs.set(String(koffi.address(font)), new ShapingFace(made.bytes, 0, {}));
          return font;
        }
        return null;
      };
      /** Each box this edit drew and the character it stands for, read at the end against what was removed. */
      const boxObjects = new Map<unknown, string>();

      /**
       * Writes `text` as the run `object` heads and answers the objects that now say it, in order: `object` alone where
       * its own font carries the text, and otherwise its PIECES (ADR-0173 Decisions 1 to 3) — each word its font cannot
       * carry in the resolver's face, the rest in its own, each placed at the measured right edge of the one before
       * and inserted after it. Where this process has no catalogue, the standard twin of {@link write} as before.
       *
       * Every piece is read back as it is written, `write`'s reason. A character no face carries is a box, one object
       * per character in a box font of its own (Decision 7 as corrected); a piece whose face cannot be loaded, or a
       * box where no face has one, refuses the edit by name.
       *
       * A TRIAL PROBES TOO, unlike `write`'s: which words become pieces decides the line's width, and a trial that
       * measured the run's own font where the write sets another would fit a block to text that is not drawn.
       */
      const writePieces = (object: unknown, text: string, restyle?: Restyle): unknown[] => {
        // A WORD THE PERSON MADE BOLD, ITALIC OR ANOTHER FAMILY is set in a face that is that, whichever font the run is
        // in (ADR-0180 Decision 4): the run's own font is not preferred, because it is the wrong one by definition.
        if (restyle !== undefined && !inPiecesHere) return [writeRestyledTwin(object, text, restyle)];
        if (!inPiecesHere) return [write(object, text)];
        if (restyle === undefined && setOn(object, text) && keepsItsObject(object, text)) {
          if (mode === 'write') record(object, text);
          pieceTexts.set(object, text);
          return [object];
        }
        const font = String(koffi.address(bindings.textFont(object)));
        const ownCarries = (segment: string): boolean => {
          // RESTYLED: only white space stays in the run's font; a word goes to the resolver for the style asked.
          if (restyle !== undefined) return segment.trim() === '';
          const key = `${font}|${segment}`;
          let answer = ownAnswers.get(key);
          if (answer === undefined) {
            answer = segment.trim() === '' ? true : carries(object, segment);
            ownAnswers.set(key, answer);
          }
          return answer;
        };
        const style = styleOf(bindings, object, programs);
        // EACH SIBLING ASKED AS THE RUN'S OWN FONT IS, by the probe, and once per segment. A restyled word has none: a
        // sibling is the run's own face under another subset tag.
        const fonts = restyle === undefined ? siblingsOf(object) : [];
        const siblings = fonts.map((sibling) => ({
          carries: (segment: string): boolean => {
            const asked = `${String(koffi.address(sibling))}|${segment}`;
            let answer = ownAnswers.get(asked);
            if (answer === undefined) {
              answer = carries(object, segment, sibling);
              ownAnswers.set(asked, answer);
            }
            return answer;
          },
        }));
        const request = {
          family: restyle?.family ?? style.font,
          bold: restyle?.bold ?? style.bold,
          italic: restyle?.italic ?? style.italic,
          own: [],
        };
        const split = editPieces(text, ownCarries, request, faces().faces, siblings);
        // A LINE THAT RUNS BOTH WAYS IS ONE OBJECT where one face carries all of it. A text page reads the objects of a
        // line in the order they stand and each object in its own direction, so a line split between two fonts reads
        // back with its parts in drawing order (measured 2026-10-06: `Hello שלום` drawn as two objects reads back as
        // `Helloשלום`), where one object is read back as typed. The cost is that the line's Latin words are not in the
        // document's own font, which only a line with right-to-left letters in it pays (ADR-0181 Decision 5).
        const whole = split.length > 1 && isBidirectional(text) ? resolveRuns(text, request, faces().faces) : [];
        const only = whole.length === 1 && whole[0]?.face != null && whole[0].missing.length === 0 ? whole[0] : undefined;
        const onlyFace = only === undefined ? undefined : faces().faces.find((each) => each.id === only.face?.id);
        const pieces: EditPiece[] =
          only === undefined || onlyFace === undefined
            ? split
            : [{ text, face: onlyFace, sibling: null, weight: only.weight, boxed: [] }];
        // A BOXED PIECE IS ONE OBJECT PER CHARACTER, each in a box font of its own (Decision 7): one glyph has one code,
        // and one code reads as one text.
        const carried = (piece: EditPiece, said: string): boolean =>
          piece.face !== null
            ? Array.from(said).every((character) => piece.face?.unicodes.has(character.codePointAt(0) ?? 0) === true)
            : piece.sibling !== null
              ? (siblings[piece.sibling]?.carries(said) ?? false)
              : ownCarries(said);
        const units = inDrawingOrder(text, pieces, carried).flatMap((piece) => {
          const { face, weight, rtl } = piece;
          if (piece.boxed.length > 0) {
            // ONE GLYPH EACH IN DRAWING ORDER: a right-to-left piece's characters are placed last typed first.
            const characters = Array.from(piece.text);
            return (rtl ? characters.reverse() : characters).map((character) => ({
              text: character,
              rtl: false,
              font: (): unknown => boxFontLike(face, weight, character),
              box: true,
            }));
          }
          // A SIBLING'S PIECE in the document's own font handle, which is the document's and not ours to close.
          const sibling = piece.sibling === null ? undefined : fonts[piece.sibling];
          if (sibling !== undefined) return [{ text: piece.text, rtl, font: (): unknown => sibling, box: false }];
          return [{ text: piece.text, rtl, font: face === null ? null : (): unknown => faceFont(face, weight), box: false }];
        });
        const objects: unknown[] = [];
        let left = matrixOn(bindings, object).e;
        for (const unit of units) {
          const reuse = unit.font === null && objects.length === 0;
          const unitFont = unit.font === null ? bindings.textFont(object) : unit.font();
          if (unitFont === null) throw new TextNotWritableError(unit.text.trim());
          const made = reuse ? object : makeTextLike(bindings, document, object, left, unitFont);
          if (!setOn(made, unit.text, unit.rtl) || (mode === 'write' && !carries(made, unit.text, undefined, unit.rtl))) {
            if (!reuse) bindings.destroyObject(made);
            throw new TextNotWritableError(unit.text.trim());
          }
          if (!reuse) insertAfter(made, objects.at(-1) ?? object);
          if (mode === 'write') record(made, unit.text, unit.rtl);
          pieceTexts.set(made, unit.text);
          if (unit.box) boxObjects.set(made, unit.text);
          objects.push(made);
          left = boundsOf(bindings, made).right;
        }
        // THE RUN'S OWN OBJECT GOES where its first piece is in another face, and with it what it was recorded as.
        if (objects[0] !== object) {
          removed.push(object);
          const at = written.findIndex((entry) => entry.object === object);
          if (at !== -1) written.splice(at, 1);
        }
        return objects;
      };

      /**
       * Trims a run's pieces so that together they say `text`, a prefix of what they said: whole pieces off the end,
       * then the last one kept cut where `text` ends. Each piece's font carries every prefix of its own text, so nothing
       * is asked again; what each now says is recorded for the read-back.
       */
      const trimPieces = (objects: readonly unknown[], text: string): unknown[] => {
        const kept: unknown[] = [];
        let at = 0;
        for (const piece of objects) {
          const said = pieceTexts.get(piece) ?? '';
          if (at >= text.length) {
            removed.push(piece);
            const entry = written.findIndex((write) => write.object === piece);
            if (entry !== -1) written.splice(entry, 1);
            continue;
          }
          const now = text.slice(at, at + said.length);
          at += said.length;
          if (now !== said) {
            if (!setOn(piece, now)) throw refusedAt('set-text', 'A block edit could not cut a piece it had already written');
            pieceTexts.set(piece, now);
          }
          if (mode === 'write') record(piece, now);
          kept.push(piece);
        }
        return kept;
      };
      return {
        inPieces: inPiecesHere,
        written,
        removed,
        insertAfter,
        write,
        writePieces,
        trimPieces,
        record,
        standardFontLike,
        standardFontRestyled,
        seed,
        styleOfObject,
        uncarriedIn,
        keepsItsObject,
        boxed: () => {
          // A box a wrap trimmed off one line was drawn again on the next, and is told once, where it is.
          const gone = new Set(removed);
          return [...boxObjects].flatMap(([object, character]) => (gone.has(object) ? [] : [{ character, page }]));
        },
        close: () => {
          // OURS TO CLOSE, and only ours: each object holds its own reference to
          // the font it was made in, so closing the caller's handle frees nothing
          // the page still draws.
          for (const font of standardFonts.values()) bindings.closeFont(font);
          for (const font of faceFonts.values()) bindings.closeFont(font);
          // THE SCRATCH PAGE GOES before the caller can generate or save anything.
          if (scratch !== undefined) {
            bindings.closePage(scratch.handle);
            bindings.deletePage(document, scratch.index);
          }
        },
      };
}

/**
 * One pass over a page's block edits: `write` makes the edit and generates the page, naming its writes to the
 * generation; `trial` lays the blocks out at the scales given, writes without reading back, generates nothing. Both
 * answer which blocks ended above their original last line.
 */
function layOutBlocks(
  session: PdfiumSession,
  handle: unknown,
  page: number,
  given: readonly BlockEdit[],
  inserts: readonly PageInsert[],
  scales: readonly number[],
  mode: 'write' | 'trial',
): { readonly fits: readonly boolean[]; readonly boxed: readonly BoxedInEdit[] } {
      const bindings = api();
      const document = documentFor(session);
      const pen = pieceWriter(
        session,
        handle,
        page,
        mode,
        charactersOf([...given.map(({ text }) => text), ...inserts.map(({ text }) => text)]),
      );
      try {
      // AN ADDED BOX IS AN EDIT OF ONE RUN: a text object appended to the page in the box's own face and place, which the
      // layout then replaces with the box's words at the measure it was given (ADR-0180 Decision 6, corrected). It is
      // made BEFORE the page is read, so it is one of the runs the reading answers and is named as any run is.
      const seeds = inserts.map((insert) =>
        pen.seed({
          family: insert.base?.family,
          bold: insert.base?.bold,
          italic: insert.base?.italic,
          size: insert.size,
          colour: insert.base?.colour,
          left: insert.left,
          baseline: insert.baseline,
        }),
      );
      const seeded = objectIndices(bindings, handle);
      const edits: readonly BlockEdit[] = [
        ...given,
        ...inserts.map((insert, at): BlockEdit => {
          const index = seeded.get(String(koffi.address(seeds[at])));
          if (index === undefined) throw refusedAt('object', `An added box on page ${String(page)} is not on the page it was added to`);
          return {
            lines: [[index]],
            soft: [false],
            text: insert.text,
            ...(insert.marks === undefined ? {} : { marks: insert.marks }),
            ...(insert.paragraphs === undefined ? {} : { paragraphs: insert.paragraphs }),
            place: { width: insert.measure },
            fit: 'reflow',
          };
        }),
      ];
      const walked = walkRuns(bindings, handle);
      /** Per block: did its layout end above its original last line? */
      const fits = edits.map(() => true);
      // THE PAGE'S BOX, for a one-line block's column (ADR-0097 4a).
      const box: Record<string, number> = {};
      const hasBox = numberFrom(bindings.pageBox(handle, box), 'FPDF_GetPageBoundingBox') === 1;
      const pageLeft = hasBox ? (box['left'] ?? 0) : 0;
      const pageRight = hasBox ? (box['right'] ?? 0) : Number.NEGATIVE_INFINITY;

      // EVERY BLOCK RESOLVED IN FULL FIRST, against the untouched page, so a bad
      // index refuses before anything is written — and so a later block's
      // indices are the page's own, not whatever an earlier block left behind.
      // A NAMED RUN IS ITS OBJECTS: the same join the read answered (`joinedWalk`, ADR-0130) expands each run an edit
      // names into the objects it is, in order — so a line drawn one glyph per object is written as the person saw it.
      const joined = joinedWalk(bindings, handle, walked);
      const blocks = edits.map((edit) => ({
        text: edit.text,
        soft: edit.soft,
        marks: edit.marks ?? [],
        paragraphs: edit.paragraphs ?? [],
        place: edit.place,
        fit: edit.fit,
        lines: edit.lines.map((line) =>
          line.map((named): HeldRun => {
            const members = membersOf(joined, named);
            if (members === undefined) {
              throw refusedAt(
                'object',
                `Object ${String(named)} on page ${String(page)} begins no run this page's reading answered`,
              );
            }
            const held = members.map((index) => {
              const run = walked.runs.get(index);
              if (run === undefined) {
                throw refusedAt(
                  'object',
                  `Object ${String(index)} on page ${String(page)} carries no text this page's reading can place`,
                );
              }
              return { object: textObjectAt(bindings, handle, page, index), run };
            });
            const [first, ...rest] = held;
            if (first === undefined) throw refusedAt('object', `Run ${String(named)} on page ${String(page)} has no object`);
            return {
              index: named,
              object: first.object,
              text: held.map((member) => member.run.text).join(''),
              extras: rest.map((member) => member.object),
              span: {
                left: Math.min(...held.map((member) => member.run.left)),
                right: Math.max(...held.map((member) => member.run.right)),
              },
            };
          }),
        ),
      }));
      if (blocks.length === 0) throw new Error(`A block edit on page ${String(page)} named no block.`);
      // A RUN IN TWO BLOCKS would be written twice, the second write undoing
      // the first's layout. The contract refuses it; this is the write keeping
      // the rule for a caller that did not ask.
      const named = blocks.flatMap((block) => block.lines.flat().map((run) => run.index));
      if (new Set(named).size !== named.length) {
        throw new Error(`A block edit on page ${String(page)} names one run in two blocks.`);
      }

      const { written, removed, insertAfter, writePieces } = pen;
      /** Whether any block was placed, which is a change the page's generation must be told of though no word moved. */
      let placed = false;

        for (const [blockAt, block] of blocks.entries()) {
          const { lines } = block;
          const [firstLine] = lines;
          const [firstRun] = firstLine ?? [];
          if (firstLine === undefined || firstRun === undefined) {
            throw new Error(`A block edit on page ${String(page)} named no line.`);
          }
          // ROTATED OR SKEWED TEXT IS REFUSED rather than wrapped along an axis
          // it is not set on. The read offers no such block; this is the write
          // keeping the same rule for a caller that did not ask.
          for (const run of lines.flat()) {
            const matrix = matrixOn(bindings, run.object);
            if (!isUpright(matrix.a, matrix.b, matrix.c, matrix.d)) {
              throw refusedAt(
                'matrix',
                `Object ${String(run.index)} on page ${String(page)} is not set upright, so it is not edited in place`,
              );
            }
          }

          // THE BLOCK'S EDGES, in the measure every later comparison uses: the
          // objects' own bounds, read before anything moves or scales.
          const edges = lines.flat().map((run) => boundsOf(bindings, run.object));
          const blockLeft = Math.min(...edges.map((edge) => edge.left));
          const blockTop = Math.max(...edges.map((edge) => edge.top));
          // A ONE-LINE BLOCK WRAPS AT ITS COLUMN (ADR-0097 4a): its own right edge is only where
          // its old text stopped. The column is the page less the block's left margin, mirrored —
          // never narrower than the block itself. A block of several lines keeps the measure its
          // paragraph was set to.
          const ownRight = Math.max(...edges.map((edge) => edge.right));
          // A MEASURE THE PERSON GAVE (a resized box, an added one) is the measure, from the block's own left edge.
          const blockRight =
            block.place?.width !== undefined
              ? blockLeft + block.place.width
              : lines.length === 1
                ? Math.max(ownRight, pageRight - (blockLeft - pageLeft))
                : ownRight;
          // WHERE THE BLOCK ENDED, before anything moves: a fitted block must end above it.
          const lastBaselineBefore = matrixOn(bindings, (lines[lines.length - 1]?.[0] ?? firstRun).object).f;

          // SCALED UNIFORMLY about the block's top-left (ADR-0097 4b) — size, and position — so a
          // fitted block shrinks into the corner it started from and every later measure is of
          // the scaled objects. The right edge is NOT scaled: smaller words fill the same measure.
          const scale = scales[blockAt] ?? 1;
          if (scale !== 1) {
            for (const run of lines.flat()) {
              const matrix = matrixOn(bindings, run.object);
              setMatrixOn(bindings, run.object, {
                a: matrix.a * scale,
                b: matrix.b * scale,
                c: matrix.c * scale,
                d: matrix.d * scale,
                e: blockLeft + (matrix.e - blockLeft) * scale,
                f: blockTop + (matrix.f - blockTop) * scale,
              });
            }
          }
          const baselines = lines.map((line) => matrixOn(bindings, (line[0] ?? firstRun).object).f);
          const pitch = blockPitch(bindings, firstRun.object, baselines);

          // THE BLOCK AS PARAGRAPHS (ADR-0179): which lines end a paragraph, how it is set, and what its words say.
          const soft = lines.map((_, at) => at < lines.length - 1 && block.soft[at] === true);
          const flow: FlowLine[] = lines.map((line, at) => ({
            runs: line.map((run) => ({ id: run.index, text: run.text })),
            soft: soft[at] === true,
          }));
          // THE SHAPE FROM THE RUNS' OWN EXTENTS, read before anything moved, by the one function the read answers it
          // with, so the editor's box and this layout are one shape (B3a).
          const shape = blockShape(
            lines.map((line) => ({
              x0: Math.min(...line.map((run) => run.span.left)),
              x1: Math.max(...line.map((run) => run.span.right)),
              characters: line.reduce((sum, run) => sum + run.text.length, 0),
            })),
            soft,
          );
          const spacing = paragraphSpacing(baselines, soft);
          // A SCALED BLOCK'S LEFT EDGE MOVED with the scale about its corner; its right edge did not (ADR-0097 4b).
          const scaledX = (x: number): number => blockLeft + (x - blockLeft) * scale;
          // HOW EACH PARAGRAPH IS SET: the block's shape with what the person set over it (ADR-0180 Decision 2).
          const settings = new Map(block.paragraphs.map((setting) => [setting.paragraph, setting]));
          const setFor = (place: number): { align: Alignment; leftEdge: number; first: number; centre: number } => {
            const own = settings.get(place);
            const align = own?.align ?? shape.align;
            const leftEdge = own?.leftIndent === undefined ? shape.left : blockLeft + own.leftIndent;
            const first = own?.firstIndent ?? (own?.leftIndent === undefined ? shape.firstIndent : 0);
            // THE CENTRE the block's own lines keep where it was centred and the person did not move it; otherwise the
            // middle of the paragraph's column.
            const centre = own?.align === undefined && shape.align === 'center' ? shape.centre : (leftEdge + blockRight) / 2;
            return { align, leftEdge, first, centre };
          };
          const limits = (place: number): { first: number; rest: number } => {
            const set = setFor(place);
            if (set.align === 'center') {
              const across = Math.max(1, 2 * Math.min(blockRight - set.centre, set.centre - set.leftEdge));
              return { first: across, rest: across };
            }
            if (set.align === 'right') {
              const across = Math.max(1, blockRight - set.leftEdge);
              return { first: across, rest: across };
            }
            return {
              first: Math.max(1, blockRight - scaledX(set.leftEdge + set.first)),
              rest: Math.max(1, blockRight - scaledX(set.leftEdge)),
            };
          };
          /** The paragraphs whose settings the person changed from how the block was found: set again, words or not. */
          const changedSettings = block.paragraphs
            .filter(
              (setting) =>
                (setting.align !== undefined && setting.align !== shape.align) ||
                (setting.leftIndent !== undefined && Math.abs(blockLeft + setting.leftIndent - shape.left) > 0.5) ||
                (setting.firstIndent !== undefined && Math.abs(setting.firstIndent - shape.firstIndent) > 0.5) ||
                (setting.lineSpacing !== undefined && Math.abs(setting.lineSpacing - 1) > 0.01) ||
                (setting.spaceBefore !== undefined && setting.spaceBefore > 0.5),
            )
            .map((setting) => setting.paragraph);
          // A NEW MEASURE SETS EVERY PARAGRAPH AGAIN, words or not: the lines the old measure broke are not the lines the
          // new one does.
          const everyParagraph =
            block.place?.width === undefined ? [] : Array.from({ length: block.text.split('\n').length }, (_, paragraph) => paragraph);
          const forced = new Set([...changedSettings, ...everyParagraph]);
          const runsById = new Map(lines.flat().map((run) => [run.index, run]));
          const lineOfRun = new Map(lines.flatMap((line, at) => line.map((run): [HeldRun, number] => [run, at])));
          // WHERE A LINE SET AFRESH STARTS, as an object's own origin: the line that keeps the paragraph's left edge, read
          // off its first object, since the shape's edge is where ink begins and an origin is where the glyph is drawn from.
          const lefts = lines.map((line) => Math.min(...line.map((run) => run.span.left)));
          const restLines = lines.length > 1 ? lines.slice(1).map((_, at) => at + 1) : [0];
          const restAt = restLines.reduce((best, at) => ((lefts[at] ?? 0) < (lefts[best] ?? 0) ? at : best), restLines[0] ?? 0);
          const restOrigin = matrixOn(bindings, (lines[restAt]?.[0] ?? firstRun).object).e;
          // WHAT A MARK MAKES OF A RUN'S WORDS (ADR-0180 Decision 4), read from the run's own object: the face it asks, the
          // size it ends at against the size the run is, and where it rises to.
          const markStyle = (run: HeldRun, mark: number) => {
            const set: BlockMarkSet = block.marks[mark]?.set ?? {};
            const style = pen.styleOfObject(run.object);
            const restyle: Restyle | undefined =
              set.bold === undefined && set.italic === undefined && set.family === undefined
                ? undefined
                : {
                    ...(set.bold === undefined ? {} : { bold: set.bold }),
                    ...(set.italic === undefined ? {} : { italic: set.italic }),
                    ...(set.family === undefined ? {} : { family: set.family }),
                  };
            const size = set.size ?? style.size;
            const factor = (size / Math.max(style.size, 0.01)) * (set.rise === undefined ? 1 : RISE_SCALE);
            return { set, style, restyle, size, factor };
          };
          const changes = (run: number, mark: number): boolean => {
            const { set, style } = markStyle(runsById.get(run) ?? firstRun, mark);
            return (
              (set.bold !== undefined && set.bold !== style.bold) ||
              (set.italic !== undefined && set.italic !== style.italic) ||
              (set.size !== undefined && Math.abs(set.size - style.size) > 0.05) ||
              (set.colour !== undefined &&
                (set.colour.r !== style.colour.r || set.colour.g !== style.colour.g || set.colour.b !== style.colour.b)) ||
              (set.family !== undefined && !style.font.toLowerCase().includes(set.family.toLowerCase())) ||
              // NOT READABLE, so a mark that asks for it is a change: an underline is a line the page may or may not have.
              set.underline === true ||
              set.rise !== undefined
            );
          };
          const measure = blockMeasure(bindings, document, pen, runsById, firstRun, lines.flat(), (run, mark) => {
            const { restyle, factor } = markStyle(run, mark);
            return { restyle, factor };
          });
          const plan = planBlock(flow, block.text.replace(/\r\n?/gu, '\n'), measure, limits, {
            marks: block.marks.map(({ from, to }) => ({ from, to })),
            changes,
            forced,
          });
          /** The lines to draw under underlined words, made once the baselines are known. */
          const underlines: { left: number; width: number; size: number; colour: [number, number, number]; first: unknown; last: unknown }[] = [];

          /** The visual lines the block will have, top to bottom. `rise` is a run's offset from its line's baseline. */
          const visual: {
            objects: { object: unknown; rise: number }[];
            oldBaseline: number | undefined;
            gapAbove: number;
          }[] = [];
          const objectsOf = (line: readonly HeldRun[]): unknown[] => line.flatMap((run) => [run.object, ...run.extras]);
          /** The old lines the plan keeps as they stand. */
          const kept = new Set<number>();
          /** The object the block's reading order has reached, so a new line is inserted where it is seen. */
          let anchor: unknown = firstRun.object;
          for (const row of plan.rows) {
            if (row.kind === 'old') {
              const line = lines[row.line];
              if (line === undefined) continue;
              kept.add(row.line);
              const objects = objectsOf(line);
              visual.push({
                objects: objects.map((object) => ({ object, rise: 0 })),
                oldBaseline: baselines[row.line],
                gapAbove: row.line === 0 ? 0 : (baselines[row.line - 1] ?? 0) - (baselines[row.line] ?? 0),
              });
              anchor = objects.at(-1) ?? anchor;
              continue;
            }
            if (row.kind === 'blank') {
              visual.push({ objects: [], oldBaseline: undefined, gapAbove: pitch + (row.opens ? spacing : 0) });
              continue;
            }
            const set = setFor(row.paragraph);
            const own = settings.get(row.paragraph);
            // A LINE SET AFRESH, one object per run of words it holds, each in its own run's style and at the width the
            // plan measured: made, inserted after the line before it and written as it is made, because the read-back
            // that decides whether a word needs another face reads a text page, which holds only what is on the page.
            const replaced = row.replaces >= 0 ? lines[row.replaces] : undefined;
            // A PARAGRAPH THE PERSON LEFT ALONE keeps the line it stood in; one they set takes the edge they chose.
            const keepsItsLine =
              replaced !== undefined && own?.leftIndent === undefined && own?.firstIndent === undefined;
            const x =
              set.align === 'center'
                ? set.centre - row.width / 2
                : set.align === 'right'
                  ? blockRight - row.width
                  : keepsItsLine
                    ? matrixOn(bindings, (replaced[0] ?? firstRun).object).e
                    : restOrigin + (set.leftEdge - shape.left) * scale + (row.first ? set.first * scale : 0);
            const objects: { object: unknown; rise: number }[] = [];
            let left = x;
            let after = replaced === undefined ? anchor : (objectsOf(replaced).at(-1) ?? anchor);
            for (const piece of row.pieces) {
              const source = runsById.get(piece.run) ?? firstRun;
              const made = makeTextLike(bindings, document, source.object, left);
              insertAfter(made, after);
              let rise = matrixOn(bindings, source.object).f - (baselines[lineOfRun.get(source) ?? 0] ?? 0);
              const marked = piece.mark === NO_MARK ? undefined : markStyle(source, piece.mark);
              const laid = writePieces(made, piece.text, marked?.restyle);
              if (marked !== undefined) {
                // THE SIZE AND THE COLOUR the mark gives, on every object the piece became, about the first one's origin so
                // the pieces of one word keep their places.
                const origin = matrixOn(bindings, laid[0] ?? made).e;
                for (const object of laid) {
                  if (Math.abs(marked.factor - 1) > 1e-6) {
                    const m = matrixOn(bindings, object);
                    setMatrixOn(bindings, object, {
                      a: m.a * marked.factor,
                      b: m.b * marked.factor,
                      c: m.c * marked.factor,
                      d: m.d * marked.factor,
                      e: origin + (m.e - origin) * marked.factor,
                      f: m.f,
                    });
                  }
                  if (marked.set.colour !== undefined) {
                    bindings.setFillColour(object, marked.set.colour.r, marked.set.colour.g, marked.set.colour.b, 255);
                  }
                }
                if (marked.set.rise === 'superscript') rise += SUPERSCRIPT_RISE * marked.size;
                if (marked.set.rise === 'subscript') rise -= SUBSCRIPT_DROP * marked.size;
                if (marked.set.underline === true) {
                  const colour = marked.set.colour ?? marked.style.colour;
                  underlines.push({
                    left,
                    width: piece.width,
                    size: marked.size * (marked.set.rise === undefined ? 1 : RISE_SCALE),
                    colour: [colour.r, colour.g, colour.b],
                    first: laid[0] ?? made,
                    last: laid.at(-1) ?? made,
                  });
                }
              }
              for (const object of laid) objects.push({ object, rise });
              after = laid.at(-1) ?? made;
              left += piece.width;
            }
            anchor = after;
            // THE GAP ABOVE THIS LINE: the person's own where they set the paragraph's spacing, else the gap the line it
            // stands in had, else the block's pitch (and its paragraph spacing where it opens a paragraph).
            const lineGap = pitch * (own?.lineSpacing ?? 1);
            const spaced = own?.lineSpacing !== undefined || own?.spaceBefore !== undefined;
            visual.push({
              objects,
              oldBaseline: undefined,
              gapAbove: spaced
                ? lineGap + (row.first && visual.length > 0 ? (own.spaceBefore ?? spacing) : 0)
                : row.replaces > 0
                  ? (baselines[row.replaces - 1] ?? 0) - (baselines[row.replaces] ?? 0)
                  : pitch + (row.opens ? spacing : 0),
            });
          }
          // EVERY OLD LINE THE PLAN DID NOT KEEP goes at the end: a line set afresh stands in for it, or the person
          // removed it — a joined run's every object.
          for (const [at, line] of lines.entries()) if (!kept.has(at)) removed.push(...objectsOf(line));

          // THE LAYOUT, top to bottom: the first line stays where it is, and
          // each line after it sits its own gap below the one above.
          let baseline = baselines[0] ?? 0;
          for (const [at, line] of visual.entries()) {
            if (at > 0) baseline -= line.gapAbove;
            for (const { object, rise } of line.objects) {
              if (line.oldBaseline !== undefined) {
                moveBy(bindings, object, 0, baseline - line.oldBaseline);
              } else {
                const matrix = matrixOn(bindings, object);
                setMatrixOn(bindings, object, { ...matrix, f: baseline + rise });
              }
            }
          }
          // THE LINES UNDER UNDERLINED WORDS, now that the baselines are where they end: a filled rectangle a little below
          // the baseline, as long as the words are wide, inserted after the last object it underlines so the page reads
          // in the order it is seen.
          const rules: unknown[] = [];
          for (const line of underlines) {
            const thickness = Math.max(0.5, UNDERLINE_THICKNESS * line.size);
            const baselineAt = matrixOn(bindings, line.first).f;
            const rule: unknown = bindings.newRect(line.left, baselineAt - UNDERLINE_DROP * line.size - thickness, line.width, thickness);
            if (rule === null) throw refusedAt('object', 'FPDFPageObj_CreateNewRect refused the line under underlined words');
            bindings.setFillColour(rule, line.colour[0], line.colour[1], line.colour[2], 255);
            if (numberFrom(bindings.setDrawMode(rule, 1, 0), 'FPDFPath_SetDrawMode') !== 1) {
              throw refusedAt('object', 'FPDFPath_SetDrawMode refused the line under underlined words');
            }
            insertAfter(rule, line.last);
            rules.push(rule);
          }
          // THE BLOCK PLACED, now that it ends as it will: every object it is made of, its kept lines, the lines set
          // afresh and the rules under them, so it moves as the one thing it is. A trial lays out for a fit and places nothing.
          if (mode === 'write' && block.place !== undefined) {
            const mine = [...visual.flatMap((line) => line.objects.map(({ object }) => object)), ...rules];
            if (mine.length > 0) {
              if (placeObjects(bindings, mine, block.place, { x: blockLeft, y: blockTop })) placed = true;
            }
          }
          // A FITTED BLOCK FITS when its last line sits no lower than its old last line did. A
          // baseline, not a bounding box: a descender is not a line, and comparing bottoms would
          // shrink a block for a `g`.
          if (block.fit === 'shrink') fits[blockAt] = baseline >= lastBaselineBefore;
        }

        // A TRIAL ENDS HERE: nothing removed, nothing read back, nothing generated — the page is
        // closed and its changes go with it.
        if (mode === 'trial') return { fits, boxed: [] };

        if (written.length === 0 && removed.length === 0 && !placed && inserts.length === 0) {
          throw new Error(
            `A block edit on page ${String(page)} changed nothing. Regenerating a page's content ` +
              'stream is the whole cost of an edit, and this one would change nothing.',
          );
        }

        for (const object of removed) {
          if (numberFrom(bindings.removeObject(handle, object), 'FPDFPage_RemoveObject') !== 1) {
            throw refusedAt('object', `FPDFPage_RemoveObject refused an object this edit removes on page ${String(page)}`);
          }
          bindings.destroyObject(object);
        }

        // THE READ-BACK, from a live text page, before anything is generated —
        // every write once more, after every other write has moved it. A throw
        // here leaves the document as it came: nothing has been generated, and
        // the session is discarded with the page.
        const textPage: unknown = bindings.loadTextPage(handle);
        if (textPage === null) throw refusedAt('page', 'PDFium could not load the page to read the edit back');
        try {
          const drawn = drawnTextOn(
            bindings,
            textPage,
            written.map((write) => write.object),
          );
          const misread = misreadWrites(
            written.map((write) => write.text),
            drawn,
          );
          if (misread.length > 0) {
            throw new TextNotWritableError(unwritableCharacters(misread));
          }
        } finally {
          bindings.closeTextPage(textPage);
        }

        // THE WRITES ARE NAMED TO THE GENERATION, so the saved bytes are read back against them (ADR-0169). The live
        // read-back above cannot stand in for that for a twin: measured 2026-09-24, a Helvetica twin in a document
        // already holding a Helvetica-family font in StandardEncoding reads `é` here and is saved into that font's
        // dictionary, where `E9` is `Ø` — which `serialise` reports as this write's characters.
        generate(
          session,
          page,
          handle,
          written.map((write) => write.object),
        );
        // THE BOXES STILL ON THE PAGE (ADR-0174).
        return { fits, boxed: pen.boxed() };
      } finally {
        pen.close();
      }
}

/**
 * How wide a piece of text is in a run's style, for {@link planBlock}.
 *
 * PDFium sets no kerning and no shaping: an object's width is the sum of its characters' advances, so the width of a
 * word is the sum over its characters, and each character is measured once per run. `FPDFPageObj_GetBounds` is the ink
 * box, not the advance, so one character's advance is read as a DIFFERENCE of two ink right edges that share a
 * reference character the font carries: the right edge of `character` then `reference`, less that of `reference`
 * alone. That is exact for any character, a space included, whose own ink box is empty.
 *
 * Where the run's font cannot carry a character: in a process with a catalogue, the character is written as pieces on
 * the page for an instant, twice, and measured by the same difference (the face and box fonts the write will use); in
 * one without, the whole text is measured in the standard twin the write will use, and a character it refuses is the
 * refusal the write would give.
 */
function blockMeasure(
  bindings: Bound,
  document: unknown,
  pen: PieceWriter,
  runs: ReadonlyMap<number, HeldRun>,
  fallback: HeldRun,
  block: readonly HeldRun[],
  /** What a mark makes of a run's words: the face it asks and the factor its size and rise scale a width by. */
  styleFor: (run: HeldRun, mark: number) => { readonly restyle: Restyle | undefined; readonly factor: number },
): Measure {
  const inkRight = (source: unknown, text: string, font?: unknown): number | undefined => {
    const probe = makeTextLike(bindings, document, source, 0, font);
    try {
      return trySetText(bindings, probe, text) ? boundsOf(bindings, probe).right : undefined;
    } finally {
      bindings.destroyObject(probe);
    }
  };
  const characters = Array.from(new Set(block.flatMap((run) => Array.from(run.text)).filter((each) => each.trim() !== '')));
  const references = new Map<string, string | undefined>();
  const referenceFor = (key: string, source: unknown, font?: unknown, among: readonly string[] = characters): string | undefined => {
    if (references.has(key)) return references.get(key);
    const found = among.find((each) => inkRight(source, each, font) !== undefined);
    references.set(key, found);
    return found;
  };
  const advances = new Map<string, number | null>();
  const advanceOf = (
    kind: 'own' | 'twin',
    run: HeldRun,
    character: string,
    font?: unknown,
    among?: readonly string[],
    /** Which restyled face `font` is, so a bold twin and a plain one are not one answer. */
    variant = '',
  ): number | null => {
    const key = `${kind}${variant}|${String(run.index)}|${character}`;
    const known = advances.get(key);
    if (known !== undefined) return known;
    const source = run.object;
    const reference = referenceFor(`${kind}${variant}|${String(run.index)}`, source, font, among);
    let answer: number | null = null;
    if (reference !== undefined) {
      const both = inkRight(source, character + reference, font);
      const alone = inkRight(source, reference, font);
      answer = both === undefined || alone === undefined ? null : both - alone;
    }
    advances.set(key, answer);
    return answer;
  };
  /** One character set as pieces on the page and taken off again: its width is the second write less the first. */
  const piecesAdvance = (run: HeldRun, character: string, restyle?: Restyle): number => {
    const key = `pieces${JSON.stringify(restyle ?? null)}|${String(run.index)}|${character}`;
    const known = advances.get(key);
    if (known !== undefined && known !== null) return known;
    const rightOf = (text: string): number => {
      const object = makeTextLike(bindings, document, run.object, 0);
      pen.insertAfter(object, run.object);
      const objects = pen.writePieces(object, text, restyle);
      const right = spanOf(bindings, objects).right;
      for (const each of [object, ...objects]) {
        if (!pen.removed.includes(each)) pen.removed.push(each);
        const at = pen.written.findIndex((entry) => entry.object === each);
        if (at !== -1) pen.written.splice(at, 1);
      }
      return right;
    };
    const width = rightOf(character + character) - rightOf(character);
    advances.set(key, width);
    return width;
  };
  /** The width of `text` in a face a mark asked for: every character through the resolver's face, or the standard twin. */
  const restyledWidth = (run: HeldRun, restyle: Restyle, text: string): number => {
    const each = Array.from(text);
    if (pen.inPieces) return each.reduce((sum, character) => sum + piecesAdvance(run, character, restyle), 0);
    const twin = pen.standardFontRestyled(run.object, restyle);
    const widths = each.map((character) => advanceOf('twin', run, character, twin, ['x'], JSON.stringify(restyle)));
    if (widths.some((width) => width === null)) throw new TextNotWritableError(pen.uncarriedIn(run.object, text));
    return widths.reduce<number>((sum, width) => sum + (width ?? 0), 0);
  };
  /** The width of `text` in the run's own style: its font, then the pieces a character it lacks is set in. */
  const plainWidth = (run: HeldRun, text: string): number => {
    const each = Array.from(text);
    const own = each.map((character) => advanceOf('own', run, character));
    if (own.every((width) => width !== null)) return own.reduce((sum, width) => sum + width, 0);
    if (pen.inPieces) {
      return each.reduce((sum, character, at) => sum + (own[at] ?? piecesAdvance(run, character)), 0);
    }
    const twin = pen.standardFontLike(run.object);
    const widths = each.map((character) => advanceOf('twin', run, character, twin, ['x']));
    if (widths.some((width) => width === null)) throw new TextNotWritableError(pen.uncarriedIn(run.object, text));
    return widths.reduce<number>((sum, width) => sum + (width ?? 0), 0);
  };
  return (id, mark, text) => {
    const run = runs.get(id) ?? fallback;
    // A MARKED PIECE: the face it asks (where it asks one), scaled by its size and its rise. The size is applied to the
    // objects after they are written, so the width is the unscaled one times the factor.
    if (mark !== NO_MARK) {
      const { restyle, factor } = styleFor(run, mark);
      return factor * (restyle === undefined ? plainWidth(run, text) : restyledWidth(run, restyle, text));
    }
    return plainWidth(run, text);
  };
}

/**
 * The standard font nearest a run's style: Courier for fixed pitch, Times for
 * serif, Helvetica otherwise, each bold and italic as the style says — the
 * twelve of the fourteen that set text (ADR-0097). Read from {@link styleOf},
 * the one reading of a run's style, rather than from the flags again.
 */
function standardFontFor(style: Pick<RunStyle, 'bold' | 'italic' | 'mono' | 'serif'>): string {
  const { bold, italic } = style;
  if (style.mono) return `Courier${bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : ''}`;
  if (style.serif) return `Times${bold && italic ? '-BoldItalic' : bold ? '-Bold' : italic ? '-Italic' : '-Roman'}`;
  return `Helvetica${bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : ''}`;
}

/**
 * Whether a family a person asked for is a fixed-pitch or a serif kind, where it names one, and the run's own kind where
 * it does not: the ONE reading of a family's name that a restyled word and an added box both take (B3a).
 */
function kindOfFamily(
  family: string | undefined,
  own: Pick<RunStyle, 'mono' | 'serif'>,
): { readonly mono: boolean; readonly serif: boolean } {
  const asked = (family ?? '').toLowerCase();
  if (asked === '') return { mono: own.mono, serif: own.serif };
  return {
    mono: /courier|mono|consolas/u.test(asked),
    serif: /times|serif|georgia|garamond|cambria/u.test(asked) && !asked.includes('sans'),
  };
}

/** The one character an added box's text object starts from, which its words replace. */
const SEED_TEXT = '.';

/**
 * The distance between a block's lines: its first two baselines where it has
 * two, and otherwise the font's ascent to descent at the size the line is
 * drawn — the height the font itself says a line of it takes.
 */
function blockPitch(bindings: Bound, object: unknown, baselines: readonly number[]): number {
  const [first, second] = baselines;
  if (first !== undefined && second !== undefined && first - second > 0) return first - second;
  const font: unknown = bindings.textFont(object);
  const size = [0];
  numberFrom(bindings.textFontSize(object, size), 'FPDFTextObj_GetFontSize');
  const matrix = matrixOn(bindings, object);
  const drawn = (size[0] ?? 0) * Math.hypot(matrix.c, matrix.d);
  if (font !== null && drawn > 0) {
    const ascent = [0];
    const descent = [0];
    if (
      numberFrom(bindings.fontAscent(font, drawn, ascent), 'FPDFFont_GetAscent') === 1 &&
      numberFrom(bindings.fontDescent(font, drawn, descent), 'FPDFFont_GetDescent') === 1
    ) {
      const height = (ascent[0] ?? 0) - (descent[0] ?? 0);
      if (height > 0) return height;
    }
  }
  const bounds = boundsOf(bindings, object);
  return bounds.top - bounds.bottom;
}

/**
 * A new, uninserted text object set like `source` — its font, its size, its
 * matrix and its fill — starting at `left`.
 *
 * The font is the page's own ({@link Bound.textFont}) unless a twin's standard
 * font is handed in; either way nothing is loaded and nothing is closed here —
 * a standard font is the edit's to close.
 */
function makeTextLike(
  bindings: Bound,
  document: unknown,
  source: unknown,
  left: number,
  /** A standard font for a twin (ADR-0097); otherwise the source's own. */
  font: unknown = bindings.textFont(source),
): unknown {
  const size = [0];
  numberFrom(bindings.textFontSize(source, size), 'FPDFTextObj_GetFontSize');
  if (font === null) throw refusedAt('object', 'A text object answered no font, so a line in its style cannot be made');
  const object: unknown = bindings.createTextObject(document, font, size[0] ?? 0);
  if (object === null) throw refusedAt('object', 'FPDFPageObj_CreateTextObj refused the font of the line it continues');
  const matrix = matrixOn(bindings, source);
  setMatrixOn(bindings, object, { ...matrix, e: left });
  const red = [0];
  const green = [0];
  const blue = [0];
  const alpha = [0];
  if (numberFrom(bindings.getFillColour(source, red, green, blue, alpha), 'FPDFPageObj_GetFillColor') === 1) {
    bindings.setFillColour(object, red[0] ?? 0, green[0] ?? 0, blue[0] ?? 0, alpha[0] ?? 255);
  }
  // HOW IT IS PAINTED: the mode, and the stroke a stroking mode paints with. A new text object is mode 0, filled; a
  // line that replaced an invisible one (mode 3) would be drawn over the picture it was recognised from.
  const mode = numberFrom(bindings.getRenderMode(source), 'FPDFTextObj_GetTextRenderMode');
  if (mode > 0 && numberFrom(bindings.setRenderMode(object, mode), 'FPDFTextObj_SetTextRenderMode') !== 1) {
    throw refusedAt('object', 'FPDFTextObj_SetTextRenderMode refused the mode of the line a new one stands in for');
  }
  if (mode === 1 || mode === 2 || mode === 5 || mode === 6) {
    const width = [0];
    const r = [0];
    const g = [0];
    const b = [0];
    const a = [0];
    if (numberFrom(bindings.getStrokeColour(source, r, g, b, a), 'FPDFPageObj_GetStrokeColor') === 1) {
      bindings.setStrokeColour(object, r[0] ?? 0, g[0] ?? 0, b[0] ?? 0, a[0] ?? 255);
    }
    if (numberFrom(bindings.getStrokeWidth(source, width), 'FPDFPageObj_GetStrokeWidth') === 1) {
      bindings.setStrokeWidth(object, width[0] ?? 1);
    }
  }
  return object;
}

/**
 * The kinds `FPDFPageObj_GetType` names, as words.
 *
 * A word rather than PDFium's integer, because the integer is this library's
 * private numbering and the value travels to a person: a chooser that offered
 * *type 3* would be the object-index chooser's defect wearing a second number.
 * `unknown` is PDFium's own zero and is kept rather than folded into the
 * others — an object whose kind the engine will not name is a real answer, and
 * merging it into `path` would be this module guessing on the engine's behalf.
 */
const OBJECT_KINDS = ['unknown', 'text', 'path', 'image', 'shading', 'form'] as const;

/** What kind of thing a page object is. */
export type PageObjectKind = (typeof OBJECT_KINDS)[number];

/** A page object as the editor sees it: which, what kind, where, what colour. */
export interface PageObject {
  /** Its index in the page's own object order. `replaceTextObject`'s unit. */
  readonly index: number;
  readonly kind: PageObjectKind;
  /** Its box in PAGE space, after its own matrix. `FPDFPageObj_GetBounds`. */
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
  /**
   * Its fill colour, or `null` where the engine would not answer.
   *
   * A `null` rather than an opaque black, which is the same distinction
   * `charGenerated` draws for text: *this object has no fill* and *the fill is
   * black* are different facts, and a surface offering to recolour something
   * PDFium will not describe should say so rather than start from a guess.
   */
  readonly fill: { readonly red: number; readonly green: number; readonly blue: number; readonly alpha: number } | null;
}

/** An object's own transform, as `FS_MATRIX` carries it. */
export interface ObjectMatrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

/** How far to move an object, and how much to grow it. */
export interface ObjectPlacement {
  /** Points to add to x and y. Zero is legal: a pure scale moves nothing. */
  readonly moveBy: { readonly x: number; readonly y: number };
  /** Factors to multiply width and height by. One is legal: a pure move. */
  readonly scaleBy: { readonly x: number; readonly y: number };
}

/** The object at `index`, whatever its kind, with the range checked. */
function objectAt(bindings: Bound, handle: unknown, page: number, index: number): unknown {
  const total = numberFrom(bindings.countObjects(handle), 'FPDFPage_CountObjects');
  if (index < 0 || index >= total) {
    throw refusedAt('object', `Page ${String(page)} has ${String(total)} objects, so index ${String(index)} names none`);
  }
  const object: unknown = bindings.getObject(handle, index);
  if (object === null) {
    throw refusedAt('object', `FPDFPage_GetObject answered nothing for index ${String(index)} on page ${String(page)}`);
  }
  return object;
}

/** One object's box, read through `FPDFPageObj_GetBounds`. */
function boundsOf(
  bindings: Bound,
  object: unknown,
): { left: number; bottom: number; right: number; top: number } {
  // NOTE THE ORDER: left, BOTTOM, right, TOP — `FPDFText_GetCharBox` beside it
  // is left, right, bottom, top, and swapping them turns a height into a width
  // without failing.
  const left = [0];
  const bottom = [0];
  const right = [0];
  const top = [0];
  if (numberFrom(bindings.objectBounds(object, left, bottom, right, top), 'FPDFPageObj_GetBounds') !== 1) {
    throw refusedAt('object', 'FPDFPageObj_GetBounds refused an object this page handed back');
  }
  return { left: left[0] ?? 0, bottom: bottom[0] ?? 0, right: right[0] ?? 0, top: top[0] ?? 0 };
}

/**
 * Moves, scales and rotates a block's objects as ONE thing (ADR-0180, corrected 2026-10-06): scaled about `anchor` (its
 * top left), then turned about the centre of what that left, then moved. The three are composed into one matrix and
 * applied to each object once, so the block never stands half placed between steps.
 *
 * Measured against `FPDFPageObj_Transform` (2026-09-10): a matrix scales about the origin, so the anchor is composed
 * into the matrix here rather than left to the caller.
 */
function placeObjects(
  bindings: Bound,
  objects: readonly unknown[],
  place: Omit<BlockPlace, 'block'>,
  anchor: { readonly x: number; readonly y: number },
): boolean {
  const scale = place.scale ?? 1;
  const degrees = place.rotate ?? 0;
  const move = place.move ?? { x: 0, y: 0 };
  // A PLACEMENT THAT PLACES NOTHING is no change, so a page is not regenerated for it.
  if (scale === 1 && degrees === 0 && move.x === 0 && move.y === 0) return false;
  const edges = objects.map((object) => boundsOf(bindings, object));
  const centre = {
    x: (Math.min(...edges.map((edge) => edge.left)) + Math.max(...edges.map((edge) => edge.right))) / 2,
    y: (Math.min(...edges.map((edge) => edge.bottom)) + Math.max(...edges.map((edge) => edge.top))) / 2,
  };
  // THE CENTRE AFTER THE SCALE, which is what the turn is about.
  const turned = { x: anchor.x + (centre.x - anchor.x) * scale, y: anchor.y + (centre.y - anchor.y) * scale };
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const scaling: Matrix = { a: scale, b: 0, c: 0, d: scale, e: anchor.x * (1 - scale), f: anchor.y * (1 - scale) };
  const turning: Matrix = {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: turned.x - turned.x * cos + turned.y * sin,
    f: turned.y - turned.x * sin - turned.y * cos,
  };
  const moving: Matrix = { a: 1, b: 0, c: 0, d: 1, e: move.x, f: move.y };
  const whole = then(then(scaling, turning), moving);
  for (const object of objects) setMatrixOn(bindings, object, then(matrixOn(bindings, object), whole));
  return true;
}

/** `first` followed by `second`, in the row-vector order a PDF matrix composes in. */
function then(first: Matrix, second: Matrix): Matrix {
  return {
    a: first.a * second.a + first.b * second.c,
    b: first.a * second.b + first.b * second.d,
    c: first.c * second.a + first.d * second.c,
    d: first.c * second.b + first.d * second.d,
    e: first.e * second.a + first.f * second.c + second.e,
    f: first.e * second.b + first.f * second.d + second.f,
  };
}

/** The left and right edges of a run written as several objects (ADR-0173's pieces), from each one's own bounds. */
function spanOf(bindings: Bound, objects: readonly unknown[]): { left: number; right: number } {
  const edges = objects.map((object) => boundsOf(bindings, object));
  return { left: Math.min(...edges.map((edge) => edge.left)), right: Math.max(...edges.map((edge) => edge.right)) };
}

/**
 * Every object on a page: which, what kind, where and what colour.
 *
 * Indices rather than handles, `textObjectIndices`' reason: a `FPDF_PAGEOBJECT`
 * is owned by the page it came from and dies with it.
 *
 * Unlike that function this answers **every** object, not only the text ones —
 * the row it serves is *move / scale / recolor / delete any page object*, and a
 * walk that filtered would make an image the one thing on the page a person
 * could see and not select.
 */
export function pageObjects(session: PdfiumSession, page: number): Promise<readonly PageObject[]> {
  return promised(() =>
    onPage(session, page, (handle) => {
      const bindings = api();
      const total = numberFrom(bindings.countObjects(handle), 'FPDFPage_CountObjects');
      const found: PageObject[] = [];
      for (let index = 0; index < total; index += 1) {
        const object: unknown = bindings.getObject(handle, index);
        if (object === null) continue;
        const kind =
          OBJECT_KINDS[numberFrom(bindings.objectType(object), 'FPDFPageObj_GetType')] ?? 'unknown';
        const box = boundsOf(bindings, object);
        const red = [0];
        const green = [0];
        const blue = [0];
        const alpha = [0];
        // ONE CALL, ONE ANSWER: a non-1 return is *this engine will not say*,
        // and it becomes a `null` rather than an invented black.
        const gotFill = numberFrom(
          bindings.getFillColour(object, red, green, blue, alpha),
          'FPDFPageObj_GetFillColor',
        );
        found.push({
          index,
          kind,
          ...box,
          fill:
            gotFill === 1
              ? {
                  red: red[0] ?? 0,
                  green: green[0] ?? 0,
                  blue: blue[0] ?? 0,
                  alpha: alpha[0] ?? 0,
                }
              : null,
        });
      }
      return found;
    }),
  );
}

/**
 * One object's own matrix, for an inverse to put back.
 *
 * The whole of a placement's undo. Measured 2026-09-10: a `SetMatrix` of the
 * matrix read before a transform returns the object's bounds to exactly what
 * they were — so the inverse RESTORES rather than computing the opposite
 * transform, which is ADR-0009 §3's rule and is also the only version that
 * survives repeated floating-point work.
 */
export function objectMatrix(
  session: PdfiumSession,
  page: number,
  index: number,
): Promise<ObjectMatrix> {
  return promised(() =>
    onPage(session, page, (handle) => {
      const bindings = api();
      const object = objectAt(bindings, handle, page, index);
      const matrix: Record<string, unknown> = {};
      if (numberFrom(bindings.getMatrix(object, matrix), 'FPDFPageObj_GetMatrix') !== 1) {
        throw refusedAt(
          'matrix',
          `FPDFPageObj_GetMatrix refused object ${String(index)} on page ${String(page)}, so its ` +
            'placement cannot be recorded and an edit to it could not be undone',
        );
      }
      const read = (key: string): number => numberFrom(matrix[key], `FS_MATRIX.${key}`);
      return { a: read('a'), b: read('b'), c: read('c'), d: read('d'), e: read('e'), f: read('f') };
    }),
  );
}

/**
 * Moves and scales one object, and regenerates the page's content **once**.
 *
 * ## A SCALE IS ABOUT THE OBJECT'S OWN BOX, and PDFium's is not
 *
 * Measured 2026-09-10 (`scripts/research/pdfiumObjects.mjs`): a rectangle at
 * x=200..320 scaled by 2 through `FPDFPageObj_Transform` landed at **400..640**
 * — off a 400pt page — because a matrix scales about the coordinate system's
 * origin, which for a page is its bottom-left corner. That is never what a
 * person asking to make something twice as big means.
 *
 * So the composition happens here: translate the object's own anchor to the
 * origin, scale, translate back, then move. **The anchor is the box's
 * bottom-left corner**, which means an object grows right and up from where it
 * sits and the corner a person can see stays put. A centre anchor would be
 * equally defensible and is not more predictable; what matters is that one is
 * chosen, written down, and the same every time.
 *
 * The arithmetic is one matrix, not three calls: scaling about (px, py) and
 * then translating by (dx, dy) is `(sx, 0, 0, sy, px(1-sx)+dx, py(1-sy)+dy)`.
 *
 * ## And the transform COMPOSES, which is why nothing here reads the matrix
 *
 * Measured the same day: two +30 translations moved an object 60, not 30. So an
 * object's existing placement is preserved by construction and this call does
 * not have to read it. {@link objectMatrix} exists for the *inverse*, which is a
 * different question.
 *
 * @throws when the index names no object on the page.
 */
export function placeObject(
  session: PdfiumSession,
  page: number,
  index: number,
  placement: ObjectPlacement,
): Promise<void> {
  return promised(() => {
    onPage(session, page, (handle) => {
      const bindings = api();
      const object = objectAt(bindings, handle, page, index);
      const box = boundsOf(bindings, object);
      const { x: scaleX, y: scaleY } = placement.scaleBy;
      bindings.transform(
        object,
        scaleX,
        0,
        0,
        scaleY,
        box.left * (1 - scaleX) + placement.moveBy.x,
        box.bottom * (1 - scaleY) + placement.moveBy.y,
      );
      generate(session, page, handle);
    });
  });
}

/**
 * Puts one object's matrix back, and regenerates once.
 *
 * `placeObject`'s inverse, and it reads nothing off a command — the matrix it
 * is given is the whole restoring instruction (ADR-0009 §3).
 */
export function setObjectMatrix(
  session: PdfiumSession,
  page: number,
  index: number,
  matrix: ObjectMatrix,
): Promise<void> {
  return promised(() => {
    onPage(session, page, (handle) => {
      const bindings = api();
      const object = objectAt(bindings, handle, page, index);
      if (numberFrom(bindings.setMatrix(object, matrix), 'FPDFPageObj_SetMatrix') !== 1) {
        throw refusedAt('matrix', `FPDFPageObj_SetMatrix refused object ${String(index)} on page ${String(page)}`);
      }
      generate(session, page, handle);
    });
  });
}

/**
 * Composes `child` with `form`, which is the order a form's content is drawn in.
 *
 * A form is painted under its own matrix and each object inside it under its
 * own, so a child's effective placement is `child × form`. Getting the order
 * backwards puts the text somewhere else on a page that still renders, which is
 * the failure that looks like a working feature.
 */
function composed(child: ObjectMatrix, form: ObjectMatrix): ObjectMatrix {
  return {
    a: child.a * form.a + child.b * form.c,
    b: child.a * form.b + child.b * form.d,
    c: child.c * form.a + child.d * form.c,
    d: child.c * form.b + child.d * form.d,
    e: child.e * form.a + child.f * form.c + form.e,
    f: child.e * form.b + child.f * form.d + form.f,
  };
}

/**
 * Promotes every Form XObject's content onto the page, matrices composed in.
 *
 * ## What this is for
 *
 * `BUILD-PROMPT.md`:278's *normalize-then-edit*. `FPDFPage_GetObject` does not
 * descend into a form, so text pasted in as a block — which is how Office,
 * InDesign and PowerPoint emit it — is findable through `FPDFText` and nameable
 * by no editing command. Measured over the supplied corpus: two of eleven
 * documents carry such text, one of them with **no** page-level text at all.
 *
 * ## Measured before it was built (`scripts/research/pdfiumPromote.mjs`)
 *
 * - **The move is PDFium's own**: `FPDFFormObj_RemoveObject` transfers the child
 *   to the caller and `FPDFPage_InsertObject` takes it, both returning 1.
 * - **The composition lands the text where it was.** On a form placed at (40,80)
 *   and scaled 1.2, the promoted objects' bounds add up to exactly the box the
 *   form reported: 52.76–228.1 × 115.82–164.25.
 * - **Order is content.** Inserting the children in reverse put the second line
 *   ahead of the first in the extracted text — every pixel unmoved and the
 *   page's own reading of itself changed. Handles are taken in order, and
 *   inserted in order.
 * - **And the edit then survives the save**, which is the whole point: the same
 *   `FPDFText_SetText` that returns 1 and vanishes on a nested object persists
 *   once the object is on the page.
 *
 * ## It regenerates once, and only when something moved
 *
 * A page with no form pays no generation, which is `applyReplaceAllText`'s rule
 * and ADR-0047 Decision 2's reason.
 *
 * @returns how many objects were promoted, which is what tells a caller whether
 *   this page changed at all
 */
export function promoteFormObjects(session: PdfiumSession, page: number): Promise<number> {
  return promised(() =>
    onPage(session, page, (handle) => {
      const bindings = api();
      const total = numberFrom(bindings.countObjects(handle), 'FPDFPage_CountObjects');

      // THE FORMS ARE COLLECTED BEFORE ANYTHING IS REMOVED. `FPDFPage_GetObject`
      // is indexed, and removing while walking renumbers what is left — the
      // same hazard `removeObjects` answers by taking the object rather than
      // the index.
      const forms: unknown[] = [];
      for (let index = 0; index < total; index += 1) {
        const object = objectAt(bindings, handle, page, index);
        if (numberFrom(bindings.objectType(object), 'FPDFPageObj_GetType') === OBJECT_FORM) {
          forms.push(object);
        }
      }
      if (forms.length === 0) return 0;

      /** The form's matrix, or a throw: a form placed without it would draw its content somewhere else. */
      const matrixOfForm = (form: unknown): ObjectMatrix => {
        const matrix: ObjectMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        if (numberFrom(bindings.getMatrix(form, matrix), 'FPDFPageObj_GetMatrix') !== 1) {
          throw refusedAt(
            'matrix',
            `FPDFPageObj_GetMatrix refused a form object on page ${String(page)}, so its ` +
              'content cannot be placed and nothing was promoted',
          );
        }
        return matrix;
      };

      let moved = 0;
      /**
       * Moves `form`'s content onto the page under `placed` — the form's matrix composed with every form around it —
       * and A FORM INSIDE IT IS FLATTENED IN ITS PLACE, before the child after it. One promotion leaves no text in a
       * form at any depth: taking a nested form up to the page as an object left its content a form's again, so each
       * press emptied one level — measured in the owner's document 2026-10-02, 2,511 characters not editable, 597
       * after the first press, 0 after the second. And in its place, because order is content (see above): flattened
       * after its siblings, a nested form's lines would be read after the lines that follow it.
       */
      const flatten = (form: unknown, placed: ObjectMatrix): void => {
        const children = numberFrom(bindings.countFormObjects(form), 'FPDFFormObj_CountObjects');
        const kids: unknown[] = [];
        for (let index = 0; index < children; index += 1) {
          kids.push(bindings.formObject(form, index));
        }

        for (const child of kids) {
          const own: ObjectMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
          if (numberFrom(bindings.getMatrix(child, own), 'FPDFPageObj_GetMatrix') !== 1) continue;
          const target = composed(own, placed);
          if (numberFrom(bindings.objectType(child), 'FPDFPageObj_GetType') === OBJECT_FORM) {
            flatten(child, target);
            // THE EMPTIED INNER FORM GOES with its parent's other children: taken out of the parent and destroyed,
            // since nothing on the page holds it.
            if (numberFrom(bindings.removeFormObject(form, child), 'FPDFFormObj_RemoveObject') === 1) {
              bindings.destroyObject(child);
            }
            continue;
          }
          if (numberFrom(bindings.setMatrix(child, target), 'FPDFPageObj_SetMatrix') !== 1) {
            throw refusedAt(
              'matrix',
              `FPDFPageObj_SetMatrix refused a promoted object on page ${String(page)}. Nothing ` +
                'is inserted after a refusal: an object placed with its form matrix left out ' +
                'would render somewhere else on a page that still looks plausible',
            );
          }
          if (numberFrom(bindings.removeFormObject(form, child), 'FPDFFormObj_RemoveObject') !== 1) {
            continue;
          }
          // OWNERSHIP IS WITH US BETWEEN THESE TWO LINES, and `InsertObject`
          // frees the object itself on failure — so a failed insert is not a
          // leak and must not be followed by a destroy.
          if (numberFrom(bindings.insertObject(handle, child), 'FPDFPage_InsertObject') !== 1) {
            throw refusedAt(
              'object',
              `FPDFPage_InsertObject refused a promoted object on page ${String(page)}, which ` +
                'PDFium frees on failure, so that object is gone from this session',
            );
          }
          moved += 1;
        }
      };

      for (const form of forms) {
        flatten(form, matrixOfForm(form));
        // THE EMPTIED FORM GOES, or the page keeps a shape that draws nothing
        // and every index after it counts something invisible.
        if (numberFrom(bindings.removeObject(handle, form), 'FPDFPage_RemoveObject') === 1) {
          bindings.destroyObject(form);
        }
      }

      if (moved > 0) generate(session, page, handle);
      return moved;
    }),
  );
}

/** One object's new fill colour. */
export interface ObjectFill {
  readonly index: number;
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

/**
 * Recolours objects and regenerates the page's content **once**.
 *
 * Plural for `replaceTextObjects`' measured reason: generation is per call and
 * costs 13.7× over forty objects when paid per object. Recolouring a heading
 * and its rule is two objects and one thing the person did.
 *
 * **It reaches a TEXT object as well as a path** — measured 2026-09-10, both
 * returning 1 and both surviving a save and a reopen — which is what makes the
 * row's *any page object* true rather than aspirational.
 *
 * @throws on an empty list, `replaceTextObjects`' reason.
 * @throws when an index names no object, before anything is set.
 */
export function setObjectFills(
  session: PdfiumSession,
  page: number,
  fills: readonly ObjectFill[],
): Promise<void> {
  return promised(() => {
    onPage(session, page, (handle) => {
      const bindings = api();
      if (fills.length === 0) {
        throw new Error(
          `A recolour on page ${String(page)} named no object. Regenerating a page's content ` +
            'stream is the whole cost of an edit, and this one would change nothing.',
        );
      }
      // RESOLVED IN FULL FIRST, so a refusal leaves the page untouched.
      const objects = fills.map((fill) => objectAt(bindings, handle, page, fill.index));
      for (const [at, fill] of fills.entries()) {
        if (
          numberFrom(
            bindings.setFillColour(objects[at], fill.red, fill.green, fill.blue, fill.alpha),
            'FPDFPageObj_SetFillColor',
          ) !== 1
        ) {
          throw refusedAt('object', `FPDFPageObj_SetFillColor refused object ${String(fill.index)} on page ${String(page)}`);
        }
      }
      generate(session, page, handle);
    });
  });
}

/**
 * Removes objects from a page and regenerates its content **once**.
 *
 * ## ORDER CANNOT MATTER, because indices are resolved to HANDLES first
 *
 * An index is a position in the page's object order and removing one shifts
 * every later object down, so removing 1 then 3 by index would delete whatever
 * slid into 3 — `deletePages`' hazard on a different walk. This sorted
 * descending to avoid it, and **the mutation written to redden that (sorting
 * ascending) left every case green**, which is the signal not to skip past.
 *
 * The reason is that `FPDFPage_RemoveObject` takes the OBJECT, not the index:
 * every index is resolved against the untouched page before anything is
 * unlinked, and a handle does not renumber. So the sort was a second mechanism
 * for something the resolution already prevented, and it is gone — a guard
 * whose stated reason is not the one doing the work is worse than none, because
 * the next reader takes the stated reason as the rule.
 *
 * What the up-front resolution IS load-bearing for is the refusal: a bad index
 * anywhere in the list refuses before the page has been touched.
 *
 * ## Duplicates are removed, and the reason is NOT the one it looks like
 *
 * *The same index twice is a double free* was the obvious reading and it is
 * wrong, which the mutation showed rather than confirmed: deleting the `Set`
 * and removing `[0, 0]` throws **FPDFPage_RemoveObject refused object 0** —
 * PDFium declines to unlink an object that is no longer on the page, so the
 * second `FPDFPageObj_Destroy` is never reached.
 *
 * What the `Set` actually prevents is a **half-applied command**: without it a
 * duplicate makes the first removal land and the second throw, which leaves
 * this page mutated and the call failed. Nothing escapes to the file — the
 * throw happens before {@link generate}, and a page closed without generating
 * carries no change into the saved bytes (measured) — but a caller would meet
 * an error for an input with an obvious meaning.
 *
 * Recorded this way round because a guard whose stated reason is more alarming
 * than its evidence is one nobody re-checks.
 *
 * ## `Destroy` after `Remove`, and both are required
 *
 * `FPDFPage_RemoveObject` unlinks the object and hands ownership back to the
 * caller; `FPDFPageObj_Destroy` frees it. Skipping the second leaks for the
 * life of the process — a process whose memory a job object bounds — and
 * calling the second on an object still on a page frees memory the page will
 * use.
 *
 * ## It cannot be undone from anything a capture can hold
 *
 * A removed object is gone: PDFium offers no way to reconstruct one from a
 * description, so there is no prior state that would restore it. That is why
 * this command's declaration is a **checkpoint** one rather than invertible,
 * and the fact belongs here as well as there because it is a property of the
 * library rather than a choice about the log.
 *
 * @throws on an empty list, `replaceTextObjects`' reason.
 * @throws when an index names no object, before anything is removed.
 */
export function removeObjects(
  session: PdfiumSession,
  page: number,
  indices: readonly number[],
): Promise<void> {
  return promised(() => {
    onPage(session, page, (handle) => {
      const bindings = api();
      if (indices.length === 0) {
        throw new Error(
          `A removal on page ${String(page)} named no object. Regenerating a page's content ` +
            'stream is the whole cost of an edit, and this one would change nothing.',
        );
      }
      // RESOLVED IN FULL FIRST, against the untouched page: a bad index refuses
      // before anything is unlinked, and a resolved handle does not renumber
      // when its neighbours leave. The `Set` is the double-free guard, not a
      // tidiness — see the note above.
      const named = [...new Set(indices)];
      const objects = named.map((index) => objectAt(bindings, handle, page, index));
      for (const [at, index] of named.entries()) {
        if (numberFrom(bindings.removeObject(handle, objects[at]), 'FPDFPage_RemoveObject') !== 1) {
          throw refusedAt('object', `FPDFPage_RemoveObject refused object ${String(index)} on page ${String(page)}`);
        }
        bindings.destroyObject(objects[at]);
      }
      generate(session, page, handle);
    });
  });
}

/**
 * One page rasterised to a bitmap, and the bitmap's shape.
 *
 * `bgra` rather than `rgba`, named for what it is: `FPDFBitmap_Create` with an
 * alpha channel produces BGRA and this hands it back unchanged. The name is the
 * whole documentation a consumer needs, and it happens to be the order
 * Electron's `nativeImage.createFromBitmap` takes — so the shell can encode it
 * with no swap, where a function that answered RGBA would make one side of that
 * pair convert twice.
 */
export interface PageBitmap {
  readonly width: number;
  readonly height: number;
  readonly bgra: Uint8Array;
}

/**
 * Rasterises one page at exactly the pixel size the caller asked for.
 *
 * ## THE SIZE IS THE CALLER'S, and that is ADR-0031's sanctioned crossing
 *
 * A raster may cross to the renderer *under a caller-stated maximum* — what that
 * ADR bans is a snapshot of the document. So the size is a parameter rather than
 * a scale applied to the page's own box: the renderer knows its canvas's device
 * size and nothing else does, and a size derived here from a scale would agree
 * with it on one display.
 *
 * ## White first, because PDFium composites onto what it finds
 *
 * `FPDFBitmap_FillRect` with opaque white before the render. A page with no
 * background drawn onto an unfilled bitmap composites over uninitialised memory,
 * which reads as noise in exactly the places anti-aliasing lives — measured
 * while writing `scripts/research/pdfiumRender.mjs`, which is where the same two
 * lines appear for the same reason.
 *
 * ## The STRIDE is copied row by row, and on THIS format it never differs
 *
 * `FPDFBitmap_GetStride` may exceed `width * 4` for alignment, and a single
 * `decode` of `width * height * 4` would then read the right number of bytes
 * from the wrong places — an image sheared progressively down the page, which
 * looks like a rendering defect and is a copying one.
 *
 * **Measured 2026-09-10 across thirteen widths including primes — 1, 2, 3, 5, 7,
 * 13, 40, 41, 43, 97, 101, 399, 1191 — and the stride is exactly `width * 4`
 * every time.** A four-byte pixel is already four-byte aligned, so BGRA has
 * nothing to pad. The row loop below is therefore correct and **unexercised**,
 * and saying so is the honest version: a case claiming to cover it would be
 * asserting a length a flat copy also produces.
 *
 * It is kept rather than simplified, `replaceTextObjects`' partial-write guard's
 * reason: the rule it encodes is true of the API rather than of this call, and
 * `FPDFBitmap_Create` has formats where it bites — a one-byte `FPDFBitmap_Gray`
 * or a three-byte `BGR` pads to four. A flat copy would be correct today and
 * wrong in the commit that asks for greyscale.
 *
 * @throws when the size is not positive, rather than handing PDFium a zero or
 * negative dimension. `FPDFBitmap_Create` answers null for those and a null
 * bitmap's buffer is a null pointer, which `koffi.decode` would read through.
 */
export function renderPageBitmap(
  session: PdfiumSession,
  page: number,
  width: number,
  height: number,
): Promise<PageBitmap> {
  return promised(() =>
    onPage(session, page, (handle) => {
      const bindings = api();
      if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new Error(
          `A raster of ${String(width)}x${String(height)} is not a size PDFium can allocate. ` +
            'The caller states the size and a non-positive one means the caller has a bug.',
        );
      }
      const bitmap: unknown = bindings.createBitmap(width, height, 1);
      if (bitmap === null) {
        throw new Error(
          `FPDFBitmap_Create refused ${String(width)}x${String(height)} ` +
            `(FPDF_GetLastError ${String(bindings.lastError())}).`,
        );
      }
      try {
        bindings.fillRect(bitmap, 0, 0, width, height, 0xffffffff);
        // FLAGS 0. `FPDF_LCD_TEXT` would produce sub-pixel-positioned text whose
        // correctness depends on the physical pixel layout of the display it
        // lands on, and this bitmap is encoded and sent somewhere else.
        bindings.renderPage(bitmap, handle, 0, 0, width, height, 0, 0);
        const stride = numberFrom(bindings.bitmapStride(bitmap), 'FPDFBitmap_GetStride');
        const pointer: unknown = bindings.bitmapBuffer(bitmap);
        if (pointer === null) throw new Error('FPDFBitmap_GetBuffer answered nothing.');
        const source = koffi.decode(pointer, 'uint8_t', stride * height) as Uint8Array;
        const bgra = new Uint8Array(width * height * 4);
        for (let row = 0; row < height; row += 1) {
          bgra.set(source.subarray(row * stride, row * stride + width * 4), row * width * 4);
        }
        return { width, height, bgra };
      } finally {
        bindings.destroyBitmap(bitmap);
      }
    }),
  );
}

/**
 * Regenerates a page's content stream, or throws saying what that costs.
 *
 * **Every object edit needs it, and that is measured rather than assumed.**
 * `scripts/research/pdfiumObjects.mjs` deletes an object with the generate and
 * without it: with, the reopened bytes carry two objects; without, three. So a
 * mutation that skipped this would be present in memory, absent from the file,
 * and visible to nothing until the document was reopened.
 *
 * ## And it RECORDS the page as edited, which `serialise` reads the saved bytes back against
 *
 * [ADR-0169](../../../docs/DECISIONS/0169-a-pdfium-rewrite-is-saved-only-when-it-reads-back-as-edited.md)
 * Decision 1. Generation writes a Type 3 text object with no `Tf`, no text and no `ET`
 * (`CPDF_PageContentGenerator::ProcessText` names a font only for Type 1, TrueType and CID fonts), so a page that
 * carries one loses its text here and nothing in memory shows it: measured 2026-10-05 on PDFium 155.0.8044.0's Linux
 * build, a Chromium print went from 60 text objects to 1 and every command answered success. The record is taken here
 * because this is the one call every edit makes, so no command can reach the saved bytes unchecked and none has to say
 * what it touched. `writes` names the objects the edit wrote: a difference there is the font's, anywhere else a loss.
 */
function generate(session: PdfiumSession, page: number, handle: unknown, writes: readonly unknown[] = []): void {
  const bindings = api();
  const { objects, texts } = heldTextsOn(bindings, handle);
  const written = new Set(writes.map((object) => String(koffi.address(object))));
  const writesAt = new Set(objects.flatMap((object, at) => (written.has(String(koffi.address(object))) ? [at] : [])));
  if (numberFrom(bindings.generateContent(handle), 'FPDFPage_GenerateContent') !== 1) {
    throw refusedAt(
      'generate',
      'FPDFPage_GenerateContent failed, so the edit would be present in memory and absent from the saved bytes',
    );
  }
  let pages = editedPages.get(session);
  if (pages === undefined) {
    pages = new Map();
    editedPages.set(session, pages);
  }
  pages.set(page, { texts, writes: writesAt });
}

/** One text object as a page holds it: what it says, and the base name of the font it is set in. */
interface HeldText {
  readonly text: string;
  readonly font: string;
}

/** A regenerated page as it was edited: {@link generate}'s record, which {@link readBack} holds the saved bytes to. */
interface EditedPage {
  /** Its text objects in page order, a Form XObject's own in its place. */
  readonly texts: readonly HeldText[];
  /** The positions in `texts` the edit wrote. */
  readonly writes: ReadonlySet<number>;
}

/** Each session's regenerated pages, by page index; a session is one command's, so this lives as long as it does. */
const editedPages = new WeakMap<PdfiumSession, Map<number, EditedPage>>();

/**
 * A page's text objects in page order, each Form XObject's in its place, depth first.
 *
 * WITH AN EXPLICIT STACK rather than recursion: a form can hold a form, and a document is hostile by invariant 25's
 * premise, so its nesting depth is not this process's stack depth to spend.
 */
function textObjectsIn(bindings: Bound, handle: unknown): unknown[] {
  const found: unknown[] = [];
  const count = numberFrom(bindings.countObjects(handle), 'FPDFPage_CountObjects');
  const pending: unknown[] = [];
  for (let at = count - 1; at >= 0; at -= 1) pending.push(bindings.getObject(handle, at));
  while (pending.length > 0) {
    const object = pending.pop();
    if (object === null || object === undefined) continue;
    const kind = numberFrom(bindings.objectType(object), 'FPDFPageObj_GetType');
    if (kind === TEXT_OBJECT) {
      found.push(object);
    } else if (kind === OBJECT_FORM) {
      const children = numberFrom(bindings.countFormObjects(object), 'FPDFFormObj_CountObjects');
      for (let at = children - 1; at >= 0; at -= 1) pending.push(bindings.formObject(object, at));
    }
  }
  return found;
}

/** What each of a page's text objects says and is set in, read through one text page. */
function heldTextsOn(bindings: Bound, handle: unknown): { readonly objects: unknown[]; readonly texts: HeldText[] } {
  const objects = textObjectsIn(bindings, handle);
  const textPage: unknown = bindings.loadTextPage(handle);
  if (textPage === null) throw refusedAt('page', 'PDFium could not load the page to record its text');
  try {
    const texts = objects.map((object) => {
      const font: unknown = bindings.textFont(object);
      return { text: objectTextOn(bindings, object, textPage), font: font === null ? '' : baseNameOf(bindings, font) };
    });
    return { objects, texts };
  } finally {
    bindings.closeTextPage(textPage);
  }
}

/**
 * Reopens `bytes` and requires every page in `edited` to read back as it was edited, or throws — ADR-0169 Decision 2.
 *
 * - **A text object the edit did not write that is missing or reads differently** is lost text: refused at step
 *   `read-back`. The count is compared first, so a page that lost objects is that refusal whichever ones went.
 * - **Otherwise, a write that reads differently** is the font it was saved in failing to carry it — measured
 *   2026-09-24, a Helvetica twin saved into a StandardEncoding Helvetica-family font reads `é` back as `Ø` — so it is
 *   `TextNotWritableError`, naming the characters.
 *
 * Opened WITH THE PASSWORD THE SESSION OPENED WITH: the save keeps the document's security handler (flags 0, measured
 * on PDFium 155 2026-10-05), so the bytes of a document opened with its password open only with it (ADR-0171's
 * addendum).
 */
function readBack(bytes: Buffer, edited: ReadonlyMap<number, EditedPage>, password: string | undefined): void {
  const bindings = api();
  // `bytes` IS HELD by this frame for as long as the document is open — `FPDF_LoadMemDocument64` does not copy (`Live`).
  const document: unknown = bindings.loadDocument(bytes, bytes.length, password ?? null);
  if (document === null) throw refusedAt('read-back', 'PDFium could not reopen the bytes it had just saved');
  try {
    const misread: { written: string; read: string }[] = [];
    for (const [page, recorded] of edited) {
      const handle: unknown = bindings.loadPage(document, page);
      if (handle === null) throw refusedAt('read-back', `PDFium could not load page ${String(page)} of the bytes it saved`);
      let saved: readonly HeldText[];
      try {
        saved = heldTextsOn(bindings, handle).texts;
      } finally {
        bindings.closePage(handle);
      }
      if (saved.length !== recorded.texts.length) {
        throw refusedAt(
          'read-back',
          `page ${String(page)} was edited with ${String(recorded.texts.length)} text objects and saved with ` +
            String(saved.length),
        );
      }
      // AS A MULTISET, NOT BY POSITION: generation does not keep page order. Measured 2026-10-05 on PDFium
      // 155.0.8044.0's Linux build, a line promoted out of a Form XObject is LAST in the session and FIRST in the saved
      // page, with every object present and unchanged — so a positional comparison refused a faithful save.
      const unmatched = new Map<string, number>();
      for (const back of saved) {
        const key = `${back.font}\u0000${back.text}`;
        unmatched.set(key, (unmatched.get(key) ?? 0) + 1);
      }
      const take = (key: string): boolean => {
        const left = unmatched.get(key) ?? 0;
        if (left === 0) return false;
        unmatched.set(key, left - 1);
        return true;
      };
      for (const [at, held] of recorded.texts.entries()) {
        if (recorded.writes.has(at) || take(`${held.font}\u0000${held.text}`)) continue;
        throw refusedAt(
          'read-back',
          `a text object on page ${String(page)} the edit did not write was saved reading differently, in another font, ` +
            'or not at all',
        );
      }
      // WHAT IS LEFT is the writes, read back: each one written is matched by text — its font may be a twin's — and
      // what matches nothing is a write the saved font does not carry.
      const readBackWrites = [...unmatched].flatMap(([key, count]) =>
        Array.from({ length: count }, () => key.slice(key.indexOf('\u0000') + 1)),
      );
      const unmatchedWrites: string[] = [];
      for (const at of recorded.writes) {
        const wrote = recorded.texts[at]?.text ?? '';
        const found = readBackWrites.indexOf(wrote);
        if (found === -1) unmatchedWrites.push(wrote);
        else readBackWrites.splice(found, 1);
      }
      // THE CHARACTERS are named against every write that read back as something else, joined, since which saved
      // object a misread write became is the one thing a multiset cannot say; the characters absent from all of them
      // are the ones no write carried. Joined by spaces, which a refusal never names.
      if (unmatchedWrites.length > 0) {
        misread.push({ written: unmatchedWrites.join(' '), read: readBackWrites.join(' ') });
      }
    }
    if (misread.length > 0) throw new TextNotWritableError(unwritableCharacters(misread));
  } finally {
    bindings.closeDocument(document);
  }
}

/** `FPDF_SaveAsCopy`'s bytes, collected through the callback it insists on. */
function saveAsCopy(document: unknown): Buffer {
  const bindings = api();
  const blocks: Buffer[] = [];
  const callback = koffi.register(
    (_self: unknown, data: unknown, size: number): number => {
      // `decode` COPIES out of PDFium's block into a JavaScript array, and
      // `Buffer.from` copies again — the block is valid only for the duration of
      // this callback, so a view kept past the return would be reading freed
      // memory.
      const bytes: unknown = koffi.decode(data, 'uint8_t', size);
      blocks.push(Buffer.from(bytes as Uint8Array));
      return 1;
    },
    koffi.pointer(bindings.writeBlock),
  );
  try {
    // Version 1 is the only version the public header defines, and PDFium
    // refuses a struct whose version it does not know rather than guessing.
    const ok = numberFrom(
      bindings.saveAsCopy(document, { version: 1, WriteBlock: callback }, 0),
      'FPDF_SaveAsCopy',
    );
    if (ok !== 1) throw refusedAt('save', `FPDF_SaveAsCopy answered ${String(ok)}`);
    return Buffer.concat(blocks);
  } finally {
    koffi.unregister(callback);
  }
}

/**
 * Runs `work` against a session opened from `image` with the key it carries, closing it however it ends. THE ONE
 * OPENER every PDFium spec and read takes (ADR-0171's addendum), where each module had a copy of these lines: a copy
 * that opened without the key would read as the same four lines and refuse every document opened with its password.
 */
export async function onImage<T>(image: ImageSession, work: (session: PdfiumSession) => Promise<T>): Promise<T> {
  const session = await pdfiumWriter.open(image.bytes, image.opensWith?.reveal());
  try {
    return await work(session);
  } finally {
    await pdfiumWriter.close(session);
  }
}

/**
 * The second adapter behind the engine seam.
 *
 * `engineSeam.ts` declared `PdfiumSession` with nothing behind it and said so;
 * this is what goes behind it. A PDFium edit mutates a loaded document and the
 * bytes come back from `serialise`, exactly as MuPDF's do — but the writer of
 * record's shape is **`byte-image`** ([ADR-0047](../../../docs/DECISIONS/0047-an-in-place-text-edit-is-a-byte-image-command.md)),
 * so this session is minted for one command and never survives it.
 * `PdfiumSession` is the handle held *inside* a command; `WriterSession['pdfium']`
 * is an `ImageSession`, the bytes and the key that opens them, and they are different types on purpose.
 *
 * **This said *"the shape is `live-session`, as `writerShapes` already records"*
 * until 2026-09-09** and cited the table that by then contradicted it — a
 * compound claim whose second clause, the mechanism, stayed true and vouched
 * for the dead one beside it (finding CCCCCC-2). Nothing in `63f10be` opened
 * this file.
 */
export const pdfiumWriter: EngineWriter<PdfiumSession> = {
  /**
   * Parses `image` into a session.
   *
   * The bytes are **copied into a `Buffer` this session owns** rather than
   * passed through. Two reasons and both are load-bearing: `FPDF_LoadMemDocument64`
   * keeps reading the caller's memory for the document's whole life (see
   * {@link Live}), and a `ByteImage` is the kernel's canonical image, which
   * nothing below the seam may hold a live pointer into.
   *
   * **The password is the one the document was opened with in `main`, or none**
   * (ADR-0171's addendum). `null` without one, so PDFium refuses an encrypted
   * document loudly rather than this adapter inventing an empty-string policy
   * nobody wrote down; the session keeps it for the read-back's reopen.
   */
  open(image: ByteImage, password?: string): Promise<PdfiumSession> {
    return promised(() => {
      const bindings = api();
      const bytes = Buffer.from(image);
      const document: unknown = bindings.loadDocument(bytes, bytes.length, password ?? null);
      // `open` WITH PDFium's own number, so a document protected by a password is named as one (`FPDF_ERR_PASSWORD`,
      // 4) rather than as a document PDFium could not read.
      if (document === null) throw refusedAt('open', 'PDFium refused the document');
      // The one place a PdfiumSession is minted. Keeping this cast unexported is
      // what makes the brand mean "this adapter produced it".
      const session = { engine: 'pdfium' } as PdfiumSession;
      documents.set(session, { document, bytes, password });
      return session;
    });
  },

  /**
   * The canonical bytes for the session's current state.
   *
   * **Flags are 0 — a full rewrite, not an incremental update**, and that is a
   * measurement rather than a default. `scripts/research/pdfiumTextEdit.mjs`
   * asks the question a full rewrite raises — `docs/ENGINE-SPIKE.md`:157 records
   * that a full rewrite is where non-embedded font references go — by opening a
   * document, saving it with **no edit at all**, and diffing the renders. Read
   * 2026-09-09 against the supplied corpus: **0 differing pixels of 1,809,600 on
   * every document**, with an ink column beside each proving the renders were
   * not blank. The synthetic three-run page answers the same.
   *
   * No `SavePurpose` branch, unlike MuPDF's. PDFium has no garbage-collection
   * option on `FPDF_SaveAsCopy`, so there is nothing here for a purpose to
   * select, and a parameter that changed nothing would read as a policy.
   */
  serialise(session: PdfiumSession): Promise<ByteImage> {
    return promised(() => {
      const bytes = saveAsCopy(documentFor(session));
      // NOTHING LEAVES UNREAD (ADR-0169): every page this session regenerated is read back from these bytes, and a
      // page that lost text refuses before any caller holds them. A session that regenerated nothing pays nothing.
      const edited = editedPages.get(session);
      if (edited !== undefined && edited.size > 0) readBack(bytes, edited, documents.get(session)?.password);
      return new Uint8Array(bytes);
    });
  },

  /** Releases the native document and drops the bytes it was reading. */
  close(session: PdfiumSession): Promise<void> {
    return promised(() => {
      const document = documentFor(session);
      // Removed BEFORE closing, so a second close is a named error rather than a
      // second FPDF_CloseDocument on freed memory. Dropping the entry is also
      // what releases the retained bytes.
      documents.delete(session);
      api().closeDocument(document);
    });
  },
};
