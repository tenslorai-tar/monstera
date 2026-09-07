// @ts-check
/**
 * What a pdf-lib write costs on an object-dense document when it is saved
 * INCREMENTALLY rather than serialised whole.
 *
 * ## The premise this exists to test
 *
 * [ADR-0044](../../docs/DECISIONS/0044-an-image-reaches-the-engine-the-way-the-document-does.md)
 * rejected a pdf-lib route on cost, and `scripts/perf/byteImageCost.mjs`
 * measured that cost across all six shipped byte-image rows: **225–320
 * seconds** each on `perf-dense-127k.pdf` (25.1 MB, 127,082 objects). Every one
 * of those readings is `PDFDocument.load` followed by `PDFDocument.save`.
 *
 * The word *incremental* appears in neither ADR-0044 nor ADR-0039. So the
 * route was costed on the only save this project had ever called, and
 * `@cantoo/pdf-lib` 2.8.3 declares a second one — `saveIncremental(snapshot)`,
 * whose own documentation says the result *"will contain only the
 * differences"*. That is the authority already doing the hard part, and
 * measuring it is cheaper than designing around its absence.
 *
 * **It can only attack one half of the figure.** A load still parses the whole
 * file, so the floor here is the parse — what is under test is whether the
 * SERIALISE, which is the larger half, comes down with it.
 *
 * ## `saveIncremental` IS NOT THE CALLABLE ONE, and that is measured
 *
 * Its buffer is the **appendix alone** — `PDFWriter.serializeToBuffer` skips the
 * header when a snapshot is present, so the bytes begin at an object rather
 * than at `%PDF`. Handing that back as a document produces a file MuPDF opens
 * with *"cannot find version marker"*, repairs, and reports as having no page
 * 1. Read on the 199 MB fixture before any dense reading was taken, which is
 * the only reason the number below is not a spectacular saving.
 *
 * `commit()` is the one a command can call: it concatenates the original bytes
 * with that appendix and answers a whole document. So the API the docstring
 * advertises is a piece of the operation, not the operation — and a route that
 * returned it would be the fastest and most broken result this script can
 * produce, which is precisely why every row is opened by a different library.
 *
 * ## The two axes, and why both are needed
 *
 * | axis | values | why |
 * |---|---|---|
 * | route | `full` · `incremental` | the question |
 * | mutation | `none` · `createField` · `drawAll` | the SIZE of the change set |
 *
 * An incremental save writes the objects that changed, so a one-field write and
 * a watermark on forty pages are not the same question wearing two names —
 * `createField` is the shape *Form fields: create* would have, and `drawAll` is
 * the shape the six shipped rows have. If only the first comes down, the
 * finding unblocks one row and leaves six paying.
 *
 * `none` is neither: it is the **calibration row**. A snapshot taken and
 * nothing changed is the smallest change set expressible, so it prints the
 * floor of each route — and if `full/none` and `incremental/none` print the
 * same number, this script is not measuring the thing it names.
 *
 * ## What it does NOT decide
 *
 * Nothing about routing. Two things stand between a good number here and a
 * design, and both are stated in the output rather than left to whoever reads
 * the figure:
 *
 *   1. `takeSnapshot()` needs `originalBytes`, which the parser retains only
 *      under `forIncrementalUpdate: true` — a **load** option, so
 *      `openForWriting` would have to grow a second shape. Measured here as its
 *      own column, because a cheaper save behind a dearer load is not a saving.
 *   2. An incremental save **appends**. The file grows, and
 *      [ADR-0008](../../docs/DECISIONS/0008-save-modes.md) rule 1 already says
 *      which operations may never take that route. Output size is a column for
 *      that reason.
 *
 * Run:
 *
 *   node scripts/research/incrementalSaveCost.mjs
 *   node scripts/research/incrementalSaveCost.mjs --shape=image   # seconds
 *
 * It prints readings, never a verdict.
 *
 * ## Its own positive controls, and why a timing needs them
 *
 * The reassuring answer here is **fast**, and the fastest possible run is one
 * where every save failed and handed back its input. So:
 *
 *   - Every row is observed with **MuPDF**, not with the library that wrote it.
 *     pdf-lib agreeing with itself about bytes it just produced says nothing
 *     about whether the shipped engine can read an appended file at all, which
 *     is the question a route change would turn on.
 *   - The observer is resolution-tested **before any figure is taken**, in both
 *     directions: it must see the probe in a document that has it and NOT see
 *     it in one that does not. A watcher that reports `true` for everything
 *     certifies every row, and a watcher that reports `false` for everything
 *     fails every row into the same column.
 *   - The `none` row must observe **no** effect. It is the row where the
 *     absence of the operation is the correct answer, so it is the row that
 *     separates a working observer from a stuck one.
 */
