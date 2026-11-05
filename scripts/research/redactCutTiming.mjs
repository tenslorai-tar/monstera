// @ts-check
/**
 * How long a burn-in takes with the cut at the mark's edge (ADR-0286) against without it, on the same pages.
 *
 *   node scripts/research/redactCutTiming.mjs [--rounds <n>]
 *
 * ## What is timed
 *
 * The two calls `applyApplyRedactions` makes on a marked page, through the kernel's own build and the native shim:
 * TODAY is `applyRedactions` with line art *remove if covered*, as on d594f808; CUT is `cutLineArt` and then
 * `applyRedactions` with line art left alone, as on this branch. Each round opens the page afresh from the same bytes,
 * marks it the same way and times one of the two, alternating which goes first, so neither is always the warm one.
 *
 * ## The pages
 *
 * - `text`: forty lines of words, three marks over words, and sixty drawings on the page none of which a mark touches:
 *   the owner's "a page with no drawing under a mark".
 * - `thousands`: 4,000 small drawn paths (strokes, fills and curves) over the whole page and one mark over a corner of
 *   them, so the cut has real work on some paths and the cheap box test on the rest.
 * - `signature`: the live run's page, one curved signature under one mark.
 *
 * It prints, per page, each side's median and its spread (fastest to slowest) in milliseconds, and the cut's extra
 * median against today's spread. Nothing here is a pass or a fail: it is the figure the report gives.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';

import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';

const ROOT = repoRoot();
if (bindNativeEngine(ROOT) === null) throw new Error('the MuPDF shim is not built here');
/** @param {string} relative */
const built = (relative) => import(pathToFileURL(join(ROOT, relative)).href);
const mupdf = await built('packages/kernel/dist/mupdfRaw.js');

const argument = process.argv.indexOf('--rounds');
const ROUNDS = argument > 0 ? Number(process.argv[argument + 1]) : 15;

/** @param {string} content @param {(document: PDFDocument, page: import('@cantoo/pdf-lib').PDFPage) => Promise<void>} [more] */
async function page(content, more) {
  const document = await PDFDocument.create();
  const sheet = document.addPage([612, 792]);
  const own = document.context.register(document.context.stream(content));
  if (more === undefined) sheet.node.set(PDFName.of('Contents'), own);
  else {
    await more(document, sheet);
    // pdf-lib's own words first, then the drawings, as one more stream of the page's content.
    sheet.node.addContentStream(own);
  }
  return document.save({ useObjectStreams: false });
}

/** The pages and their marks, in user space. */
async function pages() {
  const drawings = Array.from({ length: 60 }, (_, at) => {
    const x = 40 + (at % 10) * 55;
    const y = 40 + Math.floor(at / 10) * 18;
    return `q 1 w ${String(x)} ${String(y)} m ${String(x + 20)} ${String(y + 10)} ${String(x + 30)} ${String(y - 5)} ${String(x + 45)} ${String(y + 4)} c S Q`;
  }).join('\n');
  const text = await page(drawings, async (document, sheet) => {
    const font = await document.embedFont(StandardFonts.Helvetica);
    for (let line = 0; line < 40; line += 1)
      sheet.drawText(`Line ${String(line)}: the quick brown fox jumps over the lazy dog 0123456789`, { x: 40, y: 760 - line * 14, size: 10, font });
  });
  const many = Array.from({ length: 4000 }, (_, at) => {
    const x = 20 + (at % 80) * 7;
    const y = 20 + Math.floor(at / 80) * 15;
    const kind = at % 3;
    if (kind === 0) return `q 0.6 w ${String(x)} ${String(y)} m ${String(x + 5)} ${String(y + 6)} l S Q`;
    if (kind === 1) return `q ${String(x)} ${String(y)} 4 4 re f Q`;
    return `q 1.2 w ${String(x)} ${String(y)} m ${String(x + 2)} ${String(y + 8)} ${String(x + 4)} ${String(y - 2)} ${String(x + 6)} ${String(y + 5)} c S Q`;
  }).join('\n');
  const thousands = await page(many);
  const signature = await page(
    'q .1 .2 .45 RG 1 J 1.6 w 100 62 m 118 92 124 88 128 64 c 134 48 146 88 158 68 c 170 50 180 82 196 68 c 212 56 232 78 270 72 c S Q',
  );
  return [
    { name: 'text (no drawing under a mark)', bytes: text, marks: [[38, 746, 300, 772], [38, 606, 300, 632], [38, 466, 300, 492]] },
    { name: 'thousands (4,000 drawn paths)', bytes: thousands, marks: [[20, 20, 140, 120]] },
    { name: 'signature (the live run)', bytes: signature, marks: [[92, 42, 278, 98]] },
  ];
}

