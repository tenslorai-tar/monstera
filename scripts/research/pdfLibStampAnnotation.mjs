/**
 * Can `@cantoo/pdf-lib` write the `/Stamp` that place-image and stamps ARE, and
 * does MuPDF then OWN it?
 *
 * `docs/FEATURES.md` rows 124 and 128 are blocked on a B4 whose whole content is
 * a number: the image must reach the writer, `docs/ARCHITECTURE.md` §3 routes
 * *"Annotations (all types), appearance streams"* to MuPDF, and MuPDF is behind
 * a pipe whose frame limit is 256 KiB against `MAX_IMAGE_BYTES` at 64 MiB.
 *
 * A third route exists and has a shipped precedent: `insertImagePage` declares
 * `writer: 'pdf-lib'` and carries the 64 MiB bound today, because a byte-image
 * writer runs in main and its input never crosses the pipe
 * ([ADR-0039](../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)).
 * Routing THIS write the same way is an amendment to one matrix row, not a new
 * protocol — and it is only worth proposing if four things are true. This
 * script measures all four and prints readings, never a verdict.
 *
 *   1. **pdf-lib can write it.** A `/Stamp` whose `/AP` `/N` is a form XObject
 *      drawing an embedded image.
 *   2. **MuPDF sees it.** Read back with the OTHER library, because pdf-lib
 *      reporting that pdf-lib wrote something is one library agreeing with
 *      itself — and because MuPDF's annotation walk is known to FILTER: it
 *      answered `[Text, Square]` for a page whose `/Annots` held three
 *      ([ADR-0041](../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)).
 *      An annotation the walk drops is one `placeAnnotation` cannot name.
 *   3. **MuPDF can MUTATE it without destroying it.** This is the load-bearing
 *      one and it is the reason the row's claim that *move, resize and delete
 *      already exist* is not free. `setRect` may regenerate the appearance
 *      stream for a subtype MuPDF has a synthesiser for, and a regenerated
 *      `/AP` that no longer names the image is a stamp that moves and turns
 *      blank — an effect no assertion about the rect would see.
 *   4. **The private mark survives.** [ADR-0043](../../docs/DECISIONS/0043-an-annotation-this-build-wrote-carries-a-private-mark.md)
 *      is what `srcRef` means here; an annotation this build wrote and cannot
 *      recognise afterwards is a worse outcome than not writing it.
 *
 * Run:
 *
 *   node scripts/research/pdfLibStampAnnotation.mjs
 *
 * ## Its own positive control, and why this one needs two
 *
 * Every reading here is a search over a document, and every failure mode of a
 * search prints the same "found nothing". Two controls, because there are two
 * ways to be blind and they are not the same:
 *
 *   - a document with **no annotation at all** must read back as none. That
 *     separates *the walk works* from *the walk says yes to everything*.
 *   - a `/Stamp` carrying **no mark** must read back as foreign. The mark
 *     reader's reassuring answer is `true`, so the control is on `false`, and
 *     without it a reader that returns `true` unconditionally passes reading 4.
 *
 * The script refuses to report if either control comes back the wrong way.
 */
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';
import { readFileSync, statSync } from 'node:fs';

/** The key [ADR-0043](../../docs/DECISIONS/0043-an-annotation-this-build-wrote-carries-a-private-mark.md) writes. */
const AUTHORED_KEY = 'Monstera_Authored';

/**
 * The image's pixel dimensions, deliberately not square and not a round
 * number: `/Width 7 /Height 3` is a value only the right XObject produces,
 * where `1 1` would be produced by half the wrong ones too.
 */
const IMAGE_WIDTH = 7;
const IMAGE_HEIGHT = 3;

/**
 * Where the stamp is placed, and where reading 3 moves it to.
 *
 * Tuples rather than arrays because MuPDF's `setRect` takes a four-element
 * `Rect`, and an array whose length the compiler cannot see is exactly the
 * argument it refuses.
 *
 * @type {[number, number, number, number]}
 */
const PLACED_RECT = [40, 60, 140, 110];
/** @type {[number, number, number, number]} */
const MOVED_RECT = [200, 300, 300, 350];

/**
 * A small PNG, built by MuPDF rather than by hand.
 *
 * Bytes assembled numerically would be the safe way to write one; asking a
 * library that already encodes PNGs is better still, and this one is in the
 * dependency tree because `pageSnapshot.ts` uses exactly this call.
 *
 * @returns {Uint8Array}
 */
function stampPng() {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, IMAGE_WIDTH, IMAGE_HEIGHT], false);
  pixmap.clear(200);
  return pixmap.asPNG();
}

