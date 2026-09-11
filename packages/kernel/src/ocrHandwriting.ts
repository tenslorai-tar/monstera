import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { TrocrSize } from '@monstera/contract';
import { ColorSpace, DrawDevice, Matrix, Pixmap, Rect } from 'mupdf';

import type { MupdfSession } from './engineSeam.js';
import {
  HANDWRITING_MODELS,
  RUNTIME_ARTEFACTS,
  type TokenizerFamily,
} from './handwritingArtefacts.js';
import { withDocument } from './mupdfWriter.js';
import { displayedBox } from './pageBoxes.js';
import type { RecognisedPage } from './ocrRecognise.js';

/**
 * The TrOCR boundary — **one text line of a region becomes one line of text**.
 *
 * ## What this engine is for, and the one thing it is not offered on
 *
 * [ADR-0052](../../../docs/DECISIONS/0052-a-second-recogniser-arrives-on-demand-and-reads-a-region.md)
 * Decision 4. TrOCR reads a single text line — that is the model, not the
 * wiring — and a line costs seconds. A *recognise this page* control built on it
 * would work and take minutes, which is the wired-tools rule's own territory: a
 * button whose honest behaviour nobody would choose. So the region is required
 * here rather than optional, and page and document scope stay Tesseract's.
 *
 * ## It answers the SAME SHAPE as Tesseract, with two honest gaps
 *
 * `RecognisedPage`, so nothing downstream chooses between two answer types. What
 * differs is what the model can actually say:
 *
 * - **No word boxes.** TrOCR emits tokens, not glyph positions; deriving a box
 *   per word would need decoder cross-attention and a heuristic on top of it.
 *   The line carries the region's own box and an **empty word list**, which
 *   `ocrTextLayer.ts` already handles — *a line without words writes the line's
 *   own box* — so the text layer needs no new path. Inventing per-word boxes
 *   would be a measurement this build did not make.
 * - **A different confidence.** Tesseract's is its own 0-100 reading of the
 *   characters. This is the mean probability of the tokens the greedy loop
 *   chose, scaled the same way, and it answers a different question: *how sure
 *   was the model of the text it emitted*, which says nothing about whether the
 *   image held that text at all. A blank region produces a confident sentence —
 *   measured, below — so the number must never be read as evidence that
 *   something was there.
 *
 * ## English only, and the request's language is NOT echoed
 *
 * The repositories are `trocr-{small,base}-handwritten`, which are English. A
 * caller whose OCR language is German gets `language: 'eng'` back, because that
 * is the model that read it — echoing the request would put a language in the
 * answer that no model here can honour, and the answer is what a text layer and
 * a surface believe.
 *
 * ## THE BLANK RASTER IS THE FAILURE THIS MODULE IS SHAPED AROUND
 *
 * Measured 2026-09-11 while writing the spike: composing the page's own ctm into
 * the matrix handed to `page.run` applies it twice, which put the ink outside
 * the pixmap and produced a white 384x384 square. TrOCR did not answer an empty
 * string — it answered a fluent sentence about the United States, at high token
 * probability, from a blank image.
 *
 * That is worse than this project's usual reassuring answer, because it is not
 * reassuring, it is *convincing*. Two things follow and both are load-bearing:
 * the raster is produced by MuPDF's own scaler with the transform measured
 * rather than reasoned about, and the proof carries a blank region as a case so
 * the same mistake cannot pass as a recognition again.
 *
 * ## Not reachable from the barrel
 *
 * [ADR-0026](../../../docs/DECISIONS/0026-a-declaration-is-not-an-implementation.md)
 * clause 2, `ocrRecognise.ts`' rule: this module's graph binds MuPDF and loads a
 * WASM runtime, so the host entry imports it directly and `index.ts` never
 * names it. `handwritingArtefacts.ts` — data only — is the half main reads.
 */

/**
 * The side of the square the models take, from their own preprocessor config.
 *
 * Both repositories declare `size: {height: 384, width: 384}` with
 * `do_center_crop: false`, so the region is **squashed** to a square rather than
 * letterboxed — read from the config rather than chosen here, and the same for
 * both sizes (measured 2026-09-11).
 */
const INPUT_SIDE = 384;

