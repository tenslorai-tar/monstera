// @ts-check
/**
 * What compressing every full save costs (`saveDepth.ts`' FULL_SAVE_TERMS), on a large document.
 *
 *   node scripts/research/saveCompressionCost.mjs [--pages <n>] [--rounds <n>]
 *
 * Two documents of `pages` pages, each page forty lines of text: one its producer stored compressed, one stored raw.
 * For each, two things are timed, the median of `rounds`, alternating which terms go first, with the terms before this
 * change (`garbage`) against the full save's terms now:
 * - a Save: the session, with one stamp placed, written whole;
 * - an edit: a stamp placed, then the session written whole, which is what main's image refresh does after a command.
 * Through the save's own door (`savedBuffer`) on the session's own document, so the only thing that differs is the terms.
 *
 * Nothing here is a pass or a fail: it is the figure the report gives.
 */
import { NATIVE_ENGINE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';

const ROOT = repoRoot();
refuseStaleBuild(ROOT, NATIVE_ENGINE, 1);
if (bindNativeEngine(ROOT) === null) throw new Error('the MuPDF shim is not built here');
// LITERAL SPECIFIERS, the ones `nativeEngine.mjs` binds, so the import scans can read what this loads.
const mupdf = await import('../../packages/kernel/dist/mupdfRaw.js');
const { mupdfWriter, withDocument } = await import('../../packages/kernel/dist/mupdfWriter.js');
const { applyAddAnnotation } = await import('../../packages/kernel/dist/pageAnnotations.js');
const { FULL_SAVE_TERMS, savedBuffer } = await import('../../packages/kernel/dist/saveDepth.js');

const option = (/** @type {string} */ name, /** @type {number} */ fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
};
const PAGES = option('--pages', 2000);
const ROUNDS = option('--rounds', 7);
const BEFORE = 'garbage';

/** A document of PAGES pages, built by MuPDF itself, stored as `terms` say. @param {string} terms */
function large(terms) {
  const document = new mupdf.PDFDocument();
  const font = document.addSimpleFont(new mupdf.Font('Helvetica'), 'Latin');
  for (let at = 0; at < PAGES; at += 1) {
    const resources = document.addObject({ Font: { F: font } });
    let content = '';
    for (let line = 0; line < 40; line += 1) content += `BT /F 10 Tf 40 ${String(760 - line * 12)} Td (Line ${String(line)} of page ${String(at)}) Tj ET\n`;
    document.insertPage(-1, document.addPage([0, 0, 612, 792], 0, resources, content));
  }
  const bytes = document.saveToBuffer(terms).asUint8Array().slice();
  document.destroy();
  return bytes;
}

/** @param {number[]} values */
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/** @param {import('../../packages/kernel/dist/engineSeam.js').MupdfSession} session @param {number} round */
const stamp = (session, round) =>
  applyAddAnnotation(session, {
    kind: 'addAnnotation',
    page: round % PAGES,
    stamp: { author: 'A', created: '2026-11-06T09:00:00.000Z' },
    annotation: { type: 'stamp', stamp: 'approved', rect: { x0: 50, y0: 100, x1: 200, y1: 150 }, colour: [0.8, 0, 0], opacity: 1 },
  });

/** The session written whole with `terms`: the time, and the bytes it wrote. @param {any} session @param {string} terms */
const written = (session, terms) =>
  withDocument(session, (/** @type {any} */ document) => {
    const start = performance.now();
    const buffer = savedBuffer(document, terms);
    const took = performance.now() - start;
    const length = buffer.getLength();
    buffer.destroy();
    return { took, length };
  });

process.stdout.write(`${String(PAGES)} pages, ${String(ROUNDS)} rounds each; before: ${BEFORE}, now: ${FULL_SAVE_TERMS}\n`);
/** @type {[string, string][]} */
const DOCUMENTS = [
  ['stored compressed', 'garbage,compress'],
  ['stored raw', 'garbage'],
];
for (const [label, stored] of DOCUMENTS) {
  const bytes = large(stored);
  const session = await mupdfWriter.open(bytes);
  try {
    await stamp(session, 0);
    /** @type {Record<string, number[]>} */
    const save = { [BEFORE]: [], [FULL_SAVE_TERMS]: [] };
    /** @type {Record<string, number[]>} */
    const edit = { [BEFORE]: [], [FULL_SAVE_TERMS]: [] };
    // THE SIZES FROM ONE STATE, before the rounds add stamps, so the two are of the same document.
    /** @type {Record<string, number>} */
    const sizes = { [BEFORE]: (await written(session, BEFORE)).length, [FULL_SAVE_TERMS]: (await written(session, FULL_SAVE_TERMS)).length };
    for (let round = 0; round < ROUNDS; round += 1) {
      const order = round % 2 === 0 ? [BEFORE, FULL_SAVE_TERMS] : [FULL_SAVE_TERMS, BEFORE];
      for (const terms of order) {
        const saved = await written(session, terms);
        save[terms]?.push(saved.took);
        const start = performance.now();
        await stamp(session, round + 1);
        await written(session, terms);
        edit[terms]?.push(performance.now() - start);
      }
    }
    const at = (/** @type {Record<string, number[]>} */ set, /** @type {string} */ terms) => median(set[terms] ?? []).toFixed(1);
    process.stdout.write(
      `${label} (${String(bytes.length)} bytes): Save ${at(save, BEFORE)} ms -> ${at(save, FULL_SAVE_TERMS)} ms, ` +
        `${String(sizes[BEFORE])} -> ${String(sizes[FULL_SAVE_TERMS])} bytes; an edit ${at(edit, BEFORE)} ms -> ${at(edit, FULL_SAVE_TERMS)} ms\n`,
    );
  } finally {
    await mupdfWriter.close(session);
  }
}
