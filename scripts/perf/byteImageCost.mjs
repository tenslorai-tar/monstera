// @ts-check
/**
 * What the six byte-image commands cost on a document with many objects.
 *
 * ## The finding this exists to size
 *
 * [ADR-0044](../../docs/DECISIONS/0044-an-image-reaches-the-engine-the-way-the-document-does.md)
 * rejected a pdf-lib route for `placeImage` on cost, and the readings it took
 * are a fact about **every** command already routed to that writer:
 *
 * | fixture | megabytes | objects | pdf-lib load + save |
 * |---|---|---|---|
 * | `perf-dense-127k.pdf` | 25.1 | 127,082 | **197.3s** and **224.8s** |
 * | `perf-image-200mb.pdf` | 199.4 | 122 | 0.57s and 0.64s |
 *
 * Cost tracks **object count**, not bytes. The comparison that says the figure
 * is wrong rather than merely large is already in the record: ADR-0010 measured
 * MuPDF incremental-saving a 464 MB, 2,038,522-object document in **4.5
 * seconds**. So the structural writer does at 2M objects in 4.5s what the
 * byte-image writer takes 197s to do at 127k.
 *
 * Six shipped rows pay it — watermark, headers and footers, Bates numbering,
 * page background, insert from image, generate TOC — and the memory gate could
 * never have shown it: `budgetGate.mjs` measures **peak RSS**, and both of its
 * fixtures were chosen for memory shapes rather than for the axis this costs on.
 *
 * ## What this instrument does, and what it deliberately does not
 *
 * It measures, and it holds a **regression** bound — not a budget. The
 * difference is the whole of its scope: *nothing here may get quietly worse* is
 * a fact-keeper, and *these rows may not cost this much* is a design decision
 * that belongs in an ADR. Whether the six can leave the byte-image path at all,
 * given ADR-0039 exists because MuPDF's writer cannot draw what they draw, is
 * not decided here and is not decidable from a timing.
 *
 * ## It is HAND-RUN, and that is stated rather than papered over
 *
 * One run is roughly twenty-five minutes, which is not a pre-commit check and
 * not a per-push CI job — MuPDF's own cold build, the most expensive step this
 * project has, is 336s. So no mechanism runs this on a schedule today. What
 * exists instead is the derived-set refusal below: a seventh command routed to
 * `pdf-lib` makes this script refuse to report rather than quietly measuring
 * six of seven. The trigger for re-running it is a change to the byte-image
 * path, and that trigger is written into `docs/JOURNAL.md`'s entry of
 * 2026-09-07 rather than left to be recalled.
 *
 * Run:
 *
 *   npm run perf:byteimage
 *   node scripts/perf/byteImageCost.mjs --json
 *   node scripts/perf/byteImageCost.mjs --shape=image   # ten seconds, no verdict
 *
 * `--shape=image` exists so the reporting path can be exercised without paying
 * the full cost, and it **fails deliberately**: the bound is the dense shape's,
 * so a run that skipped it seals *not measured* rather than printing the same
 * `ok` a passing full run prints. That is the one way this verdict could lie,
 * and it is a case rather than a comment.
 *
 * The dense fixture is generated on demand and takes a minute or two the first
 * time; the whole run is minutes, not seconds, which is the finding rather than
 * a defect in the harness. **The verdict is the last line it prints**, for
 * `npm run local`'s reason: a piped run discards the exit code, and the common
 * wrong action should produce the right answer rather than a wrong one.
 *
 * ## Its own control, and why a timing needs one at all
 *
 * The reassuring answer here is **fast**, and an apply that failed and returned
 * its input unchanged is the fastest of all. So every measurement is paired
 * with a check that the document actually MOVED — the answer's byte length
 * differs from the input's — and a command whose apply left the bytes alone is
 * reported as `unchanged` rather than as a cheap one. Without it a run in which
 * every command threw would print the most reassuring table this script can
 * produce.
 */

import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import {
  applyBatesNumberPages,
  applyGenerateToc,
  applyHeaderFooterPages,
  applyInsertImagePage,
  applySetPageBackground,
  applyWatermarkPages,
  declaredCommands,
} from '@monstera/kernel';
import { PDFDocument } from '@cantoo/pdf-lib';

import { buildDenseFixture, buildLargeFixture } from './largeFixture.mjs';

/**
 * The regression bound, in seconds, per command on the object-dense fixture.
 *
 * **480, and the margin is chosen from a measured spread rather than picked.**
 * Two runs on 2026-09-07, this machine, `node scripts/perf/byteImageCost.mjs`:
 *
 * | command | run 1 | run 2 |
 * |---|---|---|
 * | `watermarkPages` | 240.30s | 246.94s |
 * | `headerFooterPages` | 225.19s | 255.82s |
 * | `batesNumberPages` | **309.88s** | **320.19s** |
 * | `setPageBackground` | 276.23s | 264.53s |
 * | `insertImagePage` | 263.51s | 247.00s |
 * | `generateToc` | 260.42s | 231.34s |
 *
 * The worst reading is 320.19s and the largest run-to-run difference within one
 * command is 13.6% (`headerFooterPages`). So this sits 1.5x above the worst
 * observation against a spread of about a seventh — a bound no correct
 * measurement should cross, which is what makes crossing it a finding rather
 * than a bad afternoon. A doubling is still caught.
 *
 * **It is deliberately NOT set from the mean**, and not from the best reading:
 * a bound derived from the good end is the error this project has already paid
 * for twice on a timing, in both directions.
 */
