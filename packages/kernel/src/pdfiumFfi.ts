import koffi, { type KoffiFunc, type TypeObject } from 'koffi';

import type { ByteImage, EngineWriter, PdfiumSession } from './engineSeam.js';

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
  readonly textObjectText: Native;
  readonly charObject: Native;
  readonly charGenerated: Native;
  readonly charBox: Native;
  readonly objectBounds: Native;
  readonly getMatrix: Native;
  readonly setMatrix: Native;
  readonly transform: Native;
  readonly getFillColour: Native;
  readonly setFillColour: Native;
  readonly removeObject: Native;
  readonly destroyObject: Native;
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

  const api: Bound = {
    writeBlock,
    initialise: native(library.func('void FPDF_InitLibrary()')),
    lastError: native(library.func('unsigned long FPDF_GetLastError()')),
    loadDocument: native(
      library.func('void *FPDF_LoadMemDocument(const void *data, int size, const char *password)'),
    ),
    closeDocument: native(library.func('void FPDF_CloseDocument(void *document)')),
    pageCount: native(library.func('int FPDF_GetPageCount(void *document)')),
    loadPage: native(library.func('void *FPDF_LoadPage(void *document, int index)')),
    closePage: native(library.func('void FPDF_ClosePage(void *page)')),
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
    // REMOVE UNLINKS AND HANDS OWNERSHIP BACK; `FPDFPageObj_Destroy` is what
    // frees it. Calling the first without the second leaks the object for the
    // life of the process, and calling the second on an object still on a page
    // frees memory the page will use.
    removeObject: native(library.func('int FPDFPage_RemoveObject(void *page, void *object)')),
    destroyObject: native(library.func('void FPDFPageObj_Destroy(void *object)')),
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
 * ## `FPDF_LoadMemDocument` DOES NOT COPY, and that is the hazard
 *
 * PDFium parses lazily: the buffer handed to `FPDF_LoadMemDocument` must stay
 * valid and unmoved for the whole life of the document, and the API says so.
 * Node's garbage collector is free to collect a `Buffer` nothing references, and
 * koffi does not retain one on the caller's behalf — so a session that kept only
 * the pointer would work in every short test and fail when a collection landed
 * between two commands, which is the shape that reads as flakiness.
 *
 * So the bytes are held **beside** the document for exactly as long as it lives,
 * and dropped in `close`. This is the same reason `mupdfWriter.ts` copies out of
 * the WASM heap rather than keeping a view into it: an engine's memory and
 * JavaScript's lifetime rules are two owners of one buffer.
 */
interface Live {
  readonly document: unknown;
  /** Retained for the document's lifetime. See above — this is not spare state. */
  readonly bytes: Buffer;
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
  if (handle === null) {
    throw new Error(
      `PDFium could not load page ${String(page)} (FPDF_GetLastError ${String(bindings.lastError())}).`,
    );
  }
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
  return promised(() =>
    onPage(session, page, (handle) => {
      const bindings = api();
      const total = numberFrom(bindings.countObjects(handle), 'FPDFPage_CountObjects');
      const found: number[] = [];
      for (let index = 0; index < total; index += 1) {
        const object: unknown = bindings.getObject(handle, index);
        if (
          object !== null &&
          numberFrom(bindings.objectType(object), 'FPDFPageObj_GetType') === TEXT_OBJECT
        ) {
          found.push(index);
        }
      }
      return found;
    }),
  );
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
      if (textPage === null) throw new Error('PDFium could not load the page for text reading.');
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
        return String.fromCharCode(...buffer.subarray(0, Math.max(0, written - 1)));
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
      if (textPage === null) throw new Error('PDFium could not load the page for text reading.');
      try {
        const bytes = numberFrom(
          bindings.textObjectText(object, textPage, null, 0),
          'FPDFTextObj_GetText',
        );
        // TWO BYTES IS THE TERMINATOR ALONE, which is what an object carrying
        // no text answers. Returning '' for it is right; allocating a
        // zero-length buffer and calling again is not, and PDFium's own
        // refusal for that case is not documented.
        if (bytes <= 2) return '';
        const buffer = new Uint16Array(bytes / 2);
        const written = numberFrom(
          bindings.textObjectText(object, textPage, buffer, bytes),
          'FPDFTextObj_GetText',
        );
        // `written` is bytes and includes the terminator, so the character
        // count is one short of half of it.
        return String.fromCharCode(...buffer.subarray(0, Math.max(0, written / 2 - 1)));
      } finally {
        bindings.closeTextPage(textPage);
      }
    }),
  );
}

