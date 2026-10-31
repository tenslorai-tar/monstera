// @ts-check
/**
 * WHERE PDF.js DRAWS EACH GLYPH, against where MuPDF says the letter is: the reading cloud run 30 takes before the
 * text layer's renderer half is built ([ADR-0280](../../docs/DECISIONS/0280-the-text-layer-places-each-letter-where-the-engine-reads-it.md)).
 *
 * The text layer places each letter where MuPDF reads it, and the person sees the glyph where PDF.js draws it. Where
 * the two disagree, a selection is offset from the ink by the difference, whatever the text layer does. This measures
 * that difference per letter, on Chromium (the version is printed), read from PDF.js's OWN DRAWING and never from its
 * text layer.
 *
 * ## The three answers per letter
 *
 * - **drawn**: the origin PDF.js draws the glyph at. A glyph PDF.js sets with `fillText` is read from the canvas
 *   context's transform at that call; a Type 3 glyph, which PDF.js draws by running the glyph's own operators, is read
 *   from the transform at the `scale(fontSize, fontSize)` that `showType3Text` makes immediately before the glyph's
 *   `transform(fontMatrix)` (pdfjs-dist's `build/pdf.mjs`). Both are page points in the page's display space, from a
 *   render at scale 1.
 * - **engine**: the letter's origin as MuPDF's structured text holds it, a float, from the binding's walk of a read
 *   without segmentation (the walk cannot see inside a structure block; the origins are the same characters').
 * - **placed**: where the build would put the letter: the line's origin from the page text's JSON plus the letter's
 *   place from the letters' file (`readPageTextWithLetters`, `pageLetters`), which is what the renderer will be given.
 *
 * *placed* minus *engine* is the format's own error; *drawn* minus *engine* is the renderers' disagreement. Both are
 * reported, so the format's error cannot pass for a renderer's.
 *
 * ## Its own controls, on every run (`CLAUDE.md` items 4a and 4b)
 *
 * - **A positive control**: one `H` set at a known point. The drawing must be found, once, at that point, on an
 *   upright page and on one turned 90 degrees; otherwise the run stops before any reading.
 * - **A resolution test**: two fixtures whose glyphs differ by 0.25 pt. The instrument must report the 0.25 for every
 *   glyph, from the drawing and from the engine, and 0 for a fixture against itself; otherwise the run stops.
 * - **The pairing is by character**: letters are paired in order with spaces set aside, and a fixture whose drawn and
 *   engine letters differ in count or in any character is reported as unpaired, never measured.
 *
 * ## The fixtures, generated here
 *
 * Written by hand, so what each font dictionary carries is exactly what the row says: Times-Roman with no `/Widths`,
 * the same with the font's published widths (pdf-lib's metrics), Helvetica and Courier with no `/Widths`, an embedded
 * TrueType (Liberation Sans, SIL OFL 1.1, from `pdfjs-dist`), and `chromium-type3.pdf`; each also on a page turned
 * 90 degrees. Each of ours has an 80-letter line.
 *
 * PDF.js is given the application's own options where they bear on fonts (`documentView.ts`): no standard font data,
 * no worker fetch, no WebAssembly. So a font with no file is drawn in whatever face the system offers, at PDF.js's
 * advances; the face can move a glyph only where PDF.js re-measures it, which the drawing read includes.
 *
 * Run: node scripts/research/glyphPlacement.mjs
 *
 * It prints readings, never a verdict.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';

import { MAX_TEXT_LAYER_LINE, MAX_TEXT_LAYER_LINES } from '../../packages/contract/dist/textLayerBounds.js';
import { mupdfWriter, withDocument } from '../../packages/kernel/dist/mupdfWriter.js';
import { readPageTextWithLetters } from '../../packages/kernel/dist/pageText.js';
import { pageLetters } from '../../packages/kernel/dist/textLetters.js';
import { WORD_BOX_READ_OPTIONS, linesOf, parsePageText } from '../../packages/kernel/dist/textStructure.js';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(ROOT, 'package.json'));
const PDFJS = join(ROOT, 'node_modules', 'pdfjs-dist', 'build');
const TRUETYPE = join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts', 'LiberationSans-Regular.ttf');
const CHROMIUM_TYPE3 = join(ROOT, 'packages', 'testing', 'fixtures', 'text-edit', 'chromium-type3.pdf');

refuseStaleBuild(
  ROOT,
  [
    ['packages/kernel/src', 'packages/kernel/dist/index.js', 'tsc'],
    ['packages/contract/src/textLayerBounds.ts', 'packages/contract/dist/textLayerBounds.js', 'tsc'],
  ],
  2,
);
if (bindNativeEngine(ROOT) === null) throw new Error('The native engine is not built here (npm run provision:mupdf); nothing can be measured.');

/** The size every fixture of ours is set at. */
const SIZE = 11;

