// @ts-check
/**
 * A markup made from a whole line's two ends covers that line's first glyph to its last, on every font kind (cloud run
 * 18, F1) — the kernel half of `packages/testing/src/lineEnds.pw.ts`.
 *
 * ## The pair, and what each half holds
 *
 * The rendered case drags a whole line and asserts that the command's two ends are the line's edges: the left of its
 * box and the right of it, at mid-height, because a whole line's selection spans the text layer's line element and that
 * element is fitted to the box the engine reported. This half takes those two points on lines set in four font kinds
 * and asserts what MuPDF marks between them: `applyAddAnnotation`, the writer every highlight, underline and
 * strikethrough goes through, reading the quads back from the page.
 *
 * The edges come from the engine's own reading of the page — `readPageText` and `textLayerOf`, the text layer the
 * renderer is handed — and the glyph edges compared against are MuPDF's character quads, so nothing here lays text out.
 *
 * ## The page
 *
 * Built here: three lines of Times, standard 14 and not embedded, of three lengths; and one line each in an embedded
 * TrueType font, a Type 3 font and a Type0 font over CIDFontType2 with Identity-H, built by `fontKindFixtures.mjs`'
 * `fontOfKind`, the one builder of font-kind fixtures.
 *
 * ## Controls
 *
 * - PREMISE: the engine reads the page as the six lines it was given, so every later case is about a line that exists.
 * - CONTROL: the end a held selection left — the middle of the second to last word of the long line — marks that line
 *   short of its last glyph by more than the tolerance, so the comparison can see a short mark.
 *
 * Usage: node scripts/proofs/lineEndMarks.proof.mjs [--require-engines]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';

import { LINE_END_MARKS, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { fontOfKind } from '../research/fontKindFixtures.mjs';

const ROOT = repoRoot();
const REQUIRED = process.argv.includes('--require-engines');
const PAGE_HEIGHT = 792;
/** How close a mark's end must be to the glyph's edge: a point, because MuPDF writes a line's box in whole points. */
const TOLERANCE = 1;

/**
 * The Times lines, shared with the rendered case: what each half builds the page from and what the rendered case
 * asserts against, which this proof holds to the engine's reading (the PREMISE).
 *
 * @type {{ size: number, x: number, lines: { text: string, baseline: number, box: { x0: number, y0: number, x1: number, y1: number }, glyphs: { first: number, last: number } }[] }}
 */
const AGREEMENT = JSON.parse(readFileSync(join(ROOT, 'packages', 'testing', 'fixtures', 'text-markup', 'agreement-lines.json'), 'utf8'));

/** Each line: its words, its font kind, the size it is set at and its baseline. */
const LINES = [
  ...AGREEMENT.lines.map((line) => ({ kind: 'times', text: line.text, size: AGREEMENT.size, y: line.baseline })),
  { kind: 'truetype-embedded', text: 'An embedded TrueType line ends on its last word', size: 12, y: 630 },
  { kind: 'type3', text: 'Type three glyphs run to the end', size: 12, y: 600 },
  { kind: 'type0-cidfonttype2', text: 'A CID keyed Identity line ends here', size: 12, y: 570 },
];

const KINDS = [
  ['times', 'Times, standard 14, not embedded (three lengths)'],
  ['truetype-embedded', 'TrueType, embedded'],
  ['type3', 'Type 3'],
  ['type0-cidfonttype2', 'Type0 over CIDFontType2, Identity-H'],
];

const CASES = [
  'PREMISE: the engine reads the page as the seven lines it was given, and the Times lines at the boxes and glyph edges agreement-lines.json records',
  ...KINDS.map(([, name]) => `${String(name)}: a highlight, an underline and a strikethrough from the line's box edges cover its first glyph to its last`),
  'CONTROL: the end a held selection left, inside the second to last word, marks the long line short of its last glyph',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 6 });
if (CASES.length !== 6) throw new Error(`CASES names ${String(CASES.length)} cases against a declared 6`);

/** @param {number} at @param {boolean} held @param {string} detail */
function check(at, held, detail) {
  const name = CASES[at] ?? `case ${String(at)}`;
  const mark = roster.mark();
  if (!held) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, `${name} — ${detail}`);
}