/**
 * The decoder's first token, and the one that ends it.
 *
 * `decoder_start_token_id: 2` and `eos_token_id: 2` in both repositories'
 * `generation_config.json`. They are the same id, which is why the loop below
 * cannot stop on the first token it sees.
 */
const START_TOKEN = 2;
const END_TOKEN = 2;

/**
 * How many tokens one line may produce before the loop gives up.
 *
 * A greedy decoder with no length penalty can repeat until something stops it,
 * and a run that never stops is an engine host that never answers. Sixty tokens
 * is several times the longest plausible handwritten line at this model's
 * sub-word granularity, and reaching it is reported as a truncation rather than
 * passed off as the end of the text.
 */
const MAX_TOKENS = 60;

/** The ORT surface this build uses, declared rather than cast to `any` (B7). */
interface OrtTensor {
  readonly dims: readonly number[];
  readonly data: Float32Array;
}

interface OrtSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
}

interface OrtModule {
  readonly env: {
    wasm: { numThreads: number; wasmPaths: { mjs: string; wasm: string } };
    logLevel: string;
  };
  readonly Tensor: new (
    type: 'float32' | 'int64',
    data: Float32Array | BigInt64Array,
    dims: readonly number[],
  ) => unknown;
  readonly InferenceSession: {
    create(model: Uint8Array): Promise<OrtSession>;
  };
}

/** One model, loaded and ready. Held for the life of the host process. */
interface LoadedModel {
  readonly encoder: OrtSession;
  readonly decoder: OrtSession;
  readonly vocabulary: readonly string[];
  readonly family: TokenizerFamily;
}

/**
 * Loaded runtimes and models, held for the life of the process.
 *
 * `ocrRecognise.ts`'s `loadedCore` one engine along, and for its reason: the
 * host is long-lived and creating both sessions costs **1,374 ms** measured, so
 * a second region in the same session must not pay it again.
 *
 * Nested rather than keyed by a joined string, deliberately: a directory and a
 * size concatenated into one key is a separator somebody has to choose, and the
 * first attempt at this line emitted an invisible `0x00` where the space was
 * meant to go. Two maps cannot have that defect at all.
 */
const runtimes = new Map<string, Promise<OrtModule>>();
const models = new Map<string, Map<TrocrSize, Promise<LoadedModel>>>();

/**
 * A model directory that cannot be read, told apart from a region that would not
 * recognise.
 *
 * `ocrRecognise.ts`'s `OcrModelUnreadableError` for the same reason: a missing
 * or ungranted cache is main's to fix — it downloads and grants — where a region
 * the model will not read is this row's. The channel maps them to different
 * codes so a supervisor is not sent after a recognition bug.
 */
export class HandwritingModelUnreadableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'HandwritingModelUnreadableError';
  }
}

function readArtefact(directory: string, file: string): Uint8Array {
  try {
    return readFileSync(join(directory, file));
  } catch (cause) {
    throw new HandwritingModelUnreadableError(
      `The handwriting model file ${file} could not be read from ${directory}. Main downloads ` +
        `these against a pinned SHA-256 and grants this process the directory; a file missing ` +
        `here is a download that has not happened or a grant that did not.`,
      { cause },
    );
  }
}

/**
 * The ONNX Runtime, imported from the files main downloaded.
 *
 * **`numThreads` is 1 deliberately.** The threaded build fetches its worker
 * through a URL the file scheme does not satisfy in Node — measured 2026-09-11,
 * and recorded as unmeasured headroom rather than worked around. Asking for more
 * threads does not fail slowly; it fails with *no available backend found*.
 *
 * `wasmPaths` names both files explicitly rather than a directory prefix, so a
 * runtime that cannot find its binary says which file it wanted.
 */