const REGRESSION_LIMIT_SECONDS = 480;

/**
 * A one-pixel PNG, built numerically.
 *
 * Numeric bytes rather than a base64 string, for the standing rule's one safe
 * exception: nothing in this path resolves an escape. It is the smallest input
 * `insertImagePage` accepts, so what its row measures is the DOCUMENT's cost
 * rather than the image's.
 */
const PIXEL_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

/**
 * The outline `generateToc` is handed, since it declares `reads: 'outline'`.
 *
 * Three entries rather than none: an empty outline is a table of contents with
 * nothing in it, and a command that drew nothing would be timing an empty page.
 */
const OUTLINE = [
  { title: 'First', page: 0, depth: 0 },
  { title: 'Second', page: 1, depth: 0 },
  { title: 'Third', page: 2, depth: 1 },
];

/**
 * One row per command, with a payload that makes it do its work.
 *
 * `pages: 'all'` throughout, which is the shape a person reaches for and the
 * one the cost question is about — a watermark on page 3 of a 40-page document
 * still loads and saves the whole file, so the per-page work is not what these
 * numbers are measuring.
 *
 * @type {Array<{ kind: string, run: (image: Uint8Array) => Promise<Uint8Array> }>}
 */
const COMMANDS = [
  {
    kind: 'watermarkPages',
    run: (image) =>
      applyWatermarkPages(image, {
        kind: 'watermarkPages',
        pages: 'all',
        text: 'DRAFT',
        opacity: 0.3,
        rotationDegrees: 45,
        fontSize: 48,
      }),
  },
  {
    kind: 'headerFooterPages',
    run: (image) =>
      applyHeaderFooterPages(image, {
        kind: 'headerFooterPages',
        pages: 'all',
        header: { left: 'Left', centre: 'Centre', right: 'Right' },
        footer: { left: '', centre: 'Page {n} of {total}', right: '' },
        fontSize: 10,
        marginPoints: 24,
      }),
  },
  {
    kind: 'batesNumberPages',
    run: (image) =>
      applyBatesNumberPages(image, {
        kind: 'batesNumberPages',
        pages: 'all',
        prefix: 'MON',
        suffix: '',
        start: 1,
        digits: 6,
        edge: 'footer',
        slot: 'right',
        fontSize: 10,
        marginPoints: 24,
      }),
  },
  {
    kind: 'setPageBackground',
    run: (image) =>
      applySetPageBackground(image, {
        kind: 'setPageBackground',
        pages: 'all',
        red: 0.9,
        green: 0.95,
        blue: 1,
      }),
  },
  {
    kind: 'insertImagePage',
    run: (image) =>
      applyInsertImagePage(image, {
        kind: 'insertImagePage',
        at: 0,
        bytes: PIXEL_PNG,
        mediaType: 'image/png',
      }),
  },
  {
    kind: 'generateToc',
    run: (image) => applyGenerateToc(image, { kind: 'generateToc', at: 0 }, OUTLINE),
  },
];

/**
 * What a fixture is, on the axis the cost tracks.
 *
 * The object count is read with pdf-lib rather than estimated from the size,
 * because that is the whole point: two fixtures of 25 MB and 199 MB differ by
 * three orders of magnitude in objects and by 350x in cost, in opposite
 * directions.
 *
 * @param {string} path
 * @returns {Promise<{ megabytes: number, objects: number, parse: number }>}
 */
async function shapeOf(path) {
  const bytes = new Uint8Array(await readFile(path));
  const opened = process.hrtime.bigint();
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const parsed = process.hrtime.bigint();
  return {
    megabytes: Number((statSync(path).size / 1024 ** 2).toFixed(1)),
    objects: document.context.enumerateIndirectObjects().length,
    parse: Number((Number(parsed - opened) / 1e9).toFixed(2)),
  };
}

/**
 * Seconds one command costs against one document, and whether it did anything.
 *
 * @param {{ kind: string, run: (image: Uint8Array) => Promise<Uint8Array> }} command
 * @param {Uint8Array} image
 * @returns {Promise<{ kind: string, seconds: number | null, changed: boolean, refused: string | null }>}
 */