/** The lines each fixture of ours carries; the last is the 80-letter line. */
const LINES = [
  'Monstera places each letter where the engine reads it.',
  'Quick brown foxes jump over lazy dogs; WAVY Tall glyphs.',
  'Each letter of this line is measured where the engine and the renderer place it.',
];
const LONG = LINES[2] ?? '';
if (LONG.length !== 80) throw new Error(`The long line is ${String(LONG.length)} letters, not 80.`);

// ---------------------------------------------------------------------------------------------------------------
// The fixtures

/**
 * One page, written by hand: a font dictionary, the lines at `SIZE` from the top, and `/Rotate`.
 *
 * @param {{ font: string, extra?: Buffer[], lines: readonly { x: number, y: number, text: string }[], rotate?: number }} spec
 *   `font` is object 4's body; `extra` are objects 6 onward, which the font may name
 * @returns {Uint8Array}
 */
function pdfOf(spec) {
  const escape = (/** @type {string} */ text) => text.replace(/[\\()]/gu, (c) => `\\${c}`);
  const content = spec.lines.map((line) => `BT /F1 ${String(SIZE)} Tf ${line.x.toFixed(3)} ${line.y.toFixed(3)} Td (${escape(line.text)}) Tj ET`).join('\n');
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate ${String(spec.rotate ?? 0)} /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`, 'latin1'),
    Buffer.from(spec.font, 'latin1'),
    Buffer.from(`<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`, 'latin1'),
    ...(spec.extra ?? []),
  ];
  const parts = [Buffer.from('%PDF-1.7\n', 'latin1')];
  let length = parts[0]?.length ?? 0;
  /** @type {number[]} */
  const offsets = [];
  objects.forEach((body, at) => {
    offsets.push(length);
    const part = Buffer.concat([Buffer.from(`${String(at + 1)} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(part);
    length += part.length;
  });
  const xref = length;
  parts.push(
    Buffer.from(
      `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}` +
        `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`,
      'latin1',
    ),
  );
  return new Uint8Array(Buffer.concat(parts));
}

/**
 * Each line's origin, at a FRACTION of a point on both axes: a line set on a whole point is one the page text's
 * integer origins (below) would get right by accident, so it could not show them.
 *
 * @param {number} [dx] how far right every line is set, in points
 */
function linesAt(dx = 0) {
  return LINES.map((text, at) => ({ x: 72.37 + dx, y: 700.71 - at * 20.13, text }));
}

/**
 * A base-14 font's published widths for codes 32 to 126, as pdf-lib's metrics give them.
 *
 * @param {string} standard a `StandardFonts` value
 */
async function publishedWidths(standard) {
  const font = await (await PDFDocument.create()).embedFont(standard);
  return Array.from({ length: 95 }, (_, k) => font.widthOfTextAtSize(String.fromCharCode(32 + k), 1000));
}