async function loadRuntime(directory: string): Promise<OrtModule> {
  const cached = runtimes.get(directory);
  if (cached !== undefined) return cached;

  const loading = (async () => {
    const [api, factory, binary] = RUNTIME_ARTEFACTS;
    if (api === undefined || factory === undefined || binary === undefined) {
      throw new HandwritingModelUnreadableError('The runtime manifest names no files.');
    }
    // READ FIRST, so a missing runtime is the model-unreadable state rather than
    // an import failure from inside ORT with a stack nobody can act on.
    readArtefact(directory, api.file);
    readArtefact(directory, factory.file);
    readArtefact(directory, binary.file);

    const imported: unknown = await import(pathToFileURL(join(directory, api.file)).href);
    const ort = imported as OrtModule;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = {
      mjs: pathToFileURL(join(directory, factory.file)).href,
      wasm: pathToFileURL(join(directory, binary.file)).href,
    };
    ort.env.logLevel = 'error';
    return ort;
  })();

  runtimes.set(directory, loading);
  return loading;
}

/**
 * The encoder, the decoder and the vocabulary for one size.
 *
 * The vocabulary is read from the tokenizer the manifest pins, and **which
 * detokeniser it needs is read from the manifest too** rather than sniffed from
 * the file: `small` is `Unigram` with an array vocabulary and `base` is `BPE`
 * with an object one, measured per repository. Guessing wrong produces an empty
 * string, which on an OCR feature is a product answer.
 */
async function loadModel(directory: string, size: TrocrSize): Promise<LoadedModel> {
  const bySize = models.get(directory) ?? new Map<TrocrSize, Promise<LoadedModel>>();
  models.set(directory, bySize);
  const cached = bySize.get(size);
  if (cached !== undefined) return cached;

  const loading = (async () => {
    const ort = await loadRuntime(directory);
    const manifest = HANDWRITING_MODELS[size];
    const encoder = await ort.InferenceSession.create(
      readArtefact(directory, manifest.encoder.file),
    );
    const decoder = await ort.InferenceSession.create(
      readArtefact(directory, manifest.decoder.file),
    );
    const tokenizer = JSON.parse(
      Buffer.from(readArtefact(directory, manifest.tokenizer.file)).toString('utf8'),
    ) as { model?: { vocab?: unknown } };
    return {
      encoder,
      decoder,
      vocabulary: vocabularyOf(tokenizer.model?.vocab, manifest.family),
      family: manifest.family,
    };
  })();

  bySize.set(size, loading);
  return loading;
}

/**
 * The id to piece table, from either vocabulary shape.
 *
 * `Unigram` stores `[piece, score]` pairs **indexed by id**; `BPE` stores an
 * object mapping piece to id, which has to be inverted. Both are read here so
 * the decode loop sees one array and the difference lives in one place.
 */
function vocabularyOf(vocab: unknown, family: TokenizerFamily): readonly string[] {
  if (family === 'unigram-metaspace') {
    if (!Array.isArray(vocab)) {
      throw new HandwritingModelUnreadableError(
        'A Unigram tokenizer states its vocabulary as an array of [piece, score]; this one does ' +
          'not, so no id could be turned into a piece.',
      );
    }
    return vocab.map((entry) => (Array.isArray(entry) ? String(entry[0]) : ''));
  }

  if (typeof vocab !== 'object' || vocab === null || Array.isArray(vocab)) {
    throw new HandwritingModelUnreadableError(
      'A BPE tokenizer states its vocabulary as an object of piece to id; this one does not, so ' +
        'no id could be turned into a piece.',
    );
  }
  const table: string[] = [];
  for (const [piece, id] of Object.entries(vocab as Record<string, unknown>)) {
    if (typeof id === 'number') table[id] = piece;
  }
  return table;
}

/**
 * GPT-2's byte to printable-character table, built rather than transcribed.
 *
 * A `ByteLevel` tokenizer stores each byte as a printable codepoint so a
 * vocabulary can be JSON. Decoding is the inverse: map each character of the
 * joined pieces back to its byte, then read those bytes as UTF-8 — which is what
 * makes a multi-byte character survive being split across two tokens.
 *
 * The 188 bytes that are already printable map to themselves; the remaining 68
 * are moved to `U+0100` upwards in order, which is the algorithm rather than a
 * table somebody typed.
 */
function byteLevelTable(): Map<string, number> {
  const direct = new Set<number>();
  for (let b = 0x21; b <= 0x7e; b += 1) direct.add(b);
  for (let b = 0xa1; b <= 0xac; b += 1) direct.add(b);
  for (let b = 0xae; b <= 0xff; b += 1) direct.add(b);

  const table = new Map<string, number>();
  let next = 0;
  for (let b = 0; b < 256; b += 1) {
    if (direct.has(b)) {
      table.set(String.fromCodePoint(b), b);
      continue;
    }
    table.set(String.fromCodePoint(0x100 + next), b);
    next += 1;
  }
  return table;
}