/**
 * One text object as the editor sees it: which object, what it says, and where
 * it sits vertically.
 *
 * The vertical extent and nothing else, because
 * [ADR-0049](../../../docs/DECISIONS/0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md)
 * groups by **overlap** and a horizontal position decides nothing there. A
 * fuller rectangle would be geometry travelling further than the one question
 * it answers, and the next reader would take it as available for a second.
 */
export interface TextRun {
  /** The object's index in the page's object order. `textObjectIndices`' unit. */
  readonly index: number;
  /** What it currently says. */
  readonly text: string;
  /** The bottom of its characters, in PDF user space. */
  readonly bottom: number;
  /** The top of its characters, in PDF user space. */
  readonly top: number;
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
 * A character PDFium **generated** — a space it believes is implied by spacing
 * rather than drawn — belongs to no object and is skipped. Without
 * `FPDFText_IsGenerated`, *this character belongs to nothing* and *the lookup
 * is broken* would be the same observation, which is audit item 4b's shape
 * inside a mapping.
 *
 * ## One text page for the whole walk
 *
 * `textObjectText` loads a text page per object, which is right for one object
 * and quadratic for a page of them. This walks the characters once.
 */
export function textRuns(session: PdfiumSession, page: number): Promise<readonly TextRun[]> {
  return promised(() =>
    onPage(session, page, (handle) => {
      const bindings = api();
      const textPage: unknown = bindings.loadTextPage(handle);
      if (textPage === null) throw new Error('PDFium could not load the page for text reading.');
      try {
        const objects = numberFrom(bindings.countObjects(handle), 'FPDFPage_CountObjects');
        /** Address -> index, from this page's own objects. */
        const indexOf = new Map<string, number>();
        for (let at = 0; at < objects; at += 1) {
          indexOf.set(String(koffi.address(bindings.getObject(handle, at))), at);
        }

        const chars = numberFrom(bindings.countChars(textPage), 'FPDFText_CountChars');
        /** index -> the run being accumulated. Insertion order is reading order. */
        const runs = new Map<number, { text: string; bottom: number; top: number }>();

        for (let at = 0; at < chars; at += 1) {
          if (numberFrom(bindings.charGenerated(textPage, at), 'FPDFText_IsGenerated') === 1) {
            continue;
          }
          const index = indexOf.get(String(koffi.address(bindings.charObject(textPage, at))));
          if (index === undefined) continue;

          const buffer = new Uint16Array(2);
          numberFrom(bindings.getText(textPage, at, 1, buffer), 'FPDFText_GetText');

          const left = [0];
          const right = [0];
          const bottom = [0];
          const top = [0];
          numberFrom(
            bindings.charBox(textPage, at, left, right, bottom, top),
            'FPDFText_GetCharBox',
          );
          const [low = 0] = bottom;
          const [high = 0] = top;

          const held = runs.get(index);
          if (held === undefined) {
            runs.set(index, {
              text: String.fromCharCode(buffer[0] ?? 0),
              bottom: low,
              top: high,
            });
          } else {
            held.text += String.fromCharCode(buffer[0] ?? 0);
            // THE UNION, so a run's extent covers every character in it. A run
            // sized from its first character alone would lose an ascender and
            // stop overlapping the neighbour it shares a line with.
            held.bottom = Math.min(held.bottom, low);
            held.top = Math.max(held.top, high);
          }
        }

        return [...runs.entries()].map(([index, run]) => ({ index, ...run }));
      } finally {
        bindings.closeTextPage(textPage);
      }
    }),
  );
}

/** One text object's new text, named by its index in the page's object order. */
export interface TextReplacement {
  /** The object's index, as {@link textObjectIndices} reports it. */
  readonly index: number;
  /** What it should say. */
  readonly text: string;
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
    throw new Error(
      `Page ${String(page)} has ${String(total)} objects, so index ${String(index)} names none.`,
    );
  }
  const object: unknown = bindings.getObject(handle, index);
  if (
    object === null ||
    numberFrom(bindings.objectType(object), 'FPDFPageObj_GetType') !== TEXT_OBJECT
  ) {
    throw new Error(
      `Object ${String(index)} on page ${String(page)} is not a text object, and FPDFText_SetText is defined only for one.`,
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
 */
export function replaceTextObjects(
  session: PdfiumSession,
  page: number,
  replacements: readonly TextReplacement[],
): Promise<void> {
  return promised(() => {
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
      const objects = replacements.map((replacement) =>
        textObjectAt(bindings, handle, page, replacement.index),
      );
      for (const [at, replacement] of replacements.entries()) {
        if (
          numberFrom(bindings.setText(objects[at], wideString(replacement.text)), 'FPDFText_SetText') !==
          1
        ) {
          throw new Error(
            `FPDFText_SetText refused the replacement for object ${String(replacement.index)} ` +
              `(FPDF_GetLastError ${String(bindings.lastError())}).`,
          );
        }
      }
      if (numberFrom(bindings.generateContent(handle), 'FPDFPage_GenerateContent') !== 1) {
        throw new Error(
          'FPDFPage_GenerateContent failed, so the edit would be present in memory and absent from the saved bytes.',
        );
      }
    });
  });
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
    throw new Error(
      `Page ${String(page)} has ${String(total)} objects, so index ${String(index)} names none.`,
    );
  }
  const object: unknown = bindings.getObject(handle, index);
  if (object === null) {
    throw new Error(`FPDFPage_GetObject answered nothing for index ${String(index)} on page ${String(page)}.`);
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
    throw new Error('FPDFPageObj_GetBounds refused an object this page handed back.');
  }
  return { left: left[0] ?? 0, bottom: bottom[0] ?? 0, right: right[0] ?? 0, top: top[0] ?? 0 };
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
        throw new Error(
          `FPDFPageObj_GetMatrix refused object ${String(index)} on page ${String(page)}, so its ` +
            'placement cannot be recorded and an edit to it could not be undone.',
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
      generate(bindings, handle);
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
        throw new Error(
          `FPDFPageObj_SetMatrix refused object ${String(index)} on page ${String(page)}.`,
        );
      }
      generate(bindings, handle);
    });
  });
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
          throw new Error(
            `FPDFPageObj_SetFillColor refused object ${String(fill.index)} on page ${String(page)} ` +
              `(FPDF_GetLastError ${String(bindings.lastError())}).`,
          );
        }
      }
      generate(bindings, handle);
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
          throw new Error(
            `FPDFPage_RemoveObject refused object ${String(index)} on page ${String(page)}.`,
          );
        }
        bindings.destroyObject(objects[at]);
      }
      generate(bindings, handle);
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
 */