/**
 * A two-page document carrying one `/Stamp` whose appearance draws an image.
 *
 * @param {boolean} marked whether to write the private mark
 * @returns {Promise<Uint8Array>}
 */
async function documentWithImageStamp(marked) {
  const document = await PDFDocument.create();
  document.addPage([400, 500]);
  document.addPage([400, 500]);

  const image = await document.embedPng(stampPng());
  const context = document.context;

  const width = PLACED_RECT[2] - PLACED_RECT[0];
  const height = PLACED_RECT[3] - PLACED_RECT[1];

  // The appearance is a form XObject in the annotation's own space: BBox at the
  // origin, the image scaled to fill it by the `cm` matrix. `/Im0 Do` is the
  // whole content stream, so anything that reaches the image reaches it through
  // `/Resources /XObject`, which is what reading 3 looks at afterwards.
  const appearance = context.stream(
    'q ' + width + ' 0 0 ' + height + ' 0 0 cm /Im0 Do Q',
    {
      Type: PDFName.of('XObject'),
      Subtype: PDFName.of('Form'),
      FormType: 1,
      BBox: context.obj([0, 0, width, height]),
      Resources: context.obj({ XObject: context.obj({ Im0: image.ref }) }),
    },
  );

  const dictionary = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Stamp'),
    Rect: context.obj([PLACED_RECT[0], PLACED_RECT[1], PLACED_RECT[2], PLACED_RECT[3]]),
    F: 4,
    AP: context.obj({ N: context.register(appearance) }),
  });
  // AFTER the literal rather than in it, because the control's whole subject is
  // a document where this key is absent — and an object literal with a
  // conditional value in it can spell that as `false`, which is a different
  // document and the one the mark reader is required to call foreign anyway.
  if (marked) dictionary.set(PDFName.of(AUTHORED_KEY), context.obj(true));

  document.getPage(0).node.addAnnot(context.register(dictionary));

  // `updateMetadata` is a LOAD option and this document was created rather than
  // loaded, so there is nothing to pass here; the reproducibility question
  // belongs to `pdfLibRoundTrip.mjs` and is not re-asked.
  return document.save();
}

/** A document with no annotation at all — control one's subject. @returns {Promise<Uint8Array>} */
async function bareDocument() {
  const document = await PDFDocument.create();
  document.addPage([400, 500]);
  return document.save();
}

/**
 * Opens with MuPDF and hands the document to `read`, always destroying it.
 *
 * @template T
 * @param {Uint8Array} bytes
 * @param {(document: mupdf.PDFDocument) => T} read
 * @returns {T}
 */
function withMupdf(bytes, read) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the fixture is not a PDF');
  try {
    return read(document);
  } finally {
    document.destroy();
  }
}

/**
 * What MuPDF's own annotation walk says about page 0.
 *
 * The appearance is read the way a renderer would reach the image — down
 * `/AP` `/N` `/Resources` `/XObject` — rather than by asking whether the
 * document still contains an image somewhere, which a detached XObject would
 * also satisfy.
 *
 * @param {Uint8Array} bytes
 * @returns {{ type: string, rect: number[], authored: boolean, images: string[] }[]}
 */
function stampsOnFirstPage(bytes) {
  return withMupdf(bytes, (document) => {
    const page = document.loadPage(0);
    return page.getAnnotations().map((annotation) => {
      const object = annotation.getObject();
      const mark = object.get(AUTHORED_KEY);
      /** @type {string[]} */
      const images = [];
      const resources = object.get('AP').get('N').get('Resources').get('XObject');
      if (resources.isDictionary()) {
        resources.forEach((value) => {
          const subtype = value.get('Subtype');
          if (!subtype.isNull() && subtype.asName() === 'Image') {
            images.push(value.get('Width').asNumber() + 'x' + value.get('Height').asNumber());
          }
        });
      }
      return {
        type: annotation.getType(),
        rect: annotation.getRect(),
        authored: mark.isBoolean() && mark.asBoolean(),
        images,
      };
    });
  });
}

