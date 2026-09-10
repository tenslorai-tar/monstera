import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import type { OcrLanguage } from '@monstera/contract';
import { ColorSpace, Matrix } from 'mupdf';

import type { MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { displayedBox } from './pageBoxes.js';

/**
 * The Tesseract native boundary — a raster becomes characters and their boxes.
 *
 * ## Which package, and why not the wrapper
 *
 * [ADR-0050](../../../docs/DECISIONS/0050-the-ocr-binding-is-tesseracts-core-driven-directly.md).
 * `tesseract.js` cannot be a production dependency of this build: its tree
 * reaches `tr46@0.0.3`, which ships no licence text while declaring MIT, and
 * `generateNotice.mjs` refuses to render a NOTICE that drops a package.
 * `tesseract.js-core` is where the WASM is, declares no dependencies, and is the
 * version the wrapper itself pins. What the wrapper adds is worker
 * orchestration this build does not want — recognition runs inside the engine
 * host, and invariant 25 is the isolation — plus a model CDN ADR-0014 constraint
 * 1 rules against.
 *
 * ## It is TOLD where the models are; it never decides
 *
 * `pdfiumFfi.ts`' rule, for the same reason: `scripts/provision/tessdata.mjs`
 * owns *where a provisioned model lives*, the kernel cannot import a script, and
 * a second answer here would be the B3a defect this project has paid for three
 * times. The directory is a parameter with **no fallback and no search**, so a
 * wrong path is a loud failure at one call site rather than a quiet
 * disagreement between two resolvers.
 *
 * The language is an {@link OcrLanguage}, which is a closed enum — ADR-0014
 * constraint 1 forbids a language or datadir *influenced by a document or
 * user-supplied*, because both of Tesseract's live advisories are reached
 * through a crafted model file. A name from fourteen supplies no file and no
 * path.
 *
 * ## THE BOXES COME BACK IN PDF USER SPACE, CONVERTED HERE
 *
 * Tesseract answers in **raster pixels, y-down from the top-left**. A PDF
 * content stream is **points, y-up from the box's origin**. Those are two frames
 * and the conversion is exactly the wired pair's blind spot — *where the two
 * halves speak different coordinate systems, it proves nothing until something
 * names both numbers in one place*. So the conversion lives in this module,
 * which is the one place that holds both the matrix it rasterised with and the
 * box it rasterised from, and nothing downstream sees a pixel.
 *
 * The control is in `ocrRecognise.proof.mjs`: text drawn at a known point must
 * come back with a box containing that point, **and not** containing the
 * y-mirrored one. A flipped sign puts it the same distance from the other edge,
 * which on a centred fixture is the same box — so the fixture is deliberately
 * off-centre and the second assertion is what makes the first mean anything.
 *
 * ## Not reachable from the barrel
 *
 * [ADR-0026](../../../docs/DECISIONS/0026-a-declaration-is-not-an-implementation.md)
 * clause 2, and `proof:kernelload` enforces it. Nothing here is exported from
 * `index.ts`: the host entry imports it directly, the way `mupdfWriter.js` is
 * reached, so importing the kernel from `main` loads no WASM.
 */

const require = createRequire(import.meta.url);

/**
 * What the page is rasterised at, in pixels per inch.
 *
 * **200, and it is a measured figure rather than a round number.** It is what
 * `7beee3a` probed the wrapper at and what ADR-0050 compared the two bindings
 * at, reading a real corpus scan at **mean confidence 94**. Raising it raises
 * the raster's area quadratically, and the raster is the input to a four-second
 * operation — so the number is stated with what it was measured against rather
 * than tuned.
 */
export const OCR_DPI = 200;

/** Tesseract's `OEM_LSTM_ONLY`, the only engine the `4.0.0_fast` models carry. */
const LSTM_ONLY = 1;

/** Where a model is written inside the core's own in-memory filesystem. */
export const CORE_DATA_DIRECTORY = '/tessdata';

/** Where the page's PNG is written inside that filesystem. */
const CORE_IMAGE_PATH = '/input';

/**
 * The slice of Emscripten's module surface this build uses.
 *
 * Declared rather than `any`, which is what keeps B7's one-adapter-per-boundary
 * rule honest: the package ships no types, so the boundary is a cast, and a cast
 * to a named shape is checkable where a cast to `any` removes the question.
 */
interface TesseractFilesystem {
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
  mkdir(path: string): void;
  unlink(path: string): void;
}

/** Tesseract's C++ API, as Emscripten exposes it. */
export interface TessBaseApi {
  Init(dataPath: string | null, language: string, oem: number): number;
  SetImageFile(exif: number, angle: number): number;
  Recognize(monitor: null): number;
  GetUTF8Text(): string;
  GetJSONText(): string;
  MeanTextConf(): number;
  End(): void;
}

/** Tesseract's own text-only PDF writer, for `(base, dataDir, textOnly)`. */
export interface TessPdfRenderer {
  BeginDocument(title: string): boolean;
  AddImage(api: TessBaseApi): boolean;
  EndDocument(): boolean;
}

export interface TesseractCore {
  readonly FS: TesseractFilesystem;
  readonly TessBaseAPI: new () => TessBaseApi;
  /**
   * Declared because a caller needs it, and that caller is not this module.
   *
   * `scripts/research/textLayerFont.mjs` measures whether the glyphless CID font
   * this renderer embeds carries a right-to-left reading back out through MuPDF
   * — which is D6 row 3's open question. Nothing here calls it yet; D6 row 5's
   * searchable-PDF export is what will.
   */
  readonly TessPDFRenderer: new (base: string, dataDirectory: string, textOnly: boolean) => TessPdfRenderer;
}

type CoreFactory = () => Promise<TesseractCore>;

/**
 * The core builds, most capable first, each named by a **literal**.
 *
 * Tried in order rather than feature-detected, which is what lets this take no
 * second dependency: `tesseract.js` reaches for `wasm-feature-detect` here, and
 * *can this runtime instantiate this module* is answered exactly by
 * instantiating it.
 *
 * The specifiers are literals because a computed one is a site
 * `proof:electronimports` cannot read — it reported the research instrument for
 * exactly this on its first run — and because a literal is what a bundler can
 * follow.
 */
const CORE_BUILDS: readonly (() => CoreFactory)[] = [
  () => require('tesseract.js-core/tesseract-core-relaxedsimd-lstm') as CoreFactory,
  () => require('tesseract.js-core/tesseract-core-simd-lstm') as CoreFactory,
  () => require('tesseract.js-core/tesseract-core-lstm') as CoreFactory,
];

/**
 * The instantiated core, kept for the life of the process.
 *
 * **Not a session table.** It holds no document and no recognition state: a
 * `TessBaseAPI` is created, initialised, used and ended inside one call, so
 * nothing here is stale against anything. What is cached is the WASM module
 * itself, measured at 51–83 ms to instantiate against 3.8–4.4 s to recognise a
 * page — paying it per page would be 2% of the operation, and paying it once is
 * simply free.
 */
let core: TesseractCore | null = null;

/**
 * Models already written into the core's filesystem.
 *
 * **Keyed on the directory AND the language**, which it was not at first: keyed
 * on the language alone, a second call naming a different directory silently got
 * the first directory's model, and `ocrRecognise.proof.mjs`' grant case found
 * that on its first run — it asked for a directory holding no models and was
 * answered out of the cache. The directory is a constant in this application,
 * which is exactly NNN-1's tell: *an input held constant across a whole file* is
 * an input nothing is asking about.
 */
const written = new Set<string>();

/**
 * A model this process cannot read.
 *
 * **Its own type, because it is a different state from a page that would not
 * recognise** — and the two are answered by different people: a grant or a
 * provisioning problem is main's, a page Tesseract cannot read is this feature's.
 * `engine/ocr-page` maps it to `ocr-model-unreadable` rather than `ocr-failed`,
 * which is `unreadable`'s own argument in `engine/probe-containment` one noun
 * along.
 *
 * A CLASS and not a message match. The handler used to key on the wording of the
 * message, which is a guard keyed on a name its own author controls — it survives
 * a rewrite of the sentence only by luck, and the failure is silent
 * misclassification rather than a red check.
 */
export class OcrModelUnreadableError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'OcrModelUnreadableError';
  }
}

