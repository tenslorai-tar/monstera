// @ts-check
/**
 * Proves ADR-0240 against PDFium itself: a picture and a shape on a page of Type 3 text, moved and resized where they
 * are drawn by MuPDF, read back by PDFium from the saved bytes with every text object and every other object as it was.
 *
 * ## The control is the owner's E1, reproduced
 *
 * The same photo moved through PDFium's own route (`placePageObject`) is refused at read-back, because
 * `FPDFPage_GenerateContent` writes the page's text again and loses the Type 3 objects. Were the page one PDFium could
 * rewrite, that case would fail, and so would this proof: a pass then would say nothing about E1's pages.
 *
 * Both engines are needed: Windows requires them (`--require-engines`), Linux reports what it could not run.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDocument, PDFName } from '@cantoo/pdf-lib';

import { DRAWN_OBJECT_PLACE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { pageStreams } from '../lib/pageStreams.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';

const ROOT = repoRoot();
const REQUIRED = process.argv.includes('--require-engines');
const CHROMIUM = join(ROOT, 'packages', 'testing', 'fixtures', 'text-edit', 'chromium-type3.pdf');

const CASES = [
  'CONTROL (E1): the photo moved through PDFium’s own route is refused at read-back, losing Type 3 text',
  'the photo moved where it is drawn is read by PDFium from the saved bytes exactly the points further on',
  'every text object reads back as it was, in the same number, and every object keeps its kind and its place in the walk',
  'the logo resized to twice its size is read by PDFium twice as wide and tall, its bottom-left corner where it was',
  'CONTROL: the same photo placed with no move is read where it was, so the move above is the command’s',
  'a TEXT object moved on that page keeps PDFium’s route and is refused as moved text, which the person is told in words',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 6 });
if (CASES.length !== 6) throw new Error(`CASES names ${String(CASES.length)} cases against a declared 6`);

/** @param {string} name @param {boolean} held @param {string} detail */
function check(name, held, detail) {
  const mark = roster.mark();
  if (!held) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

/**
 * The Chromium print with a 120 by 90 photo at (300, 400) and a red triangle, the logo, drawn after its text IN THE SAME
 * STREAM, as Chromium writes a page. Measured while writing this proof: with the photo in a stream of its own, PDFium
 * regenerates only that stream and keeps the text, so the E1 control does not fire; a page printed by Chromium (and the
 * owner's) holds text and pictures in one stream.
 */
async function magazine() {
  const bytes = new Uint8Array(readFileSync(CHROMIUM));
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = document.getPage(0);
  const photo = document.context.stream(Uint8Array.of(10, 200, 30, 90), {
    Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceGray', BitsPerComponent: 8,
  });
  page.node.setXObject(PDFName.of('MonPhoto'), document.context.register(photo));
  const original = Buffer.concat((await pageStreams(bytes, 0)).map((stream) => Buffer.concat([Buffer.from(stream), Buffer.from('\n')])));
  const drawn = Buffer.from('q 120 0 0 90 300 400 cm /MonPhoto Do Q\nq 1 0 0 rg 300 300 m 350 350 l 400 300 l h f Q');
  page.node.set(PDFName.of('Contents'), document.context.register(document.context.flateStream(Buffer.concat([original, drawn]))));
  return document.save({ useObjectStreams: false });
}

const round = (/** @type {number} */ value) => Math.round(value * 100) / 100;

/**
 * @param {any} pdfium
 * @param {any} kernel
 */
async function run(pdfium, kernel) {
  const bytes = await magazine();
  /** @param {Uint8Array} image */
  const read = async (image) => {
    const session = await pdfium.pdfiumWriter.open(image);
    try {
      const objects = await pdfium.pageObjects(session, 0);
      const texts = [];
      for (const object of objects) if (object.kind === 'text') texts.push(await pdfium.textObjectText(session, 0, object.index));
      return { objects, texts };
    } finally {
      await pdfium.pdfiumWriter.close(session);
    }
  };
  const before = await read(bytes);
  const photo = before.objects.find((/** @type {any} */ object) => object.kind === 'image');
  const logo = before.objects.find((/** @type {any} */ object) => object.kind === 'path');
  const box = (/** @type {any} */ object) => ({ left: object.left, bottom: object.bottom, right: object.right, top: object.top });

  /** @type {string} */
  let refusal = 'no refusal';
  try {
    await kernel.localPdfiumExecution.apply({
      session: { bytes, opensWith: undefined },
      command: { kind: 'placePageObject', page: 0, index: photo.index, moveBy: { x: 20, y: -10 }, scaleBy: { x: 1, y: 1 }, version: 1 },
    });
  } catch (error) {
    refusal = `${String(/** @type {any} */ (error).name)}: ${String(/** @type {any} */ (error).message)}`;
  }
  check(CASES[0] ?? '', /EditRefusedError: .*text objects and saved with/u.test(refusal), refusal);

  /** @param {Uint8Array} image @param {any} command */
  const placed = async (image, command) => {
    const session = await kernel.mupdfWriter.open(image);
    try {
      await kernel.applyPlaceDrawnObject(session, command);
      return await kernel.mupdfWriter.serialise(session);
    } finally {
      await kernel.mupdfWriter.close(session);
    }
  };
  const base = { kind: 'placeDrawnObject', page: 0, scaleBy: { x: 1, y: 1 }, moveBy: { x: 0, y: 0 }, version: 1 };
  const movedBytes = await placed(bytes, { ...base, index: photo.index, object: 'image', ordinal: 0, box: box(photo), moveBy: { x: 20, y: -10 } });
  const moved = await read(movedBytes);
  const after = moved.objects.find((/** @type {any} */ object) => object.kind === 'image');
  // RELATIVE TO THE LISTING: the print leaves its page matrix open, so what is drawn after its text is under it.
  const shifted = (/** @type {any} */ from, /** @type {number} */ dx, /** @type {number} */ dy) =>
    JSON.stringify([from.left + dx, from.bottom + dy, from.right + dx, from.top + dy].map(round));
  check(
    CASES[1] ?? '',
    JSON.stringify([after.left, after.bottom, after.right, after.top].map(round)) === shifted(photo, 20, -10),
    `the photo read back at ${JSON.stringify(box(after))} from ${JSON.stringify(box(photo))}`,
  );
  check(
    CASES[2] ?? '',
    JSON.stringify(moved.texts) === JSON.stringify(before.texts) &&
      before.texts.length > 0 &&
      JSON.stringify(moved.objects.map((/** @type {any} */ object) => object.kind)) === JSON.stringify(before.objects.map((/** @type {any} */ object) => object.kind)),
    `text objects ${String(before.texts.length)} before, ${String(moved.texts.length)} after`,
  );

  const grown = await read(await placed(bytes, { ...base, index: logo.index, object: 'path', ordinal: 0, box: box(logo), scaleBy: { x: 2, y: 2 } }));
  const bigger = grown.objects.find((/** @type {any} */ object) => object.kind === 'path');
  check(
    CASES[3] ?? '',
    round(bigger.left) === round(logo.left) &&
      round(bigger.bottom) === round(logo.bottom) &&
      Math.abs(bigger.right - bigger.left - 2 * (logo.right - logo.left)) < 0.5 &&
      Math.abs(bigger.top - bigger.bottom - 2 * (logo.top - logo.bottom)) < 0.5,
    `the logo read back at ${JSON.stringify(box(bigger))} from ${JSON.stringify(box(logo))}`,
  );
  const still = (await read(await placed(bytes, { ...base, index: photo.index, object: 'image', ordinal: 0, box: box(photo) }))).objects.find(
    (/** @type {any} */ object) => object.kind === 'image',
  );
  check(
    CASES[4] ?? '',
    JSON.stringify([still.left, still.bottom, still.right, still.top].map(round)) === shifted(photo, 0, 0),
    `the photo placed with no move read back at ${JSON.stringify(box(still))} from ${JSON.stringify(box(photo))}`,
  );

  const words = before.objects.find((/** @type {any} */ object) => object.kind === 'text');
  /** @type {any} */
  let textRefusal;
  try {
    await kernel.localPdfiumExecution.apply({
      session: { bytes, opensWith: undefined },
      command: { kind: 'placePageObject', page: 0, index: words.index, moveBy: { x: 5, y: 0 }, scaleBy: { x: 1, y: 1 }, version: 1 },
    });
  } catch (error) {
    textRefusal = error;
  }
  check(
    CASES[5] ?? '',
    textRefusal?.name === 'EditRefusedError' && textRefusal.step === 'moved-text',
    `the text move answered ${String(textRefusal?.name)} at step ${String(textRefusal?.step)}`,
  );
}

const library = pdfiumLibrary(ROOT);
const shim = existsSync(library) ? bindNativeEngine(ROOT) : null;
if (!existsSync(library) || shim === null) {
  exitUnverifiable({
    required: REQUIRED,
    subject: 'a drawn object placed where it is drawn, on a Type 3 page',
    why:
      `${String(CASES.length)} case(s) need both engines:\n${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      ` +
      (existsSync(library) ? 'The MuPDF shim is not built. Run `npm run provision:mupdf`.' : 'PDFium is not provisioned. Run `node scripts/provision/pdfium.mjs`.'),
    flag: '--require-engines',
  });
} else {
  refuseStaleBuild(ROOT, DRAWN_OBJECT_PLACE, 6);
  // LITERAL SPECIFIERS, so `proof:electronimports` and the freshness scan can read what this loads.
  const pdfium = await import('../../packages/kernel/dist/pdfiumFfi.js');
  pdfium.openPdfium(library);
  const { mupdfWriter } = await import('../../packages/kernel/dist/mupdfWriter.js');
  const { applyPlaceDrawnObject } = await import('../../packages/kernel/dist/drawnObjectPlace.js');
  const { localPdfiumExecution } = await import('../../packages/kernel/dist/pdfiumSpecs.js');
  await run(pdfium, { mupdfWriter, applyPlaceDrawnObject, localPdfiumExecution });
  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} drawn object case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('drawn object case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
