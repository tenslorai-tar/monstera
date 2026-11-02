// @ts-check
/**
 * WHAT READING A PAGE'S FORM PLACEMENTS COSTS PDFium, one image open each against one for them all (group Y, finding
 * BBBBBBBBB-27): a research instrument, run by hand. It prints readings, never a verdict.
 *
 * It builds `formText.test.ts`' `formGraph(8, 1, 25)`, the page drawing 200 placements that Edit text took 4.4 s to read
 * one call each in the contained host, writes it where asked so it can be opened in the application, and reads its built
 * placement pages in this process: every page by an image opened for it, and every page by one image opened once. Same
 * text both ways is checked and printed. What this process cannot see is the host's own share, the image written into
 * its area and an answer file for every call, so the figure that decides is read in the application (Edit text on the
 * page, the time to its outlines).
 *
 * Run:  node scripts/research/formPlacementReads.mjs [path/to/write.pdf]
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LINE_END_MARKS, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// THE KERNEL AS BUILT FROM ITS SOURCES, and the native engine it binds: a figure read from an older build would be
// printed under this one's name.
refuseStaleBuild(root, LINE_END_MARKS, 2);
/** @type {typeof import('@cantoo/pdf-lib')} */
const pdfLib = createRequire(import.meta.url)('@cantoo/pdf-lib');
const { openPdfium, pdfiumWriter, textRuns } = await import('../../packages/kernel/dist/pdfiumFfi.js');
const { mupdfWriter } = await import('../../packages/kernel/dist/mupdfWriter.js');
const { readFormPages } = await import('../../packages/kernel/dist/formText.js');
openPdfium(pdfiumLibrary(root));
bindNativeEngine(root);

/**
 * `formText.test.ts`' `formGraph`, as written there: forms nested `levels` deep, each showing one word and drawing the
 * next `draws` times, the page drawing the first `placed` times.
 *
 * @param {number} levels
 * @param {number} draws
 * @param {number} placed
 * @returns {Promise<Uint8Array>}
 */
async function formGraph(levels, draws, placed) {
  const document = await pdfLib.PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(pdfLib.StandardFonts.Helvetica);
  /** @type {import('@cantoo/pdf-lib').PDFRef | undefined} */
  let next;
  for (let level = levels; level >= 1; level -= 1) {
    const inner = next === undefined ? '' : Array.from({ length: draws }, (_, at) => ` q 1 0 0 1 ${String(at)} -1 cm /G Do Q`).join('');
    const resources = document.context.obj({ Font: { F1: font.ref }, ...(next === undefined ? {} : { XObject: { G: next } }) });
    next = document.context.register(
      document.context.stream(`BT /F1 3 Tf 0 0 Td (G${String(level)}) Tj ET${inner}`, { Type: 'XObject', Subtype: 'Form', BBox: [-50, -50, 50, 50], Resources: resources }),
    );
  }
  if (next === undefined) throw new Error('a graph needs a level');
  page.node.setXObject(pdfLib.PDFName.of('G'), next);
  const content = Array.from({ length: placed }, (_, at) => `q 1 0 0 1 ${String(20 + at)} 400 cm /G Do Q`).join('\n');
  page.node.addContentStream(document.context.register(document.context.stream(content)));
  return document.save({ useObjectStreams: false });
}

const source = await formGraph(8, 1, 25);
const target = process.argv[2];
if (target !== undefined) {
  writeFileSync(target, source);
  console.log(`wrote ${target}`);
}
const session = await mupdfWriter.open(source);
const { bytes, paths } = await readFormPages(session, 0);
await mupdfWriter.close(session);
console.log(`placements ${String(paths.length)}, their pages' image ${String(bytes.byteLength)} bytes`);

/** @param {Awaited<ReturnType<typeof pdfiumWriter.open>>} read @param {number} at */
const textOf = async (read, at) => (await textRuns(read, at)).runs.map((run) => run.text).join('|');
for (let round = 0; round < 3; round += 1) {
  let began = performance.now();
  /** @type {string[]} */
  const each = [];
  for (let at = 0; at < paths.length; at += 1) {
    const read = await pdfiumWriter.open(bytes);
    each.push(await textOf(read, at));
    await pdfiumWriter.close(read);
  }
  const perCall = performance.now() - began;
  began = performance.now();
  const once = await pdfiumWriter.open(bytes);
  /** @type {string[]} */
  const all = [];
  for (let at = 0; at < paths.length; at += 1) all.push(await textOf(once, at));
  await pdfiumWriter.close(once);
  const oneOpen = performance.now() - began;
  console.log(
    `round ${String(round)}: an open a placement ${perCall.toFixed(0)} ms, one open for all ${oneOpen.toFixed(0)} ms; same text ${String(JSON.stringify(each) === JSON.stringify(all))}`,
  );
}