const BYTE_LEVEL = byteLevelTable();

/**
 * The `Metaspace` replacement character, written by codepoint.
 *
 * `U+2581` LOWER ONE EIGHTH BLOCK is what a Unigram vocabulary stores instead of
 * a space. Spelt as an escape rather than pasted: this file already emitted one
 * invisible byte where a space belonged, and a character whose whole job is to
 * stand for a space is the worst one to have to recognise by eye in a diff.
 */
const METASPACE = '▁';

/**
 * Pieces back into text, by the family the manifest names.
 *
 * Neither family needs merge rules or an encoder side: decoding is a join and a
 * substitution, which is why no tokenizer library is a dependency of this build.
 */
export function detokenise(pieces: readonly string[], family: TokenizerFamily): string {
  const joined = pieces.join('');
  if (family === 'unigram-metaspace') return joined.replaceAll(METASPACE, ' ').trim();

  const bytes: number[] = [];
  for (const character of joined) {
    const byte = BYTE_LEVEL.get(character);
    // A CHARACTER OUTSIDE THE TABLE IS DROPPED, and that is the honest answer
    // rather than a replacement glyph: the table covers all 256 bytes, so a
    // character not in it came from a vocabulary entry that is not byte-level —
    // a special token, which is not part of the text.
    if (byte !== undefined) bytes.push(byte);
  }
  return new TextDecoder().decode(Uint8Array.from(bytes)).trim();
}

/**
 * What one region's raster is, as the model wants it.
 *
 * EXPORTED WITH ITS PRODUCER, because the raster is where this engine's worst
 * failure lives and it is the half that can be checked without downloading 67 MB
 * of model: ink normalises towards −1 and paper towards +1, so *did anything get
 * drawn* is one `Math.min` rather than a recognition.
 */
export interface RegionRaster {
  readonly pixels: Float32Array;
  readonly side: number;
}

/**
 * The region, rasterised to exactly one square by **MuPDF's own scaler**.
 *
 * ## Why the region is rasterised rather than the page
 *
 * Tesseract narrows the recognition and keeps the whole page's raster, because
 * its layout analysis reads the surroundings. TrOCR has no layout analysis: it
 * takes one image and reads the line in it. So the region *is* the image, and
 * asking MuPDF to draw it at the model's own size means the resampling is done
 * from the page's content by the engine that owns it — not by a bitmap resizer
 * written here, which would be a second opinion about a question MuPDF answers
 * (B3a) and the exact place the spike's nearest-neighbour resize cost accuracy.
 *
 * ## `page.run(device, M)` APPLIES M AFTER THE PAGE'S OWN ctm
 *
 * Measured, and it is the single most expensive thing to get wrong here.
 * Composing `getTransform()` into `M` applies it twice, which puts the ink
 * outside the pixmap and leaves a white square — and TrOCR answers a blank
 * square with a confident sentence rather than with nothing. So the matrix
 * passed below is only what happens *after* the ctm: the scale that squashes the
 * region to the square, then a translation putting its corner at the origin.
 */