async function cost(command, image) {
  const started = process.hrtime.bigint();
  try {
    const answer = await command.run(image);
    const finished = process.hrtime.bigint();
    return {
      kind: command.kind,
      seconds: Number((Number(finished - started) / 1e9).toFixed(2)),
      // THE CONTROL, per measurement rather than once: a refusal and a no-op
      // are both fast, and only one of them throws.
      changed: answer.byteLength !== image.byteLength,
      refused: null,
    };
  } catch (error) {
    return {
      kind: command.kind,
      seconds: null,
      changed: false,
      refused: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Every command against one fixture, in order.
 *
 * ONE FRESH COPY OF THE INPUT PER COMMAND is not needed — these applies take
 * the bytes and return new ones without mutating what they were given — but the
 * INPUT is re-read per shape rather than shared across shapes, so a run cannot
 * accidentally measure the second fixture against the first's parse cache.
 *
 * @param {string} path
 * @returns {Promise<{ path: string, shape: Awaited<ReturnType<typeof shapeOf>>, rows: Awaited<ReturnType<typeof cost>>[] }>}
 */
async function against(path) {
  const shape = await shapeOf(path);
  const image = new Uint8Array(await readFile(path));
  /** @type {Awaited<ReturnType<typeof cost>>[]} */
  const rows = [];
  // SEQUENTIAL ON PURPOSE. Two applies in flight would share a CPU and neither
  // reading would be the cost of one — which is this project's own recorded
  // lesson about running a long measurement beside anything else.
  for (const command of COMMANDS) {
    rows.push(await cost(command, image));
  }
  return { path, shape, rows };
}

async function main() {
  // THE SET IS DERIVED, so a seventh command routed to this writer arrives here
  // with no row and the run says so rather than quietly measuring six of seven.
  const routed = Object.values(declaredCommands)
    .filter((declaration) => declaration.writer === 'pdf-lib')
    .map((declaration) => declaration.kind)
    .sort();
  const measured = COMMANDS.map((command) => command.kind).sort();
  if (JSON.stringify(routed) !== JSON.stringify(measured)) {
    throw new Error(
      `this script measures ${JSON.stringify(measured)} and the declaration table routes ` +
        `${JSON.stringify(routed)} to pdf-lib. A command added to that writer needs a row here, ` +
        'or these figures describe a set nobody chose.',
    );
  }

  // WHICH SHAPES TO RUN, and the flag exists so the reporting path below can be
  // exercised in ten seconds instead of twenty-five minutes. The image-heavy
  // shape is the cheap one; a verdict nobody can run without paying the full
  // cost is a verdict nobody checks until the day it matters.
  const only = process.argv.find((argument) => argument.startsWith('--shape='))?.slice(8);
  if (only !== undefined && only !== 'image' && only !== 'dense') {
    throw new Error(`--shape must be "image" or "dense"; got ${JSON.stringify(only)}`);
  }

  /** @type {Array<{ shape: string, run: Awaited<ReturnType<typeof against>> }>} */
  const runs = [];
  if (only !== 'dense') {
    runs.push({ shape: 'image-heavy', run: await against(buildLargeFixture({}).path) });
  }
  if (only !== 'image') {
    runs.push({ shape: 'object-dense', run: await against(buildDenseFixture({}).path) });
  }

  // THE CONTROL, before any figure is believed: if nothing changed a document,
  // every second printed below is the cost of failing.
  const moved = runs.flatMap((entry) => entry.run.rows).filter((row) => row.changed);
  if (moved.length === 0) {
    throw new Error(
      'CONTROL FAILED: no command changed the document it was given, so every timing here is ' +
        'the cost of a refusal rather than of the work.',
    );
  }

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
    return;
  }

  for (const { shape, run } of runs) {
    console.log(
      `\n${shape}  ${run.path}`,
      JSON.stringify({
        megabytes: run.shape.megabytes,
        objects: run.shape.objects,
        parseSeconds: run.shape.parse,
      }),
    );
    for (const row of run.rows) {
      console.log(
        '   ',
        row.kind.padEnd(20),
        row.refused !== null
          ? `REFUSED: ${row.refused}`
          : `${String(row.seconds)}s${row.changed ? '' : '  (UNCHANGED — this is the cost of doing nothing)'}`,
      );
    }
  }

  // THE VERDICT IS THE LAST LINE, and the bound applies to the DENSE shape
  // only: the image-heavy one is a second and a half, and a limit that both
  // shapes pass is one the cheap shape can never fail — which is the reading
  // the whole finding exists to separate.
  // FOUND BY NAME, not by position. The bound is the DENSE shape's, and a run
  // that skipped it must say so rather than sealing `ok` against the cheap
  // shape — which is the same verdict a passing full run prints and is the one
  // way this line could lie.
  const denseRun = runs.find((entry) => entry.shape === 'object-dense')?.run;
  console.log('\n   control: at least one command changed its document');
  if (denseRun === undefined) {
    console.log('SEALED: not measured (the bound is the object-dense shape’s and it was skipped)');
    process.exitCode = 1;
    return;
  }
  const over = denseRun.rows.filter(
    (row) => row.refused !== null || (row.seconds ?? 0) > REGRESSION_LIMIT_SECONDS,
  );
  const worst = Math.max(0, ...denseRun.rows.map((row) => row.seconds ?? 0));
  console.log(
    over.length === 0
      ? `SEALED: within the bound (worst ${String(worst)}s of ${String(REGRESSION_LIMIT_SECONDS)}s)`
      : `SEALED: over the bound (${over.map((row) => row.kind).join(', ')})`,
  );
  if (over.length > 0) process.exitCode = 1;
}

await main();