/**
 * Moves page 0's first annotation with MuPDF and saves.
 *
 * The copy out of `asUint8Array()` is not decoration: finding BBBB-1 measured
 * that call returning a view onto the wasm heap, which the next allocation may
 * move.
 *
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
function movedWithMupdf(bytes) {
  return withMupdf(bytes, (document) => {
    const annotation = document.loadPage(0).getAnnotations()[0];
    if (annotation === undefined) throw new Error('nothing to move — reading 2 already failed');
    annotation.setRect(MOVED_RECT);
    return new Uint8Array(document.saveToBuffer('').asUint8Array());
  });
}

/**
 * Deletes page 0's first annotation with MuPDF and saves.
 *
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
function deletedWithMupdf(bytes) {
  return withMupdf(bytes, (document) => {
    const page = document.loadPage(0);
    const annotation = page.getAnnotations()[0];
    if (annotation === undefined) throw new Error('nothing to delete — reading 2 already failed');
    page.deleteAnnotation(annotation);
    return new Uint8Array(document.saveToBuffer('').asUint8Array());
  });
}

/**
 * Seconds a pdf-lib load-and-save costs for a file on disk.
 *
 * This is the cost the amendment would put behind a GESTURE. Every byte-image
 * command already pays it, and every one of them is a document-level operation
 * a user invokes once; placing a stamp is not, so the number is the argument
 * rather than an aside.
 *
 * **Load and save are timed apart, and the object count is read**, because the
 * first run of this reading produced 236.66s for a 25 MB file and 1.08s for a
 * 199 MB one. A cost that inverts against size is a cost keyed on something
 * else, and reporting one number for it would have been a figure with the wrong
 * independent variable written under it.
 *
 * @param {string} path
 * @returns {Promise<{ megabytes: number, objects: number, load: number, save: number } | undefined>}
 */
async function roundTripCost(path) {
  /** @type {Uint8Array} */
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    return undefined;
  }
  const megabytes = Number((statSync(path).size / (1024 * 1024)).toFixed(1));
  const opened = process.hrtime.bigint();
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const parsed = process.hrtime.bigint();
  await document.save();
  const written = process.hrtime.bigint();
  return {
    megabytes,
    objects: document.context.enumerateIndirectObjects().length,
    load: Number((Number(parsed - opened) / 1e9).toFixed(2)),
    save: Number((Number(written - parsed) / 1e9).toFixed(2)),
  };
}

/**
 * What happens to a command's image field on the engine host's actual wire.
 *
 * `client.ts:176` frames `JSON.stringify({ id, channel, params })` and
 * `runtime.ts:357` parses the other end, so the transport is JSON and not a
 * structured clone. The row's finding recorded the block as a SIZE — 256 KiB
 * against 64 MiB — and size is the second reason if this reading says what it
 * looks like it will say.
 *
 * Two numbers, because they answer different questions: whether the value is
 * still the type the schema demands, and what the encoding costs.
 *
 * @returns {{ survivesAsBytes: boolean, inflation: number }}
 */
function imageOnTheWire() {
  const image = stampPng();
  const encoded = JSON.stringify({ id: 'x', channel: 'engine/apply', params: { image } });
  const image2 = JSON.parse(encoded).params.image;
  return {
    survivesAsBytes: image2 instanceof Uint8Array,
    inflation: Number((new TextEncoder().encode(encoded).byteLength / image.byteLength).toFixed(1)),
  };
}

async function main() {
  const marked = await documentWithImageStamp(true);

  // CONTROL ONE, before any reading is believed: a document with no annotation
  // must read back as none.
  const empty = stampsOnFirstPage(await bareDocument());
  if (empty.length !== 0) {
    throw new Error('CONTROL FAILED: the walk found ' + empty.length + ' annotations on a page with none');
  }

  // CONTROL TWO: an unmarked stamp must read back as foreign. The reassuring
  // answer for reading 4 is `true`, so this is the direction that separates.
  const foreign = stampsOnFirstPage(await documentWithImageStamp(false));
  const unmarked = foreign[0];
  if (foreign.length !== 1 || unmarked === undefined || unmarked.authored) {
    throw new Error('CONTROL FAILED: an unmarked stamp read back as this build authored it');
  }

  console.log('1. pdf-lib wrote it:', marked.byteLength, 'bytes');
  console.log('2. MuPDF walk, as written: ', JSON.stringify(stampsOnFirstPage(marked)));
  console.log('3. MuPDF walk, after setRect: ', JSON.stringify(stampsOnFirstPage(movedWithMupdf(marked))));
  console.log('4. MuPDF walk, after delete:  ', JSON.stringify(stampsOnFirstPage(deletedWithMupdf(marked))));
  console.log('   controls: bare page = 0 annotations; unmarked stamp = foreign');

  console.log('6. the image on the host wire (JSON): ', JSON.stringify(imageOnTheWire()));

  for (const path of [
    'packages/testing/fixtures/generated/perf-baseline.pdf',
    'packages/testing/fixtures/generated/perf-dense-127k.pdf',
    'packages/testing/fixtures/generated/perf-image-200mb.pdf',
  ]) {
    const cost = await roundTripCost(path);
    console.log('5. pdf-lib load+save', path, cost === undefined ? 'ABSENT' : JSON.stringify(cost));
  }
}

await main();