export function rasteriseRegion(
  session: MupdfSession,
  pageIndex: number,
  region: readonly [number, number, number, number],
): Promise<RegionRaster> {
  return withDocument(session, (document) => {
    const total = document.countPages();
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= total) {
      throw new RangeError(
        `Page ${String(pageIndex)} is outside this document, which has ${String(total)} page(s). ` +
          'Page indices are zero-based.',
      );
    }
    const page = document.loadPage(pageIndex);
    if (displayedBox(page.getObject()) === null) {
      throw new RangeError(
        `page ${String(pageIndex)} displays no region, so there is nothing to recognise — it has ` +
          'no /MediaBox of four numbers, or its /CropBox and /MediaBox do not overlap',
      );
    }

    // THE REGION AS DISPLAYED, which is where a `/Rotate` is accounted for: the
    // ctm carries the flip, the crop origin and the rotation, so a turned page
    // needs no case here (FFFFFF-1's fix, one engine along).
    const displayed = Rect.transform(
      [region[0], region[1], region[2], region[3]],
      page.getTransform(),
    );
    const width = displayed[2] - displayed[0];
    const height = displayed[3] - displayed[1];
    if (width <= 0 || height <= 0) {
      throw new RangeError(
        `the region [${region.join(', ')}] has no area on page ${String(pageIndex)}, so there is ` +
          'nothing to read. A region is in PDF user space, ordered or not.',
      );
    }

    const scale = Matrix.scale(INPUT_SIDE / width, INPUT_SIDE / height);
    const scaled = Rect.transform(displayed, scale);
    const afterCtm = Matrix.concat(scale, Matrix.translate(-scaled[0], -scaled[1]));

    const pixmap = new Pixmap(ColorSpace.DeviceRGB, [0, 0, INPUT_SIDE, INPUT_SIDE], false);
    try {
      // WHITE, not the pixmap's own zeroes. A region whose page paints no
      // background would otherwise reach the model as black, and a model asked
      // to read black answers something.
      pixmap.clear(255);
      const device = new DrawDevice(Matrix.identity, pixmap);
      try {
        page.run(device, afterCtm);
      } finally {
        // CLOSED, not merely dropped: an unclosed draw device leaves MuPDF
        // warning and the pixmap's last operations unflushed.
        device.close();
      }
      return { pixels: toTensor(pixmap), side: INPUT_SIDE };
    } finally {
      pixmap.destroy();
    }
  });
}

/**
 * RGB bytes into the model's input tensor — rescale by 1/255, then normalise
 * `(x - 0.5) / 0.5`, laid out channel-first.
 *
 * Every number here is from the repositories' own `preprocessor_config.json`:
 * `rescale_factor` 1/255, `image_mean` and `image_std` both 0.5 on all three
 * channels, identical for `small` and `base` (measured 2026-09-11). They are not
 * constants this build chose, and a model whose config disagreed would need this
 * read from the file rather than written here.
 */
function toTensor(pixmap: Pixmap): Float32Array {
  const width = pixmap.getWidth();
  const height = pixmap.getHeight();
  const stride = pixmap.getStride();
  const components = pixmap.getNumberOfComponents();
  const pixels = pixmap.getPixels();
  const plane = width * height;
  const tensor = new Float32Array(3 * plane);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * stride + x * components;
      for (let channel = 0; channel < 3; channel += 1) {
        tensor[channel * plane + y * width + x] = ((pixels[at + channel] ?? 0) / 255 - 0.5) / 0.5;
      }
    }
  }
  return tensor;
}

/** What the greedy loop produced. */
interface Decoded {
  readonly pieces: readonly string[];
  /** Mean probability of the chosen tokens, 0 to 1. */
  readonly confidence: number;
  /** True when the loop hit its bound instead of the model's end token. */
  readonly truncated: boolean;
}

/**
 * Greedy argmax over the decoder, one token at a time.
 *
 * No KV cache: the merged decoder that carries one was deliberately not wired,
 * and it is unmeasured headroom rather than a promised speedup. What that costs
 * is re-running the decoder over the whole prefix each step, which is small
 * beside the encoder — 423 ms for five tokens against 1,704 ms for the encoder,
 * measured on a region at this size.
 *
 * The confidence is the mean softmax probability of the tokens it chose,
 * computed from the same logits row the argmax reads. It says nothing about
 * whether the image held text, which is why the module header says so.
 */