/**
 * The instantiated core.
 *
 * Exported so `scripts/research/textLayerFont.mjs` measures through the same
 * loader the application uses (B3a): *which build of Tesseract does this project
 * instantiate, and how* is one question, and a research instrument answering it
 * separately would be a second opinion whose figures argue about a different
 * engine.
 */
export async function loadedCore(): Promise<TesseractCore> {
  if (core !== null) return core;
  const refusals: string[] = [];
  for (const build of CORE_BUILDS) {
    try {
      const instantiated = await build()();
      instantiated.FS.mkdir(CORE_DATA_DIRECTORY);
      core = instantiated;
      return instantiated;
    } catch (error) {
      refusals.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(
    `no Tesseract core build would instantiate on this runtime. Refusals: ${refusals.join(' | ')}`,
  );
}

/**
 * Makes one language's model available to the core.
 *
 * Read from the granted directory and **decompressed here**: the provisioned
 * files are `.traineddata.gz` because that is what the CDN serves and what
 * `downloadVerified` pinned the digest of, and Tesseract reads the expanded
 * form. `gunzipSync` is Node's, so no second compression library arrives for
 * three lines (`tesseract.js` carries `zlibjs` for the browser's sake).
 */
export function ensureModel(
  loaded: TesseractCore,
  directory: string,
  language: OcrLanguage,
): void {
  const key = `${directory} :: ${language}`;
  if (written.has(key)) return;
  const path = join(directory, `${language}.traineddata.gz`);
  let expanded: Uint8Array;
  try {
    expanded = gunzipSync(readFileSync(path));
  } catch (error) {
    throw new OcrModelUnreadableError(
      `the ${language} model could not be read from the granted model directory. This process ` +
        `reaches that directory because it was handed it, so a failure here is a provisioning or ` +
        `a grant problem rather than a recognition one.`,
      error,
    );
  }
  loaded.FS.writeFile(`${CORE_DATA_DIRECTORY}/${language}.traineddata`, expanded);
  written.add(key);
}

/** One recognised word, its box in **PDF user space**. */
export interface RecognisedWord {
  readonly text: string;
  /** `[x0, y0, x1, y1]` in PDF user space, y-up, ordered. */
  readonly box: readonly [number, number, number, number];
  /** Tesseract's own confidence for this word, 0 to 100. */
  readonly confidence: number;
}

/** One recognised line, in reading order, with its words. */
export interface RecognisedLine {
  readonly text: string;
  readonly box: readonly [number, number, number, number];
  readonly words: readonly RecognisedWord[];
}

/** What one page's recognition answers. */
export interface RecognisedPage {
  readonly lines: readonly RecognisedLine[];
  /** Tesseract's mean confidence across the page, 0 to 100. */
  readonly confidence: number;
  /** The language the model was asked for, echoed so a caller cannot lose it. */
  readonly language: OcrLanguage;
}

/** Tesseract's box, as its JSON renderer writes it: raster pixels, y-down. */
interface RasterBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * The one conversion from Tesseract's frame to the page's.
 *
 * Raster pixels, y-down from the top-left, become points, y-up from the
 * displayed box's origin. Both halves matter and a fixture at the origin can
 * only show one: the scale is `72 / dpi`, and the flip is a subtraction from the
 * box's **top edge** — because `toPixmap` rasterises the page's displayed
 * bounds, so pixel `(0, 0)` is that box's top-left corner, not the sheet's.
 *
 * Subtracting from `frame.y1` rather than from a height is the legal spelling
 * `geometry.ts` uses, and it is also the true one: the top edge is what pixel
 * row zero is.
 */
function toPdfSpace(
  box: RasterBox,
  frame: { x0: number; y1: number },
  scale: number,
): readonly [number, number, number, number] {
  const x0 = frame.x0 + box.x0 * scale;
  const x1 = frame.x0 + box.x1 * scale;
  const top = frame.y1 - box.y0 * scale;
  const bottom = frame.y1 - box.y1 * scale;
  return [Math.min(x0, x1), Math.min(top, bottom), Math.max(x0, x1), Math.max(top, bottom)];
}

/** A node of Tesseract's JSON tree. Only the members this build reads. */
interface JsonWord {
  readonly text?: string;
  readonly bbox?: RasterBox;
  readonly confidence?: number;
}
interface JsonLine {
  readonly text?: string;
  readonly bbox?: RasterBox;
  readonly words?: readonly JsonWord[];
}
interface JsonParagraph {
  readonly lines?: readonly JsonLine[];
}
interface JsonBlock {
  readonly paragraphs?: readonly JsonParagraph[];
}
interface JsonTree {
  readonly blocks?: readonly JsonBlock[];
}

/**
 * Recognises one page of a session this process holds.
 *
 * **The raster never leaves this function.** §9.17's gate is that no bitmap
 * crosses a process boundary, and this one is produced and consumed inside the
 * host that holds the parse. What crosses is text and boxes, bounded by the
 * channel that carries them.
 *
 * @param session the MuPDF session holding the document
 * @param request which page, in which language, with the models where
 * @throws `RangeError` for a page this document does not have, and `Error` for a
 *   model that cannot be read or a core that will not instantiate
 */
export async function recognisePage(
  session: MupdfSession,
  request: { page: number; language: OcrLanguage; modelDirectory: string },
): Promise<RecognisedPage> {
  const loaded = await loadedCore();
  ensureModel(loaded, request.modelDirectory, request.language);

  const scale = OCR_DPI / 72;
  const raster = await withDocument(session, (document) => {
    const total = document.countPages();
    if (!Number.isInteger(request.page) || request.page < 0 || request.page >= total) {
      throw new RangeError(
        `Page ${String(request.page)} is outside this document, which has ${String(total)} ` +
          'page(s). Page indices are zero-based.',
      );
    }
    const page = document.loadPage(request.page);
    const frame = displayedBox(page.getObject());
    if (frame === null) {
      throw new RangeError(
        `page ${String(request.page)} displays no region, so there is nothing to recognise — it ` +
          'has no /MediaBox of four numbers, or its /CropBox and /MediaBox do not overlap',
      );
    }
    const pixmap = page.toPixmap(
      Matrix.scale(scale, scale),
      // COLOUR, not grey. Tesseract binarises with its own Otsu, and a grey
      // pixmap would be this build pre-empting that — one more answer to a
      // question the engine already owns.
      ColorSpace.DeviceRGB,
      false,
      true,
    );
    try {
      return { png: new Uint8Array(pixmap.asPNG()), frame };
    } finally {
      pixmap.destroy();
    }
  });

  const api = new loaded.TessBaseAPI();
  try {
    const status = api.Init(CORE_DATA_DIRECTORY, request.language, LSTM_ONLY);
    if (status !== 0) {
      throw new Error(
        `Tesseract refused to initialise for ${request.language} with status ${String(status)}`,
      );
    }
    loaded.FS.writeFile(CORE_IMAGE_PATH, raster.png);
    const set = api.SetImageFile(1, 0);
    if (set !== 0) {
      throw new Error(`Tesseract would not read the rasterised page (status ${String(set)})`);
    }
    api.Recognize(null);

    // THE CORE'S OWN JSON RENDERER, which is why no tree walker of ours exists:
    // one call answers blocks, paragraphs, lines and words with a box on each.
    const tree = JSON.parse(api.GetJSONText()) as JsonTree;
    const lines: RecognisedLine[] = [];
    for (const block of tree.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          if (line.bbox === undefined) continue;
          const words: RecognisedWord[] = [];
          for (const word of line.words ?? []) {
            if (word.bbox === undefined || word.text === undefined) continue;
            words.push({
              text: word.text,
              box: toPdfSpace(word.bbox, raster.frame, 1 / scale),
              confidence: word.confidence ?? 0,
            });
          }
          lines.push({
            text: line.text ?? '',
            box: toPdfSpace(line.bbox, raster.frame, 1 / scale),
            words,
          });
        }
      }
    }
    return { lines, confidence: api.MeanTextConf(), language: request.language };
  } finally {
    // ENDED IN A FINALLY, because `End` releases the native image and the
    // adapted page. A throw between `SetImageFile` and here would otherwise
    // leave both held for the life of the process, and the host is long-lived.
    api.End();
    try {
      loaded.FS.unlink(CORE_IMAGE_PATH);
    } catch {
      // The image was never written, which is the only way this throws. The
      // recognition failure above is the finding; a cleanup that had nothing to
      // clean is not.
    }
  }
}