import { readFile } from 'node:fs/promises';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

import { buildDenseFixture, buildLargeFixture } from '../perf/largeFixture.mjs';

/**
 * The string `drawAll` paints and the observer looks for.
 *
 * Long and unmistakable on purpose: the observer reads the page's extracted
 * text, and a short token could occur in a fixture's own content by accident,
 * which would make the control pass for a reason that has nothing to do with
 * the write under test.
 */
const PROBE = 'MONSTERA-INCREMENTAL-PROBE';

/**
 * What a document says about itself, read by the engine that ships.
 *
 * Three readings rather than one, because the mutations differ in *which*
 * observable they move: `createField` adds a widget and draws no text,
 * `drawAll` draws text and adds no widget. A single observable would have to be
 * satisfied by both, and the row that moved neither would then look identical
 * to the two that moved one each.
 *
 * @param {Uint8Array} bytes
 * @returns {{ pages: number, widgets: number, drawn: boolean }}
 */
function observe(bytes) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the output is not a PDF');
  const page = document.loadPage(0);
  return {
    pages: document.countPages(),
    widgets: page.getWidgets().length,
    drawn: page.toStructuredText().asText().includes(PROBE),
  };
}

/**
 * A small document carrying both observables, for the control.
 *
 * @param {boolean} marked whether it gets the probe text and a field
 * @returns {Promise<Uint8Array>}
 */
async function controlDocument(marked) {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 300]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  if (marked) {
    page.drawText(PROBE, { x: 20, y: 40, size: 12, font });
    const field = document.getForm().createTextField('control.probe');
    field.setText('X');
    field.addToPage(page, { x: 20, y: 200, width: 200, height: 20, font });
  }
  // `updateMetadata` is a LOAD option and this document was created rather than
  // loaded, so there is nothing to pin here. It reaches no timing: this is the
  // observer's control subject, not a fixture any route is measured against.
  return document.save();
}

/**
 * The three change sets, smallest first.
 *
 * Each returns nothing and mutates the document it is handed, so the timing
 * below can bracket the mutation separately from the save — without which a
 * route that moved work out of `save` and into `drawText` would read as a
 * saving.
 *
 * @type {Array<{ name: string, mutate: (document: PDFDocument) => Promise<void>, expect: (before: ReturnType<typeof observe>, after: ReturnType<typeof observe>) => string | null }>}
 */
const MUTATIONS = [
  {
    name: 'none',
    mutate: async () => {
      // DELIBERATELY NOTHING. This row's cost is the floor of each route — a
      // load and a save with no change between them — and it is what makes the
      // two routes distinguishable at all.
      await Promise.resolve();
    },
    // THE CALIBRATION ROW. Its correct answer is that nothing moved, so it is
    // the one row where a stuck-on observer is visible.
    expect: (before, after) =>
      after.widgets === before.widgets && after.drawn === before.drawn && !after.drawn
        ? null
        : `the no-op row moved an observable: ${JSON.stringify({ before, after })}`,
  },
  {
    name: 'createField',
    mutate: async (document) => {
      const font = await document.embedFont(StandardFonts.Helvetica);
      const form = document.getForm();
      const field = form.createTextField('probe.incremental');
      field.setText('X');
      field.addToPage(document.getPage(0), { x: 20, y: 20, width: 160, height: 18, font });
      // EXPLICITLY, in both routes. `saveIncremental` forces
      // `updateFieldAppearances: false` on its way past, so leaving this to the
      // save would make the two routes do different amounts of work and the
      // comparison would be between a save and a save-plus-appearances.
      form.updateFieldAppearances(font);
    },
    expect: (before, after) =>
      after.widgets === before.widgets + 1
        ? null
        : `expected one more widget on page 1 than the ${String(before.widgets)} it started with, read ${String(after.widgets)}`,
  },
  {
    name: 'drawAll',
    mutate: async (document) => {
      const font = await document.embedFont(StandardFonts.Helvetica);
      for (const page of document.getPages()) {
        page.drawText(PROBE, { x: 20, y: 20, size: 10, font });
      }
    },
    expect: (_before, after) => (after.drawn ? null : 'the probe text is not in the page'),
  },
];

/**
 * One reading: load, mutate, save, and what the result says about itself.
 *
 * The phases are timed separately because the finding lives in their ratio.
 * ADR-0044's 197s is a load plus a save, and only the save is what
 * `saveIncremental` can touch — a total that came down would not say which half
 * moved, and the half that cannot move is the floor of any route change.
 *
 * @param {'full' | 'incremental'} route
 * @param {(typeof MUTATIONS)[number]} mutation
 * @param {Uint8Array} image
 * @param {ReturnType<typeof observe>} before
 */