/** The page of {@link LINES}. */
async function linesPdf() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const context = doc.context;
  const page = doc.addPage([612, PAGE_HEIGHT]);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  /** @type {Record<string, { font: import('@cantoo/pdf-lib').PDFRef, show: (text: string) => string }>} */
  const fonts = { times: { font: times.ref, show: (text) => times.encodeText(text).toString() } };
  for (const [kind] of KINDS.slice(1)) {
    const used = [...new Set(LINES.filter((line) => line.kind === kind).map((line) => line.text).join(''))];
    fonts[String(kind)] = fontOfKind(doc, String(kind), used, helvetica);
  }
  const names = Object.keys(fonts);
  page.node.set(PDFName.of('Resources'), context.obj({ Font: Object.fromEntries(names.map((kind, at) => [`F${String(at)}`, fonts[kind]?.font])) }));
  const content = LINES.map((line) => {
    const font = fonts[line.kind];
    if (font === undefined) throw new Error(`no font for ${line.kind}`);
    return `BT /F${String(names.indexOf(line.kind))} ${String(line.size)} Tf 72 ${String(line.y)} Td ${font.show(line.text)} Tj ET`;
  }).join('\n');
  page.node.set(PDFName.of('Contents'), context.register(context.flateStream(content)));
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

/**
 * Each line's text and the left of its first glyph and the right of its last, from MuPDF's character quads in the page's
 * displayed space. Spaces are skipped, since a space at a line's end is not a glyph a person sees.
 *
 * @param {any} document
 * @returns {{ text: string, first: number, last: number }[]}
 */
function glyphEdgesOf(document) {
  const text = document.loadPage(0).toStructuredText('preserve-whitespace');
  /** @type {{ text: string, first: number, last: number }[]} */
  const lines = [];
  /** @type {{ text: string, first: number, last: number } | null} */
  let line = null;
  try {
    text.walk({
      beginLine: () => {
        line = { text: '', first: Infinity, last: -Infinity };
      },
      onChar: (/** @type {string} */ c, /** @type {unknown} */ _origin, /** @type {unknown} */ _font, /** @type {unknown} */ _size, /** @type {number[]} */ quad) => {
        if (line === null) return;
        line.text += c;
        if (c.trim() === '') return;
        line.first = Math.min(line.first, quad[0] ?? Infinity, quad[4] ?? Infinity);
        line.last = Math.max(line.last, quad[2] ?? -Infinity, quad[6] ?? -Infinity);
      },
      endLine: () => {
        if (line !== null) lines.push(line);
        line = null;
      },
    });
  } finally {
    text.destroy();
  }
  return lines;
}

/**
 * The left and right of the quads the first annotation on page 0 carries, in the page's displayed space.
 *
 * @param {any} document
 */
function markedSpan(document) {
  const annotation = document.loadPage(0).getAnnotations()[0];
  if (annotation === undefined) return null;
  /** @type {number[][]} */
  const quads = annotation.getQuadPoints();
  const xs = quads.flatMap((quad) => [quad[0], quad[2], quad[4], quad[6]]).filter((x) => typeof x === 'number');
  return xs.length === 0 ? null : { left: Math.min(...xs), right: Math.max(...xs) };
}

/**
 * @param {any} kernel
 */