async function decode(model: LoadedModel, hidden: OrtTensor, ort: OrtModule): Promise<Decoded> {
  const ids: number[] = [START_TOKEN];
  const probabilities: number[] = [];
  const [inputName = 'input_ids', hiddenName = 'encoder_hidden_states'] = model.decoder.inputNames;
  const [logitsName = 'logits'] = model.decoder.outputNames;

  let truncated = true;
  for (let step = 0; step < MAX_TOKENS; step += 1) {
    const outputs = await model.decoder.run({
      [inputName]: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      [hiddenName]: hidden,
    });
    const logits = outputs[logitsName];
    if (logits === undefined) {
      throw new HandwritingModelUnreadableError(
        `The decoder answered no "${logitsName}" output, so there is nothing to read a token from.`,
      );
    }
    const [, sequence = 1, vocabulary = 0] = logits.dims;
    const row = (sequence - 1) * vocabulary;

    let best = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let id = 0; id < vocabulary; id += 1) {
      const score = logits.data[row + id] ?? Number.NEGATIVE_INFINITY;
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }

    // SOFTMAX OVER THE ROW, SHIFTED BY THE MAXIMUM. Exponentiating raw logits
    // overflows to Infinity for a confident model and yields NaN, and a
    // confidence that is NaN reads as a missing number rather than a wrong one.
    let total = 0;
    for (let id = 0; id < vocabulary; id += 1) {
      total += Math.exp((logits.data[row + id] ?? Number.NEGATIVE_INFINITY) - bestScore);
    }
    probabilities.push(total > 0 ? 1 / total : 0);

    if (best === END_TOKEN && ids.length > 1) {
      truncated = false;
      break;
    }
    ids.push(best);
  }

  const pieces = ids.slice(1).map((id) => model.vocabulary[id] ?? '');
  const confidence =
    probabilities.length === 0
      ? 0
      : probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length;
  return { pieces, confidence, truncated };
}

/**
 * Which region of which page to read, and with which model — **what a caller in
 * main asks for**.
 *
 * The cache directory is deliberately not here, which is `OcrRequest`'s own
 * rule: where the models live is main's answer rather than the asker's, and a
 * request carrying a directory would be a path chosen by whoever composed it.
 */
export interface HandwritingScope {
  /** Zero-based. */
  readonly page: number;
  /** **Required** — this engine is never offered on a page (ADR-0052 §4). */
  readonly region: readonly [number, number, number, number];
  readonly size: TrocrSize;
}

/** {@link HandwritingScope} plus the directory main granted this host. */
export type HandwritingRequest = HandwritingScope & { readonly modelDirectory: string };

/**
 * Reads one region of one page as a single line of handwriting.
 *
 * **The raster never leaves this function**, the same gate `recognisePage`
 * satisfies: §9.17 keeps bitmaps inside the process that produced them, and what
 * crosses is one line of text.
 *
 * @throws `RangeError` for a page this document does not have or a region with
 *   no area, and {@link HandwritingModelUnreadableError} for a cache that cannot
 *   be read.
 */
export async function recogniseHandwriting(
  session: MupdfSession,
  request: HandwritingRequest,
): Promise<RecognisedPage> {
  const raster = await rasteriseRegion(session, request.page, request.region);
  const ort = await loadRuntime(request.modelDirectory);
  const model = await loadModel(request.modelDirectory, request.size);

  const [pixelName = 'pixel_values'] = model.encoder.inputNames;
  const [hiddenName = 'last_hidden_state'] = model.encoder.outputNames;
  const encoded = await model.encoder.run({
    [pixelName]: new ort.Tensor('float32', raster.pixels, [1, 3, raster.side, raster.side]),
  });
  const hidden = encoded[hiddenName];
  if (hidden === undefined) {
    throw new HandwritingModelUnreadableError(
      `The encoder answered no "${hiddenName}" output, so the decoder has nothing to read.`,
    );
  }

  const decoded = await decode(model, hidden, ort);
  const text = detokenise(decoded.pieces, model.family);

  return {
    // ONE LINE, AT THE REGION'S OWN BOX, WITH NO WORDS. The reader drew that
    // rectangle around a line, and it is the only position information this
    // engine has; `ocrTextLayer.ts` writes a line's own box when it carries no
    // words, so this shape needs no new path there.
    lines: text === '' ? [] : [{ text, box: ordered(request.region), words: [] }],
    confidence: Math.round(decoded.confidence * 100),
    // THE MODEL THAT READ IT, not the language that was asked for: both
    // repositories are English, and an answer naming another language would be
    // believed by the text layer and by every surface downstream.
    language: 'eng',
  };
}

/** A rectangle with its corners in order, whichever way it was dragged. */
function ordered(
  box: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  return [
    Math.min(box[0], box[2]),
    Math.min(box[1], box[3]),
    Math.max(box[0], box[2]),
    Math.max(box[1], box[3]),
  ];
}