/**
 * One timed burn-in of a fresh copy; with `check`, it also proves the work was done.
 * @param {Uint8Array} bytes @param {readonly number[][]} marks @param {boolean} cut @param {boolean} [check]
 */
function once(bytes, marks, cut, check = false) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  try {
    const loaded = document.loadPage(0);
    for (const rect of marks) {
      const annotation = loaded.createAnnotation('Redact');
      // MUPDF'S PAGE SPACE, y down from the top, from the user-space rectangle these pages are described in.
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = rect;
      annotation.setRect([x0, 792 - y1, x1, 792 - y0]);
      annotation.update();
    }
    /** The page's content, as text. */
    const content = () => {
      const contents = loaded.getObject().get('Contents');
      if (contents.isStream()) return contents.readStream().asString();
      let text = '';
      for (let at = 0; at < contents.length; at += 1) text += contents.get(at).readStream().asString();
      return text;
    };
    const before = check ? content() : '';
    const marked = loaded.getAnnotations().filter((/** @type {{ getType(): string }} */ annotation) => annotation.getType() === 'Redact').length;
    const start = performance.now();
    let cutPaths = 0;
    if (cut) {
      cutPaths = mupdf.cutLineArt(loaded);
      loaded.applyRedactions(true, 2, 0, 0);
    } else {
      loaded.applyRedactions(true, 2, 1, 0);
    }
    const took = performance.now() - start;
    if (check) {
      // THE WORK WAS DONE: the marks were there, and the burn-in rewrote the page and drew its boxes.
      const after = content();
      if (marked !== marks.length) throw new Error(`${String(marked)} marks found where ${String(marks.length)} were made`);
      if (after === before) throw new Error('the burn-in changed nothing on the page');
      process.stdout.write(
        `  ${cut ? 'cut' : 'today'}: ${String(marked)} marks, content ${String(before.length)} -> ${String(after.length)} bytes${cut ? `, ${String(cutPaths)} paths cut` : ''}\n`,
      );
    }
    return took;
  } finally {
    document.destroy();
  }
}

/** @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0);
}

for (const { name, bytes, marks } of await pages()) {
  /** @type {number[]} */
  const today = [];
  /** @type {number[]} */
  const withCut = [];
  process.stdout.write(`${name}\n`);
  once(bytes, marks, false, true);
  once(bytes, marks, true, true);
  for (let round = 0; round < ROUNDS; round += 1) {
    const cutFirst = round % 2 === 1;
    if (cutFirst) withCut.push(once(bytes, marks, true));
    today.push(once(bytes, marks, false));
    if (!cutFirst) withCut.push(once(bytes, marks, true));
  }
  const spread = Math.max(...today) - Math.min(...today);
  const extra = median(withCut) - median(today);
  process.stdout.write(
    `${name}: today median ${median(today).toFixed(2)} ms (spread ${Math.min(...today).toFixed(2)} to ${Math.max(...today).toFixed(2)}), ` +
      `with the cut median ${median(withCut).toFixed(2)} ms (spread ${Math.min(...withCut).toFixed(2)} to ${Math.max(...withCut).toFixed(2)}); ` +
      `extra ${extra.toFixed(2)} ms against today's spread ${spread.toFixed(2)} ms: ${extra <= spread ? 'within' : 'BEYOND'} it\n`,
  );
}
