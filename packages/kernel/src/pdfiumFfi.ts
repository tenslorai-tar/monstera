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