async function reading(route, mutation, image, before) {
  const incremental = route === 'incremental';
  const openedAt = process.hrtime.bigint();
  const document = await PDFDocument.load(image, {
    updateMetadata: false,
    // THE LOAD IS PART OF THE ROUTE. `takeSnapshot` reads `originalBytes`, and
    // the parser keeps them only under this flag — so an incremental route
    // cannot be had without whatever this costs.
    forIncrementalUpdate: incremental,
  });
  const loadedAt = process.hrtime.bigint();
  await mutation.mutate(document);
  const mutatedAt = process.hrtime.bigint();
  // `commit()`, NOT `saveIncremental()`. The second answers the appendix alone
  // and the first concatenates it onto the original bytes — see the header. The
  // load already took the snapshot, which is what `forIncrementalUpdate` does.
  const answer = incremental
    ? await document.commit()
    : await document.save({ updateFieldAppearances: false });
  const savedAt = process.hrtime.bigint();

  /** @param {bigint} from @param {bigint} to */
  const seconds = (from, to) => Number((Number(to - from) / 1e9).toFixed(2));
  const after = observe(answer);
  return {
    route,
    mutation: mutation.name,
    load: seconds(openedAt, loadedAt),
    mutate: seconds(loadedAt, mutatedAt),
    save: seconds(mutatedAt, savedAt),
    total: seconds(openedAt, savedAt),
    bytes: answer.byteLength,
    // THE CONTROL, per row rather than once. A save that threw is caught by the
    // caller; a save that quietly did nothing is not, and it is the fastest
    // reading this script can produce.
    effect: mutation.expect(before, after),
    readable: after.pages === before.pages ? null : `page count moved ${String(before.pages)} → ${String(after.pages)}`,
  };
}

async function main() {
  // THE OBSERVER IS RESOLUTION-TESTED FIRST, in both directions, because every
  // figure below is only worth what its control is worth. A watcher that
  // answers the same thing for both documents certifies nothing, and the
  // failure is silent in the direction that reads as success.
  const marked = observe(await controlDocument(true));
  const plain = observe(await controlDocument(false));
  if (!marked.drawn || marked.widgets !== 1) {
    throw new Error(
      `CONTROL FAILED: the observer cannot see a document that HAS the probe: ${JSON.stringify(marked)}`,
    );
  }
  if (plain.drawn || plain.widgets !== 0) {
    throw new Error(
      `CONTROL FAILED: the observer reports the probe in a document without one: ${JSON.stringify(plain)}`,
    );
  }
  console.log(
    'control: the observer separates a marked document from a plain one',
    JSON.stringify({ marked, plain }),
  );

  const only = process.argv.find((argument) => argument.startsWith('--shape='))?.slice(8);
  if (only !== undefined && only !== 'image' && only !== 'dense') {
    throw new Error(`--shape must be "image" or "dense"; got ${JSON.stringify(only)}`);
  }
  const path = only === 'image' ? buildLargeFixture({}).path : buildDenseFixture({}).path;
  const image = new Uint8Array(await readFile(path));
  const before = observe(image);
  console.log(
    `\nfixture ${path}`,
    JSON.stringify({ megabytes: Number((image.byteLength / 1024 ** 2).toFixed(1)), ...before }),
  );

  console.log(
    `\n${'route'.padEnd(12)}${'mutation'.padEnd(14)}${'load'.padStart(8)}${'mutate'.padStart(9)}${'save'.padStart(9)}${'total'.padStart(9)}${'MB out'.padStart(10)}  effect`,
  );
  for (const mutation of MUTATIONS) {
    for (const route of /** @type {const} */ (['full', 'incremental'])) {
      // SEQUENTIAL, and nothing else runs beside it. Two of these in flight
      // would share a CPU and neither reading would be the cost of one.
      const row = await reading(route, mutation, image, before);
      const problem = row.effect ?? row.readable;
      console.log(
        route.padEnd(12) +
          mutation.name.padEnd(14) +
          `${String(row.load)}s`.padStart(8) +
          `${String(row.mutate)}s`.padStart(9) +
          `${String(row.save)}s`.padStart(9) +
          `${String(row.total)}s`.padStart(9) +
          (row.bytes / 1024 ** 2).toFixed(1).padStart(10) +
          (problem === null ? '  ok' : `  ${problem}`),
      );
    }
  }
}

await main();