/** @param {string} base @param {number[] | null} widths */
function type1(base, widths) {
  const metrics = widths === null ? '' : ` /FirstChar 32 /LastChar 126 /Widths [${widths.map((w) => String(Math.round(w))).join(' ')}]`;
  return `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding${metrics} >>`;
}

/**
 * Liberation Sans embedded as a TrueType font, its widths for codes 32 to 126 read from its own `hmtx` through its
 * own `cmap`, so the dictionary and the file agree.
 */
function embeddedTrueType() {
  const file = readFileSync(TRUETYPE);
  /** @type {Map<string, number>} */
  const tables = new Map();
  for (let k = 0; k < file.readUInt16BE(4); k += 1) tables.set(file.toString('latin1', 12 + 16 * k, 16 + 16 * k), file.readUInt32BE(20 + 16 * k));
  const at = (/** @type {string} */ tag) => {
    const offset = tables.get(tag);
    if (offset === undefined) throw new Error(`${TRUETYPE} has no ${tag} table`);
    return offset;
  };
  const unitsPerEm = file.readUInt16BE(at('head') + 18);
  const metrics = file.readUInt16BE(at('hhea') + 34);
  const advance = (/** @type {number} */ glyph) => file.readUInt16BE(at('hmtx') + 4 * Math.min(glyph, metrics - 1));
  // cmap: the (3, 1) subtable, format 4.
  const cmap = at('cmap');
  let sub = -1;
  for (let k = 0; k < file.readUInt16BE(cmap + 2); k += 1) {
    const row = cmap + 4 + 8 * k;
    if (file.readUInt16BE(row) === 3 && file.readUInt16BE(row + 2) === 1) sub = cmap + file.readUInt32BE(row + 4);
  }
  if (sub < 0 || file.readUInt16BE(sub) !== 4) throw new Error(`${TRUETYPE} has no (3, 1) format 4 cmap`);
  const segments = file.readUInt16BE(sub + 6) / 2;
  const ends = sub + 14;
  const starts = ends + 2 * segments + 2;
  const deltas = starts + 2 * segments;
  const ranges = deltas + 2 * segments;
  const glyphOf = (/** @type {number} */ code) => {
    for (let s = 0; s < segments; s += 1) {
      if (file.readUInt16BE(ends + 2 * s) < code) continue;
      const start = file.readUInt16BE(starts + 2 * s);
      if (start > code) return 0;
      const delta = file.readInt16BE(deltas + 2 * s);
      const range = file.readUInt16BE(ranges + 2 * s);
      if (range === 0) return (code + delta) & 0xffff;
      const glyph = file.readUInt16BE(ranges + 2 * s + range + 2 * (code - start));
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
  const widths = Array.from({ length: 95 }, (_, k) => Math.round((advance(glyphOf(32 + k)) * 1000) / unitsPerEm));
  const font =
    `<< /Type /Font /Subtype /TrueType /BaseFont /LiberationSans /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 126 ` +
    `/Widths [${widths.join(' ')}] /FontDescriptor 6 0 R >>`;
  const descriptor = Buffer.from(
    '<< /Type /FontDescriptor /FontName /LiberationSans /Flags 32 /FontBBox [-544 -303 1302 980] /ItalicAngle 0 ' +
      '/Ascent 905 /Descent -212 /CapHeight 729 /StemV 80 /FontFile2 7 0 R >>',
    'latin1',
  );
  const stream = Buffer.concat([Buffer.from(`<< /Length ${String(file.length)} /Length1 ${String(file.length)} >>\nstream\n`, 'latin1'), file, Buffer.from('\nendstream', 'latin1')]);
  return { font, extra: [descriptor, stream] };
}

/** @param {Uint8Array} bytes */
async function turned(bytes) {
  const document = await PDFDocument.load(bytes);
  for (const page of document.getPages()) page.setRotation(degrees((page.getRotation().angle + 90) % 360));
  return document.save();
}

// ---------------------------------------------------------------------------------------------------------------
// The drawing

/**
 * @typedef {{ c: string, x: number, y: number, first?: boolean }} Letter `first` marks a placed line's first letter,
 *   which sits on the line's origin as the page text's JSON gives it
 */

/**
 * The page in Chromium, PDF.js loaded from `pdfjs-dist` and served from disk, with the drawing calls recorded.
 *
 * @returns {Promise<{ version: string, draw: (bytes: Uint8Array) => Promise<Letter[]>, close: () => Promise<void> }>}
 */
async function drawingPage() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const tab = await browser.newPage();
  await tab.route('http://pdfjs.invalid/**', async (/** @type {any} */ route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (name === 'index.html') return route.fulfill({ body: '<!doctype html><title>glyph placement</title>', contentType: 'text/html' });
    if (!/^pdf(\.worker)?\.mjs$/u.test(name)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: readFileSync(join(PDFJS, name)), contentType: 'text/javascript' });
  });
  await tab.goto('http://pdfjs.invalid/index.html');
  /** @param {Uint8Array} bytes */
  const draw = (bytes) =>
    tab.evaluate(async (/** @type {number[]} */ data) => {
      // THE CALLBACK RUNS IN THE PAGE, so it reaches the page's globals through `globalThis`.
      const w = /** @type {any} */ (globalThis);
      // THE PAGE'S OWN URL for the module, which this script's compiler cannot and should not resolve.
      const pdfjs = /** @type {any} */ (await import(`${String(w.location.origin)}/pdf.mjs`));
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
      /** @type {{ c: string, x: number, y: number }[]} */
      const drawn = [];
      const proto = w.CanvasRenderingContext2D.prototype;
      const original = { fillText: proto.fillText, scale: proto.scale, transform: proto.transform };
      /** @type {{ x: number, y: number } | null} */
      let scaled = null;
      proto.fillText = function (/** @type {string} */ text, /** @type {number} */ x, /** @type {number} */ y, /** @type {any[]} */ ...rest) {
        scaled = null;
        const at = this.getTransform().transformPoint(new w.DOMPoint(x, y));
        drawn.push({ c: text, x: at.x, y: at.y });
        return original.fillText.call(this, text, x, y, ...rest);
      };
      proto.scale = function (/** @type {number} */ sx, /** @type {number} */ sy) {
        const m = this.getTransform();
        scaled = sx === sy ? { x: m.e, y: m.f } : null;
        return original.scale.call(this, sx, sy);
      };
      proto.transform = function (/** @type {number[]} */ ...m) {
        // A TYPE 3 GLYPH: `showType3Text` scales by the font size and transforms by the font matrix, back to back, at
        // the glyph's origin. The label is filled in from the operator list below.
        if (scaled !== null) drawn.push({ c: '\u0000', ...scaled });
        scaled = null;
        return original.transform.apply(this, m);
      };
      try {
        const task = pdfjs.getDocument({ data: new Uint8Array(data), useWorkerFetch: false, useWasm: false });
        const doc = await task.promise;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const canvas = w.document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        // EACH DRAWN GLYPH'S CHARACTER, from the operator list PDF.js drew from: `fillText` is handed the glyph's
        // `fontChar`, which for an embedded font PDF.js has loaded is a private-use code, so it is mapped to the glyph's
        // `unicode`; a `fontChar` two characters share is labelled as unknown, which leaves the fixture unpaired. Type 3
        // glyphs take their characters in drawing order.
        const list = await page.getOperatorList();
        /** @type {string[]} */
        const type3 = [];
        /** @type {Map<string, string>} */
        const named = new Map();
        list.fnArray.forEach((/** @type {number} */ fn, /** @type {number} */ k) => {
          if (fn !== pdfjs.OPS.showText) return;
          for (const glyph of list.argsArray[k][0]) {
            if (typeof glyph === 'number') continue;
            if (glyph.operatorListId !== undefined) type3.push(glyph.unicode);
            else named.set(glyph.fontChar, named.has(glyph.fontChar) && named.get(glyph.fontChar) !== glyph.unicode ? '\u0001' : glyph.unicode);
          }
        });
        let next = 0;
        for (const letter of drawn) letter.c = letter.c === '\u0000' ? (type3[next++] ?? '\u0001') : (named.get(letter.c) ?? letter.c);
        await task.destroy();
        return drawn;
      } finally {
        Object.assign(proto, original);
      }
    }, [...bytes]);
  return { version: browser.version(), draw, close: () => browser.close() };
}