async function run(kernel) {
  const bytes = await linesPdf();
  const session = await kernel.mupdfWriter.open(bytes);
  /** @type {{ text: string, box: { x0: number, y0: number, x1: number, y1: number } }[]} */
  let layer;
  /** @type {{ text: string, first: number, last: number }[]} */
  let glyphs;
  try {
    const { pages } = await kernel.readPageText(session, [0]);
    layer = kernel.textLayerOf(pages[0], 100, 1000).lines;
    glyphs = await kernel.withDocument(session, (/** @type {any} */ document) => glyphEdgesOf(document));
  } finally {
    await kernel.mupdfWriter.close(session);
  }

  const texts = layer.map((line) => line.text.trim());
  /** @type {string[]} */
  const stale = [];
  for (const [at, recorded] of AGREEMENT.lines.entries()) {
    const box = layer[at]?.box;
    const edges = glyphs.find((line) => line.text.trim() === recorded.text);
    if (box === undefined || JSON.stringify(box) !== JSON.stringify(recorded.box)) stale.push(`line ${String(at)} reads at ${JSON.stringify(box)}`);
    if (edges === undefined || Math.abs(edges.first - recorded.glyphs.first) > 0.01 || Math.abs(edges.last - recorded.glyphs.last) > 0.01) {
      stale.push(`line ${String(at)}'s glyphs read ${edges === undefined ? 'nowhere' : `${String(edges.first)}..${String(edges.last)}`}`);
    }
  }
  check(
    0,
    texts.length === LINES.length && LINES.every((line, at) => texts[at] === line.text) && stale.length === 0,
    stale.length > 0 ? `agreement-lines.json is not what the engine reads: ${stale.join('; ')}` : `read ${JSON.stringify(texts)}`,
  );

  /**
   * What `type` marks between two points of line `at`, in PDF user space, as the span of its quads.
   *
   * @param {string} type @param {number} at @param {number} fromX @param {number} toX
   */
  const mark = async (type, at, fromX, toX) => {
    const line = layer[at];
    if (line === undefined) return null;
    const y = PAGE_HEIGHT - (line.box.y0 + line.box.y1) / 2;
    const marked = await kernel.mupdfWriter.open(bytes);
    try {
      await kernel.applyAddAnnotation(marked, {
        kind: 'addAnnotation',
        page: 0,
        annotation: { type, from: { x: fromX, y }, to: { x: toX, y }, colour: [1, 0.9, 0.2], opacity: 1 },
        stamp: { author: 'Line end proof', created: '2026-10-24T09:00:00.000Z' },
      });
      return await kernel.withDocument(marked, (/** @type {any} */ document) => markedSpan(document));
    } finally {
      await kernel.mupdfWriter.close(marked);
    }
  };

  /** @param {number} at */
  const edgesOf = (at) => glyphs.find((line) => line.text.trim() === LINES[at]?.text);

  for (const [index, [kind]] of KINDS.entries()) {
    /** @type {string[]} */
    const wrong = [];
    /** @type {string[]} */
    const seen = [];
    for (const [at, line] of LINES.entries()) {
      if (line.kind !== kind) continue;
      const box = layer[at]?.box;
      const edges = edgesOf(at);
      if (box === undefined || edges === undefined) {
        wrong.push(`line ${String(at)} has no box or no glyphs`);
        continue;
      }
      for (const type of ['highlight', 'underline', 'strikeout']) {
        const span = await mark(type, at, box.x0, box.x1);
        const fits = span !== null && Math.abs(span.left - edges.first) <= TOLERANCE && Math.abs(span.right - edges.last) <= TOLERANCE;
        const said = span === null ? 'nothing' : `${span.left.toFixed(2)}..${span.right.toFixed(2)}`;
        seen.push(`${type} ${said} for glyphs ${edges.first.toFixed(2)}..${edges.last.toFixed(2)}`);
        if (!fits) wrong.push(`line ${String(at)}: ${type} marked ${said}, its glyphs are ${edges.first.toFixed(2)}..${edges.last.toFixed(2)}`);
      }
    }
    check(1 + index, wrong.length === 0 && seen.length > 0, wrong.length === 0 ? seen.join('; ') : wrong.join('; '));
  }

  // THE HELD END: the middle of *term*, the second to last word of the long line, where the last move event on the line
  // left the selection before the moving end was placed past it.
  const long = layer[0];
  const edges = edgesOf(0);
  // 96% of the way along is inside *term* (its glyphs run from 92.9% to 97.0% of the box), the end `lineEnds.pw.ts`'
  // control and the held selection both stop at.
  const held = long === undefined ? null : await mark('highlight', 0, long.box.x0, long.box.x0 + (long.box.x1 - long.box.x0) * 0.96);
  check(
    1 + KINDS.length,
    held !== null && edges !== undefined && edges.last - held.right > TOLERANCE,
    held === null || edges === undefined ? 'nothing was marked' : `marked to ${held.right.toFixed(2)}, its last glyph ends at ${edges.last.toFixed(2)}`,
  );
}

const shim = bindNativeEngine(ROOT);
if (shim === null) {
  exitUnverifiable({
    required: REQUIRED,
    subject: 'a whole line marked from its two ends on every font kind',
    why: `${String(CASES.length)} case(s) need the MuPDF shim:\n${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      The MuPDF shim is not built. Run \`npm run provision:mupdf\`.`,
    flag: '--require-engines',
  });
} else {
  refuseStaleBuild(ROOT, LINE_END_MARKS, 2);
  // LITERAL SPECIFIERS, so `proof:electronimports` and the freshness scan can read what this loads.
  const { mupdfWriter, withDocument } = await import('../../packages/kernel/dist/mupdfWriter.js');
  const { readPageText } = await import('../../packages/kernel/dist/pageText.js');
  const { textLayerOf } = await import('../../packages/kernel/dist/textLayer.js');
  const { applyAddAnnotation } = await import('../../packages/kernel/dist/pageAnnotations.js');
  await run({ mupdfWriter, withDocument, readPageText, textLayerOf, applyAddAnnotation });
  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} line end mark case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('line end mark case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
