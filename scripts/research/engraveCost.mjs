// @ts-check
/**
 * What drawing placed marks by the page costs a save (ADR-0287), on a large document.
 *
 *   node scripts/research/engraveCost.mjs [--pages <n>] [--rounds <n>]
 *
 * A document of `pages` pages, each with a line of text and a filled box, is opened once. Three states are timed, each
 * the median of `rounds` serialises, alternating which kind goes first:
 * - no placed mark at all: the engraving's walk of every page's `/Annots` and nothing to draw;
 * - one picture placed on page 1;
 * - one picture placed on every page (one image, a stamp per page).
 * For each, the session saved as held (what every save wrote before) against saved as a file a person keeps.
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
const { mupdfWriter } = await import('../../packages/kernel/dist/mupdfWriter.js');
const { applyPlaceImage } = await import('../../packages/kernel/dist/pageAnnotations.js');

const option = (/** @type {string} */ name, /** @type {number} */ fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
};
const PAGES = option('--pages', 2000);
const ROUNDS = option('--rounds', 7);

/** A document of PAGES pages, built by MuPDF itself. */
function large() {
  const document = new mupdf.PDFDocument();
  const font = document.addSimpleFont(new mupdf.Font('Helvetica'), 'Latin');
  for (let at = 0; at < PAGES; at += 1) {
    const resources = document.addObject({ Font: { F: font } });
    const content = `BT /F 12 Tf 72 720 Td (Page ${String(at + 1)} of a long document, with a line of text.) Tj ET 0 0 1 rg 72 600 200 80 re f`;
    document.insertPage(-1, document.addPage([0, 0, 612, 792], 0, resources, content));
  }
  const bytes = document.saveToBuffer('').asUint8Array().slice();
  document.destroy();
  return bytes;
}

/** @param {number[]} values */
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

const picture = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 300, 120], false);
picture.clear(0);
const png = picture.asPNG();
const stamp = { author: 'A', created: '2026-11-06T09:00:00.000Z' };
const rect = { x0: 300, y0: 100, x1: 500, y1: 180 };

const bytes = large();
process.stdout.write(`document: ${String(PAGES)} pages, ${String(bytes.length)} bytes; ${String(ROUNDS)} rounds each\n`);
/** @type {[string, (number | [number, number])[] | null][]} */
const STATES = [
  ['no placed mark', null],
  ['one picture on page 1', [0]],
  ['one picture on every page', [[0, PAGES - 1]]],
];
for (const [label, pages] of STATES) {
  const session = await mupdfWriter.open(bytes);
  try {
    if (pages !== null) await applyPlaceImage(session, { kind: 'placeImage', pages, rect, bytes: png, stamp });
    /** @type {number[]} */
    const held = [];
    /** @type {number[]} */
    const kept = [];
    let sizes = { held: 0, kept: 0 };
    for (let round = 0; round < ROUNDS; round += 1) {
      const order = round % 2 === 0 ? ['held', 'kept'] : ['kept', 'held'];
      for (const kind of order) {
        const start = performance.now();
        const out = await mupdfWriter.serialise(session, kind === 'kept' ? { marks: 'engraved' } : undefined);
        const took = performance.now() - start;
        (kind === 'kept' ? kept : held).push(took);
        sizes = { ...sizes, [kind]: out.length };
      }
    }
    const extra = median(kept) - median(held);
    process.stdout.write(
      `${label}: as held ${median(held).toFixed(1)} ms (${String(sizes.held)} bytes), as a kept file ${median(kept).toFixed(1)} ms ` +
        `(${String(sizes.kept)} bytes); extra ${extra.toFixed(1)} ms, ${((100 * extra) / Math.max(1, median(held))).toFixed(1)}%\n`,
    );
  } finally {
    await mupdfWriter.close(session);
  }
}