// ---------------------------------------------------------------------------------------------------------------
// The engine

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<{ engine: Letter[], placed: Letter[], sizes: number[], fellBack: number, start: { x: number, y: number } | null }>}
 *   `start` is the first line's origin as the page text's JSON writes it
 */
async function engineLetters(bytes) {
  const session = await mupdfWriter.open(bytes);
  try {
    /** @type {Letter[]} */
    const engine = [];
    await withDocument(session, (document) => {
      const structured = document.loadPage(0).toStructuredText(WORD_BOX_READ_OPTIONS);
      try {
        structured.walk({
          onChar: (/** @type {string} */ c, /** @type {[number, number]} */ origin) => {
            engine.push({ c, x: origin[0], y: origin[1] });
          },
        });
      } finally {
        structured.destroy();
      }
    });
    const { json, letters, walked } = await readPageTextWithLetters(session, 0);
    const lines = linesOf(parsePageText(json));
    const texts = lines.slice(0, MAX_TEXT_LAYER_LINES).map((line) => line.text.slice(0, MAX_TEXT_LAYER_LINE));
    const placedLines = pageLetters(letters, texts, { page: 0, walked, json: lines.length }, () => undefined);
    /** @type {Letter[]} */
    const placed = [];
    let fellBack = 0;
    texts.forEach((text, at) => {
      const line = lines[at];
      const record = placedLines[at];
      if (line === undefined || record === undefined) {
        fellBack += 1;
        return;
      }
      let place = 0;
      for (let k = 0; k < text.length; k += 1) {
        placed.push({ c: text[k] ?? '', x: line.origin.x + (record.direction.x * place) / 100, y: line.origin.y + (record.direction.y * place) / 100, first: k === 0 });
        place += record.advances[k] ?? 0;
      }
    });
    const start = lines[0]?.origin;
    return { engine, placed, sizes: [...new Set(lines.map((line) => line.size))], fellBack, start: start === undefined ? null : { x: start.x, y: start.y } };
  } finally {
    await mupdfWriter.close(session);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The comparison

/**
 * Two lists of letters paired in order, spaces set aside: the distance of each pair, or why they could not be paired.
 *
 * @param {Letter[]} a @param {Letter[]} b
 * @returns {{ distances: number[], letters: string[], firsts: boolean[] } | { unpaired: string }}
 */
function pairs(a, b) {
  const visible = (/** @type {Letter[]} */ list) => list.filter((letter) => letter.c.trim() !== '');
  const left = visible(a);
  const right = visible(b);
  if (left.length !== right.length) return { unpaired: `${String(left.length)} letters against ${String(right.length)}` };
  const wrong = left.findIndex((letter, k) => letter.c !== right[k]?.c);
  if (wrong >= 0) return { unpaired: `letter ${String(wrong)} is ${JSON.stringify(left[wrong]?.c)} against ${JSON.stringify(right[wrong]?.c)}` };
  return {
    distances: left.map((letter, k) => Math.hypot(letter.x - (right[k]?.x ?? NaN), letter.y - (right[k]?.y ?? NaN))),
    letters: left.map((letter) => letter.c),
    firsts: left.map((letter) => letter.first === true),
  };
}

/** @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((x, y) => x - y);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? NaN) : ((sorted[middle - 1] ?? NaN) + (sorted[middle] ?? NaN)) / 2;
}

/** The pairs of the long line's letters: the last 80 visible letters' run, found by its text. */
function longLineRange(/** @type {string[]} */ letters) {
  const wanted = LONG.replace(/\s/gu, '');
  const joined = letters.join('');
  const start = joined.indexOf(wanted);
  return start < 0 ? null : { start, end: start + wanted.length };
}

/**
 * @param {ReturnType<typeof pairs>} paired
 */
function summary(paired) {
  if ('unpaired' in paired) return { unpaired: paired.unpaired };
  const range = longLineRange(paired.letters);
  const long = range === null ? null : paired.distances.slice(range.start, range.end);
  return {
    letters: paired.distances.length,
    median: Number(median(paired.distances).toFixed(3)),
    worst: Number(Math.max(...paired.distances).toFixed(3)),
    worstOnLongLine: long === null ? null : Number(Math.max(...long).toFixed(3)),
    ...(paired.firsts.some(Boolean) ? { worstLineStart: Number(Math.max(...paired.distances.filter((_, k) => paired.firsts[k])).toFixed(3)) } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The run

const out = process.stdout;
const page = await drawingPage();
try {
  out.write(`# Where PDF.js draws each glyph against where MuPDF reads the letter\n\n  Chromium ${page.version}\n\n`);

  // THE POSITIVE CONTROL: one H at (100, 700) in a 612 x 792 page, upright and turned 90 degrees.
  const courier = type1('Courier', null);
  for (const [rotate, expected] of /** @type {const} */ ([
    [0, { x: 100, y: 92 }],
    [90, { x: 700, y: 100 }],
  ])) {
    const bytes = pdfOf({ font: courier, lines: [{ x: 100, y: 700, text: 'H' }], rotate });
    const drawn = (await page.draw(bytes)).filter((letter) => letter.c.trim() !== '');
    const { engine } = await engineLetters(bytes);
    const found = drawn.length === 1 && drawn[0]?.c === 'H' && Math.hypot((drawn[0]?.x ?? NaN) - expected.x, (drawn[0]?.y ?? NaN) - expected.y) < 0.01;
    const read = engine.length === 1 && Math.hypot((engine[0]?.x ?? NaN) - expected.x, (engine[0]?.y ?? NaN) - expected.y) < 0.01;
    if (!found || !read) {
      throw new Error(`CONTROL FAILED at ${String(rotate)} degrees: the H at ${JSON.stringify(expected)} was drawn at ${JSON.stringify(drawn)} and read at ${JSON.stringify(engine)}.`);
    }
    out.write(`  control, ${String(rotate)} degrees: the H drawn once at (${String(drawn[0]?.x)}, ${String(drawn[0]?.y)}), read at (${String(engine[0]?.x)}, ${String(engine[0]?.y)})\n`);
  }

  // THE RESOLUTION TEST: the same Courier page set 0.25 pt to the right.
  {
    const a = pdfOf({ font: courier, lines: linesAt(0) });
    const b = pdfOf({ font: courier, lines: linesAt(0.25) });
    const drawnA = await page.draw(a);
    const drawnB = await page.draw(b);
    const drawnAgain = await page.draw(a);
    const engineA = (await engineLetters(a)).engine;
    const engineB = (await engineLetters(b)).engine;
    const shift = pairs(drawnA, drawnB);
    const still = pairs(drawnA, drawnAgain);
    const engineShift = pairs(engineA, engineB);
    const same = pairs(drawnA, engineA);
    const moved = pairs(drawnB, engineA);
    for (const [name, result, want] of /** @type {const} */ ([
      ['drawn A against drawn B', shift, 0.25],
      ['drawn A against itself', still, 0],
      ['engine A against engine B', engineShift, 0.25],
    ])) {
      if ('unpaired' in result) throw new Error(`RESOLUTION TEST FAILED: ${name} could not be paired: ${result.unpaired}`);
      const off = Math.max(...result.distances.map((d) => Math.abs(d - want)));
      if (!(off < 0.01)) throw new Error(`RESOLUTION TEST FAILED: ${name} should differ by ${String(want)} pt for every letter and is off by up to ${off.toFixed(4)}.`);
      out.write(`  resolution, ${name}: ${String(result.distances.length)} letters, each ${String(want)} pt within ${off.toFixed(4)}\n`);
    }
    if ('unpaired' in same || 'unpaired' in moved) throw new Error('RESOLUTION TEST FAILED: drawn against engine could not be paired.');
    const separation = median(moved.distances) - median(same.distances);
    if (!(Math.abs(separation - 0.25) < 0.01)) throw new Error(`RESOLUTION TEST FAILED: moving the drawing 0.25 pt moved the median distance by ${separation.toFixed(4)}.`);
    out.write(`  resolution, drawn against engine: median ${median(same.distances).toFixed(4)} pt, and ${median(moved.distances).toFixed(4)} with the drawing moved 0.25 pt\n\n`);
  }

  // THE FIXTURES.
  const times = await publishedWidths(StandardFonts.TimesRoman);
  const truetype = embeddedTrueType();
  /** @type {[string, Uint8Array][]} */
  const fixtures = [
    ['Times-Roman, no /Widths', pdfOf({ font: type1('Times-Roman', null), lines: linesAt() })],
    ['Times-Roman, published /Widths', pdfOf({ font: type1('Times-Roman', times), lines: linesAt() })],
    ['Helvetica, no /Widths', pdfOf({ font: type1('Helvetica', null), lines: linesAt() })],
    ['Courier, no /Widths', pdfOf({ font: courier, lines: linesAt() })],
    ['TrueType embedded (Liberation Sans)', pdfOf({ font: truetype.font, extra: truetype.extra, lines: linesAt() })],
    ['chromium-type3.pdf', new Uint8Array(readFileSync(CHROMIUM_TYPE3))],
  ];
  // THE LINE'S ORIGIN AS EACH ANSWER HOLDS IT, for the first fixture's first line: the JSON's and the engine's.
  {
    const [, first] = fixtures[0] ?? [];
    if (first !== undefined) {
      const { engine, start } = await engineLetters(first);
      out.write(`  first line's origin: the page text's JSON (${String(start?.x)}, ${String(start?.y)}), the engine (${String(engine[0]?.x)}, ${String(engine[0]?.y)})\n\n`);
    }
  }
  /** @param {ReturnType<typeof summary>} s */
  const cell = (s) =>
    'unpaired' in s
      ? `unpaired: ${String(s.unpaired)}`
      : `${s.median.toFixed(3)} / ${s.worst.toFixed(3)} / ${s.worstOnLongLine === null ? '-' : s.worstOnLongLine.toFixed(3)}${s.worstLineStart === undefined ? '' : ` / ${s.worstLineStart.toFixed(3)}`}`;
  out.write('  per fixture, in points: median / worst per letter / worst on the 80-letter line [/ worst line start]\n\n');
  out.write('| fixture | size | drawn against placed | drawn against engine | placed against engine | lines fell back |\n|---|---|---|---|---|---|\n');
  for (const [name, bytes] of fixtures) {
    for (const [label, pdf] of /** @type {const} */ ([
      [name, bytes],
      [`${name}, turned 90`, await turned(bytes)],
    ])) {
      const drawn = await page.draw(pdf);
      const { engine, placed, sizes, fellBack } = await engineLetters(pdf);
      const row = [label, sizes.join(', '), cell(summary(pairs(drawn, placed))), cell(summary(pairs(drawn, engine))), cell(summary(pairs(placed, engine))), String(fellBack)];
      out.write(`| ${row.join(' | ')} |\n`);
    }
  }
} finally {
  await page.close();
}
