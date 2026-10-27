import koffi, { type KoffiFunc, type TypeObject } from 'koffi';

import { loadEngineLibrary } from './engineLibrary.js';

/**
 * PDFium's binding: the library bound once per process and its functions, apart from everything that uses them.
 *
 * **Apart so a host can bind before it loads the rest**
 * ([ADR-0251](../../../docs/DECISIONS/0251-a-host-reaches-its-pipe-before-it-loads-its-handlers.md)). The PDFium host
 * binds its library before it connects, so a library Windows will not load is *could not start*; and it connects before
 * it loads its handlers. While the binding lived in `pdfiumFfi.ts`, binding it loaded that module's whole graph — 167
 * files of the host's 184, measured 2026-10-17 — so the host's connect waited on it. This module imports koffi and the
 * library loader only. `pdfiumFfi.ts` takes {@link api} from here and is the binding's one user.
 */

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
export type Native = (...args: unknown[]) => unknown;

/** Everything bound at the boundary. */
export interface Bound {
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
  readonly charOrigin: Native;
  readonly objectBounds: Native;
  readonly getMatrix: Native;
  readonly setMatrix: Native;
  readonly getFillColour: Native;
  readonly setFillColour: Native;
  readonly getRenderMode: Native;
  readonly setRenderMode: Native;
  readonly countMarks: Native;
  readonly getMark: Native;
  readonly markName: Native;
  readonly markParamCount: Native;
  readonly markParamKey: Native;
  readonly markParamType: Native;
  readonly markParamInt: Native;
  readonly markParamString: Native;
  /** A string parameter's own bytes, which {@link markParamString} decodes as UTF-8 and so loses where they are UTF-16. */
  readonly markParamBlob: Native;
  readonly markSetBlob: Native;
  readonly addMark: Native;
  readonly markSetInt: Native;
  readonly markParamFloat: Native;
  readonly markSetFloat: Native;
  readonly markSetString: Native;
  readonly getStrokeColour: Native;
  readonly setStrokeColour: Native;
  readonly getStrokeWidth: Native;
  readonly setStrokeWidth: Native;
  readonly newRect: Native;
  readonly setDrawMode: Native;
  readonly setPositions: Native;
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
  readonly segmentPoint: Native;
  readonly loadStandardFont: Native;
  readonly loadFont: Native;
  readonly pageBox: Native;
  readonly pageWidth: Native;
  readonly pageHeight: Native;
  readonly pageToDevice: Native;
  readonly closeFont: Native;
  readonly createBitmap: Native;
  readonly fillRect: Native;
  readonly renderPage: Native;
  readonly bitmapBuffer: Native;
  readonly bitmapStride: Native;
  readonly destroyBitmap: Native;
  // THE PAGE-CONTENT READ (ADR-0210): a page's pictures, paths and the clips that narrow them.
  readonly pageRotation: Native;
  readonly textRenderMode: Native;
  readonly rotatedBounds: Native;
  readonly imagePixelSize: Native;
  readonly imageFilterCount: Native;
  readonly imageFilter: Native;
  readonly imageDataRaw: Native;
  readonly imageMetadata: Native;
  readonly imageBitmap: Native;
  readonly imageRenderedBitmap: Native;
  readonly bitmapWidth: Native;
  readonly bitmapHeight: Native;
  readonly bitmapFormat: Native;
  readonly clipPath: Native;
  readonly clipPathCount: Native;
  readonly clipSegmentCount: Native;
  readonly clipSegment: Native;
  readonly pathSegmentCount: Native;
  readonly pathSegment: Native;
  readonly segmentType: Native;
  readonly segmentClose: Native;
  readonly pathDrawMode: Native;
  readonly strokeColour: Native;
  readonly strokeWidth: Native;
  readonly lineCap: Native;
  readonly lineJoin: Native;
  readonly dashCount: Native;
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
 * checked against a C declaration — and `pdfiumFfi.ts`' `numberFrom` is where each
 * answer is narrowed at the point it crosses.
 */
function native(bound: KoffiFunc<Native>): Native {
  return bound;
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

  const library = loadEngineLibrary(libraryPath);

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
  koffi.struct('FS_QUADPOINTSF', {
    x1: 'float',
    y1: 'float',
    x2: 'float',
    y2: 'float',
    x3: 'float',
    y3: 'float',
    x4: 'float',
    y4: 'float',
  });
  // An image's colour space and depth, which decide whether its own bytes can stand as a JPEG (ADR-0210).
  koffi.struct('FPDF_IMAGEOBJ_METADATA', {
    width: 'unsigned int',
    height: 'unsigned int',
    horizontal_dpi: 'float',
    vertical_dpi: 'float',
    bits_per_pixel: 'unsigned int',
    colorspace: 'int',
    marked_content_id: 'int',
  });

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
    // ONE CHARACTER'S ORIGIN, where the pen drew it from, in page space: what character and word spacing move.
    charOrigin: native(library.func('int FPDFText_GetCharOrigin(void *textPage, int index, _Out_ double *x, _Out_ double *y)')),
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
    // THE MARKED CONTENT an object stands in (`BDC … EMC`): its marks, each a name and parameters, an `MCID` among them.
    // A tagged page's structure tree names its text by that number, so a new object that takes an old one's place must
    // carry the marks, or the structure points at nothing (ADR-0181 Decision 8). Names and keys come back as UTF-16LE
    // with their terminator, their lengths in BYTES; a name or key going in is a byte string.
    countMarks: native(library.func('int FPDFPageObj_CountMarks(void *object)')),
    getMark: native(library.func('void *FPDFPageObj_GetMark(void *object, unsigned long index)')),
    markName: native(
      library.func(
        'int FPDFPageObjMark_GetName(void *mark, _Out_ uint8_t *buffer, unsigned long length, _Out_ unsigned long *needed)',
      ),
    ),
    markParamCount: native(library.func('int FPDFPageObjMark_CountParams(void *mark)')),
    markParamKey: native(
      library.func(
        'int FPDFPageObjMark_GetParamKey(void *mark, unsigned long index, _Out_ uint8_t *buffer, unsigned long length, _Out_ unsigned long *needed)',
      ),
    ),
    markParamType: native(library.func('int FPDFPageObjMark_GetParamValueType(void *mark, const char *key)')),
    markParamInt: native(
      library.func('int FPDFPageObjMark_GetParamIntValue(void *mark, const char *key, _Out_ int *value)'),
    ),
    markParamString: native(
      library.func(
        'int FPDFPageObjMark_GetParamStringValue(void *mark, const char *key, _Out_ uint8_t *buffer, unsigned long length, _Out_ unsigned long *needed)',
      ),
    ),
    markParamBlob: native(
      library.func(
        'int FPDFPageObjMark_GetParamBlobValue(void *mark, const char *key, _Out_ uint8_t *buffer, unsigned long length, _Out_ unsigned long *needed)',
      ),
    ),
    markSetBlob: native(
      library.func(
        'int FPDFPageObjMark_SetBlobParam(void *document, void *object, void *mark, const char *key, const uint8_t *value, unsigned long length)',
      ),
    ),
    addMark: native(library.func('void *FPDFPageObj_AddMark(void *object, const char *name)')),
    markSetInt: native(
      library.func(
        'int FPDFPageObjMark_SetIntParam(void *document, void *object, void *mark, const char *key, int value)',
      ),
    ),
    markParamFloat: native(
      library.func('int FPDFPageObjMark_GetParamFloatValue(void *mark, const char *key, _Out_ float *value)'),
    ),
    markSetFloat: native(
      library.func(
        'int FPDFPageObjMark_SetFloatParam(void *document, void *object, void *mark, const char *key, float value)',
      ),
    ),
    markSetString: native(
      library.func(
        'int FPDFPageObjMark_SetStringParam(void *document, void *object, void *mark, const char *key, const char *value)',
      ),
    ),
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
    // EACH CHARACTER'S PLACE AFTER THE FIRST, in the object's own units before its matrix: the one way PDFium's edit API
    // states a glyph's position, written as `TJ` adjustments (ADR-0228, `scripts/research/pdfiumPositions.mjs`). Character
    // spacing and a justified line's spaces are both this.
    setPositions: native(library.func('int FPDFText_SetPositions(void *object, const float *positions, size_t count)')),
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
    // A CHARACTER'S ADVANCE IN A FONT at a size (`fontAdvance`). It takes a CODE POINT where its header says "glyph",
    // measured 2026-10-06: the width is in thousandths at a size of 1000.
    glyphWidth: native(
      library.func('int FPDFFont_GetGlyphWidth(void *font, uint32_t glyph, float size, _Out_ float *width)'),
    ),
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
    // THE PAGE AS SHOWN, rotation included, and where a point of it falls on a raster of that shape: what a scan's paper is
    // read from (ADR-0181 Decision 9).
    pageWidth: native(library.func('float FPDF_GetPageWidthF(void *page)')),
    pageHeight: native(library.func('float FPDF_GetPageHeightF(void *page)')),
    pageToDevice: native(
      library.func(
        'int FPDF_PageToDevice(void *page, int startX, int startY, int sizeX, int sizeY, int rotate, double pageX, double pageY, _Out_ int *deviceX, _Out_ int *deviceY)',
      ),
    ),
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
    // THE PAGE-CONTENT READ'S CALLS (ADR-0210). Each answers a number or a handle owned by the object it came from, so
    // nothing here is freed except the two bitmaps the read itself asks for.
    pageRotation: native(library.func('int FPDFPage_GetRotation(void *page)')),
    // 3 IS INVISIBLE: the layer recognition writes over a scan, which is how a scanned page is told from a typed one.
    textRenderMode: native(library.func('int FPDFTextObj_GetTextRenderMode(void *text_object)')),
    // THE FOUR CORNERS of an object's bounds turned with it: how a turned run's own width and height are known, which
    // its axis-aligned bounds cannot say (ADR-0210).
    rotatedBounds: native(library.func('int FPDFPageObj_GetRotatedBounds(void *page_object, _Out_ FS_QUADPOINTSF *quad_points)')),
    imagePixelSize: native(
      library.func('int FPDFImageObj_GetImagePixelSize(void *image_object, _Out_ unsigned int *width, _Out_ unsigned int *height)'),
    ),
    imageFilterCount: native(library.func('int FPDFImageObj_GetImageFilterCount(void *image_object)')),
    imageFilter: native(
      library.func('unsigned long FPDFImageObj_GetImageFilter(void *image_object, int index, _Out_ uint8_t *buffer, unsigned long buflen)'),
    ),
    imageDataRaw: native(
      library.func('unsigned long FPDFImageObj_GetImageDataRaw(void *image_object, _Out_ uint8_t *buffer, unsigned long buflen)'),
    ),
    imageMetadata: native(
      library.func('int FPDFImageObj_GetImageMetadata(void *image_object, void *page, _Out_ FPDF_IMAGEOBJ_METADATA *metadata)'),
    ),
    // THE DECODED PIXELS, with no mask; and the RENDERED bitmap, which applies the mask and is what shows whether one exists.
    imageBitmap: native(library.func('void *FPDFImageObj_GetBitmap(void *image_object)')),
    imageRenderedBitmap: native(library.func('void *FPDFImageObj_GetRenderedBitmap(void *document, void *page, void *image_object)')),
    bitmapWidth: native(library.func('int FPDFBitmap_GetWidth(void *bitmap)')),
    bitmapHeight: native(library.func('int FPDFBitmap_GetHeight(void *bitmap)')),
    bitmapFormat: native(library.func('int FPDFBitmap_GetFormat(void *bitmap)')),
    clipPath: native(library.func('void *FPDFPageObj_GetClipPath(void *page_object)')),
    clipPathCount: native(library.func('int FPDFClipPath_CountPaths(void *clip_path)')),
    clipSegmentCount: native(library.func('int FPDFClipPath_CountPathSegments(void *clip_path, int path_index)')),
    clipSegment: native(library.func('void *FPDFClipPath_GetPathSegment(void *clip_path, int path_index, int segment_index)')),
    pathSegmentCount: native(library.func('int FPDFPath_CountSegments(void *path)')),
    pathSegment: native(library.func('void *FPDFPath_GetPathSegment(void *path, int index)')),
    segmentType: native(library.func('int FPDFPathSegment_GetType(void *segment)')),
    segmentClose: native(library.func('int FPDFPathSegment_GetClose(void *segment)')),
    pathDrawMode: native(library.func('int FPDFPath_GetDrawMode(void *path, _Out_ int *fillmode, _Out_ int *stroke)')),
    strokeColour: native(
      library.func(
        'int FPDFPageObj_GetStrokeColor(void *page_object, _Out_ unsigned int *r, _Out_ unsigned int *g, _Out_ unsigned int *b, _Out_ unsigned int *a)',
      ),
    ),
    strokeWidth: native(library.func('int FPDFPageObj_GetStrokeWidth(void *page_object, _Out_ float *width)')),
    lineCap: native(library.func('int FPDFPageObj_GetLineCap(void *page_object)')),
    lineJoin: native(library.func('int FPDFPageObj_GetLineJoin(void *page_object)')),
    dashCount: native(library.func('int FPDFPageObj_GetDashCount(void *page_object)')),
  };
  api.initialise();
  bound = api;
}

/** The bound library, or a named error rather than a `TypeError` on `undefined`. */
export function api(): Bound {
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