function generate(bindings: Bound, handle: unknown): void {
  if (numberFrom(bindings.generateContent(handle), 'FPDFPage_GenerateContent') !== 1) {
    throw new Error(
      'FPDFPage_GenerateContent failed, so the edit would be present in memory and absent from the saved bytes.',
    );
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
      // memory. Same hazard as `mupdfWriter.ts`'s view into the WASM heap.
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
    if (ok !== 1) {
      throw new Error(
        `FPDF_SaveAsCopy answered ${String(ok)} (FPDF_GetLastError ${String(bindings.lastError())}).`,
      );
    }
    return Buffer.concat(blocks);
  } finally {
    koffi.unregister(callback);
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
 * is a `ByteImage` and they are different types on purpose.
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
   * passed through. Two reasons and both are load-bearing: `FPDF_LoadMemDocument`
   * keeps reading the caller's memory for the document's whole life (see
   * {@link Live}), and a `ByteImage` is the kernel's canonical image, which
   * nothing below the seam may hold a live pointer into.
   *
   * No password is offered. An encrypted document is a Stage 7 concern with its
   * own row, and a `null` here makes PDFium refuse one loudly rather than this
   * adapter inventing an empty-string policy nobody wrote down.
   */
  open(image: ByteImage): Promise<PdfiumSession> {
    return promised(() => {
      const bindings = api();
      const bytes = Buffer.from(image);
      const document: unknown = bindings.loadDocument(bytes, bytes.length, null);
      if (document === null) {
        throw new Error(
          `PDFium refused the document (FPDF_GetLastError ${String(bindings.lastError())}).`,
        );
      }
      // The one place a PdfiumSession is minted. Keeping this cast unexported is
      // what makes the brand mean "this adapter produced it".
      const session = { engine: 'pdfium' } as PdfiumSession;
      documents.set(session, { document, bytes });
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
    return promised(() => new Uint8Array(saveAsCopy(documentFor(session))));
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
