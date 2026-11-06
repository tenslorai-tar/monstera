// @ts-check
/**
 * How far a glyph's ink reaches past the box MuPDF's burn-in judges it by, in ordinary fonts, and what a mark that
 * meets only a letter's edge does (ADR-0286's open finding, the owner's questions of 2026-11-06).
 *
 *   node scripts/research/glyphOverhang.mjs
 *
 * ## The two boxes
 *
 * - THE JUDGED BOX is what `pdf_redact_text_filter` (source/pdf/pdf-clean.c) tests against a mark: the glyph's
 *   advance box, x from the origin to the advance, y from the font's descender to its ascender, then shrunk by a tenth
 *   of its width and height on each side. It is read here from MuPDF's own structured text, whose default character
 *   quad is built from the same ascender, descender and advance (source/fitz/stext-device.c, the non-accurate branch),
 *   and shrunk the filter's way. Reading it from MuPDF keeps this from being a second opinion about the box.
 * - THE INK is the glyph's rendered pixels: each glyph is drawn alone at 100 points and rendered at 1 pixel a point,
 *   so a pixel is a hundredth of an em, and the ink box is every pixel darker than 250 of 255.
 *
 * ## The fonts
 *
 * Each is embedded by MuPDF itself (`addSimpleFont`), so a TrueType file is FontFile2, a Type 1 file FontFile and a CFF
 * one FontFile3. The files are the container's own (`/usr/share/fonts`) and MuPDF's built-in base-14 faces, which are
 * CFF. Every printable ASCII character is measured.
 *
 * ## The edge mark
 *
 * For a few letters, a mark covering only the right part of the letter's UNSHRUNK box, k% of its width, full height,
 * burned in through the app's two calls (`cutLineArt`, then `applyRedactions` with line art left alone): does the
 * letter stay, and what share of its ink lay under the mark? The filter's tenth predicts the edge at k = 10.
 *
 * It prints tables; nothing is a pass or a fail.
 */
import { existsSync, readFileSync } from 'node:fs';

import { NATIVE_ENGINE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';

const ROOT = repoRoot();
refuseStaleBuild(ROOT, NATIVE_ENGINE, 1);
if (bindNativeEngine(ROOT) === null) throw new Error('the MuPDF shim is not built here');
// A LITERAL SPECIFIER, the one `nativeEngine.mjs` binds, so the import scans can read what this loads.
const mupdf = await import('../../packages/kernel/dist/mupdfRaw.js');

const { PDFDocument: LibDocument, PDFName } = await import('@cantoo/pdf-lib');

const SIZE = 100;
const ORIGIN = { x: 100, y: 200 };
/** @type {[number, number, number, number]} */
const PAGE = [0, 0, 400, 300];

/** @type {{ name: string, kind: string, load: () => InstanceType<typeof mupdf.Font> }[]} */
const FONTS = [];
/** @param {string} name @param {string} kind @param {string} path */
function file(name, kind, path) {
  if (existsSync(path)) FONTS.push({ name, kind, load: () => new mupdf.Font(name, readFileSync(path)) });
  else process.stdout.write(`NOT MEASURED, no file: ${name} (${path})\n`);
}
file('Liberation Serif', 'TrueType', '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf');
file('Liberation Serif Italic', 'TrueType', '/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf');
file('FreeSans Oblique', 'TrueType', '/usr/share/fonts/truetype/freefont/FreeSansOblique.ttf');
file('Bitstream Charter', 'Type 1', '/usr/share/fonts/X11/Type1/c0648bt_.pfb');
file('Bitstream Charter Italic', 'Type 1', '/usr/share/fonts/X11/Type1/c0649bt_.pfb');
file('Inter Italic', 'CFF (OpenType)', '/usr/share/fonts/opentype/inter/Inter-Italic.otf');
for (const [name, base] of /** @type {const} */ ([
  ['Nimbus Roman (Times-Roman)', 'Times-Roman'],
  ['Nimbus Roman Italic (Times-Italic)', 'Times-Italic'],
  ['Nimbus Sans Oblique (Helvetica-Oblique)', 'Helvetica-Oblique'],
]))
  FONTS.push({ name, kind: 'CFF (MuPDF built-in)', load: () => new mupdf.Font(base) });

/** A one-page PDF drawing `text` in `font` at the origin, embedded by MuPDF. */
function pageWith(/** @type {InstanceType<typeof mupdf.Font>} */ font, /** @type {string} */ text) {
  const document = new mupdf.PDFDocument();
  const resources = document.addObject({ Font: { F: document.addSimpleFont(font, 'Latin') } });
  const escaped = text.replace(/[\\()]/gu, (c) => `\\${c}`);
  const content = `BT /F ${String(SIZE)} Tf ${String(ORIGIN.x)} ${String(ORIGIN.y)} Td (${escaped}) Tj ET`;
  document.insertPage(-1, document.addPage(PAGE, 0, resources, content));
  const bytes = document.saveToBuffer('').asUint8Array().slice();
  document.destroy();
  return bytes;
}

/** @param {Uint8Array} bytes */
function open(bytes) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
  return document;
}

/** The first character's quad on page 0, in MuPDF page space (y down), and the characters read. */
function charBoxes(/** @type {any} */ page) {
  /** @type {{ c: string, quad: number[] }[]} */
  const out = [];
  page.toStructuredText('').walk({
    onChar: (/** @type {string} */ c, /** @type {unknown} */ _o, /** @type {unknown} */ _f, /** @type {unknown} */ _s, /** @type {number[][]} */ quad) =>
      out.push({ c, quad: quad.flat() }),
  });
  return out;
}

/** Ink box (page space, y down) of everything darker than 250, rendered at 1 px a point, or null when blank. */
function inkOf(/** @type {any} */ page, /** @type {number[] | undefined} */ within) {
  const pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, false);
  const w = pixmap.getWidth();
  const h = pixmap.getHeight();
  const stride = pixmap.getStride();
  const px = pixmap.getPixels();
  let [x0, y0, x1, y1, n, inside] = [Infinity, Infinity, -Infinity, -Infinity, 0, 0];
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const at = y * stride + x * 3;
      if ((px[at] ?? 255) < 250 || (px[at + 1] ?? 255) < 250 || (px[at + 2] ?? 255) < 250) {
        n += 1;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, y + 1);
        if (within !== undefined && x + 0.5 >= (within[0] ?? 0) && x + 0.5 <= (within[2] ?? 0) && y + 0.5 >= (within[1] ?? 0) && y + 0.5 <= (within[3] ?? 0)) inside += 1;
      }
    }
  pixmap.destroy();
  return n === 0 ? null : { box: [x0, y0, x1, y1], pixels: n, inside };
}

/** The quad's axis box: [x0, y0, x1, y1]. */
const boxOf = (/** @type {number[]} */ q) => [
  Math.min(q[0] ?? 0, q[4] ?? 0),
  Math.min(q[1] ?? 0, q[3] ?? 0),
  Math.max(q[2] ?? 0, q[6] ?? 0),
  Math.max(q[5] ?? 0, q[7] ?? 0),
];

const PRINTABLE = Array.from({ length: 126 - 33 + 1 }, (_, at) => String.fromCharCode(33 + at));

process.stdout.write('\nINK PAST THE JUDGED BOX, in hundredths of an em (1 = 1 pixel at 100 pt)\n');
process.stdout.write('font | kind | glyphs | most past the advance box (glyph: left, right) | most past the shrunk box | glyphs inked past the shrunk box\n');
for (const { name, kind, load } of FONTS) {
  const font = load();
  let worst = { c: '', past: 0, left: 0, right: 0 };
  let worstShrunk = { c: '', past: 0 };
  let pastShrunk = 0;
  let measured = 0;
  for (const c of PRINTABLE) {
    const document = open(pageWith(font, c));
    const page = document.loadPage(0);
    const chars = charBoxes(page);
    const ink = inkOf(page, undefined);
    document.destroy();
    const first = chars[0];
    if (first === undefined || ink === null) continue;
    measured += 1;
    const [bx0 = 0, by0 = 0, bx1 = 0, by1 = 0] = boxOf(first.quad);
    const [ix0 = 0, iy0 = 0, ix1 = 0, iy1 = 0] = ink.box;
    const left = Math.max(0, bx0 - ix0);
    const right = Math.max(0, ix1 - bx1);
    const vertical = Math.max(0, by0 - iy0, iy1 - by1);
    const past = Math.max(left, right, vertical);
    if (past > worst.past) worst = { c, past, left, right };
    const w = bx1 - bx0;
    const h = by1 - by0;
    const shrunk = Math.max(bx0 + w / 10 - ix0, ix1 - (bx1 - w / 10), by0 + h / 10 - iy0, iy1 - (by1 - h / 10), 0);
    if (shrunk > 0.5) pastShrunk += 1;
    if (shrunk > worstShrunk.past) worstShrunk = { c, past: shrunk };
  }
  process.stdout.write(
    `${name} | ${kind} | ${String(measured)} | ${worst.c}: ${worst.left.toFixed(0)}, ${worst.right.toFixed(0)} | ${worstShrunk.c}: ${worstShrunk.past.toFixed(1)} | ${String(pastShrunk)}\n`,
  );
}

process.stdout.write('\nA MARK OVER THE RIGHT k% OF A LETTER\'S ADVANCE BOX, full height, burned in with a filled box\n');
process.stdout.write('font | letter | k | letter after | its ink under the mark, before\n');
const EDGE = [
  ['Liberation Serif', 'o'],
  ['Liberation Serif Italic', 'f'],
  ['Bitstream Charter Italic', 'f'],
  ['Nimbus Roman Italic (Times-Italic)', 'f'],
  ['Inter Italic', 'W'],
];
for (const [fontName, letter] of EDGE) {
  const entry = FONTS.find((each) => each.name === fontName);
  if (entry === undefined || letter === undefined) continue;
  const font = entry.load();
  const bytes = pageWith(font, letter);
  for (const k of [5, 9, 10, 11, 15, 30]) {
    const document = open(bytes);
    try {
      const page = document.loadPage(0);
      const [bx0 = 0, by0 = 0, bx1 = 0, by1 = 0] = boxOf(charBoxes(page)[0]?.quad ?? []);
      /** @type {[number, number, number, number]} */
      const mark = [bx1 - ((bx1 - bx0) * k) / 100, by0 - 1, bx1 + 2, by1 + 1];
      const before = inkOf(page, mark);
      const annotation = page.createAnnotation('Redact');
      annotation.setRect(mark);
      annotation.update();
      mupdf.cutLineArt(page);
      page.applyRedactions(true, 2, 0, 0);
      const after = charBoxes(page).map((each) => each.c).join('');
      const share = before === null ? 0 : (100 * before.inside) / before.pixels;
      process.stdout.write(`${fontName} | ${letter} | ${String(k)} | ${after === '' ? 'REMOVED' : `stays (${after})`} | ${share.toFixed(1)}%\n`);
    } finally {
      document.destroy();
    }
  }
}

// ---------------------------------------------------------------- the open case, with the filled box
//
// redactionLineArt.test.ts's OPEN case: a Type 3 glyph that advances 20 points and draws 60, shown at x 60 beside a mark
// from x 92. Its glyph is named A, so text extraction can say what letter it is. Burned in with the dialog's default,
// a filled box, saved and reopened; then read three ways.
process.stdout.write('\nTHE OPEN CASE WITH THE FILLED BOX (Type 3, advance 20 pt, ink 60 pt, mark from x 92)\n');
{
  const lib = await LibDocument.create();
  const sheet = lib.addPage([612, 460]);
  const glyph = lib.context.register(lib.context.stream('1000 0 0 0 100 100 d1 0 0 3000 1000 re f'));
  const t3 = lib.context.obj({
    Type: 'Font',
    Subtype: 'Type3',
    FontBBox: [0, 0, 100, 100],
    FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    CharProcs: { A: glyph },
    Encoding: { Type: 'Encoding', Differences: [65, PDFName.of('A')] },
    FirstChar: 65,
    LastChar: 65,
    Widths: [1000],
    Resources: {},
  });
  sheet.node.set(PDFName.of('Resources'), lib.context.obj({ Font: { T3: t3 } }));
  sheet.node.set(PDFName.of('Contents'), lib.context.register(lib.context.stream('BT /T3 20 Tf 60 60 Td (A) Tj ET')));
  const bytes = await lib.save({ useObjectStreams: false });
  // THE MARK in user space x 92..278, y 42..98; MuPDF's page space has y down from the top of the 460 pt page.
  /** @type {[number, number, number, number]} */
  const mark = [92, 460 - 98, 278, 460 - 42];
  const document = open(bytes);
  let saved;
  try {
    const page = document.loadPage(0);
    const annotation = page.createAnnotation('Redact');
    annotation.setRect(mark);
    annotation.update();
    mupdf.cutLineArt(page);
    page.applyRedactions(true, 2, 0, 0);
    saved = document.saveToBuffer('').asUint8Array().slice();
  } finally {
    document.destroy();
  }
  const again = open(saved);
  try {
    const page = again.loadPage(0);
    // 1. RENDERED AS SAVED, at 1 px a point: is any pixel inside the mark other than the box's black?
    const pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, false);
    const [w, stride, px] = [pixmap.getWidth(), pixmap.getStride(), pixmap.getPixels()];
    let notBox = 0;
    let insideCount = 0;
    for (let y = Math.ceil(mark[1] ?? 0); y < Math.floor(mark[3] ?? 0); y += 1)
      for (let x = Math.ceil(mark[0] ?? 0); x < Math.floor(mark[2] ?? 0) && x < w; x += 1) {
        insideCount += 1;
        const at = y * stride + x * 3;
        if ((px[at] ?? 0) > 5 || (px[at + 1] ?? 0) > 5 || (px[at + 2] ?? 0) > 5) notBox += 1;
      }
    pixmap.destroy();
    process.stdout.write(`rendered as saved: ${String(notBox)} of ${String(insideCount)} pixels inside the mark are not the box's black\n`);
    // 2. THE PAGE'S CONTENT, as text: the glyph is still shown, and the box is drawn over it.
    const contents = page.getObject().get('Contents');
    const streams = contents.isArray() ? Array.from({ length: contents.length }, (_, at) => contents.get(at)) : [contents];
    const text = streams.map((stream) => stream.readStream().asString()).join('\n');
    process.stdout.write(`saved content: ${text.replace(/\s+/gu, ' ').trim()}\n`);
    // 3. TEXT EXTRACTION from the saved page.
    process.stdout.write(`extracted text: ${JSON.stringify(charBoxes(page).map((each) => each.c).join(''))}\n`);
  } finally {
    again.destroy();
  }
  // 4. THE BOX TAKEN AWAY: the same saved page with its content's last filled path (the box) removed, rendered.
  const stripped = open(saved);
  try {
    const page = stripped.loadPage(0);
    const contents = page.getObject().get('Contents');
    const streams = contents.isArray() ? Array.from({ length: contents.length }, (_, at) => contents.get(at)) : [contents];
    const last = streams[streams.length - 1];
    if (last === undefined) throw new Error('the saved page has no content stream');
    const text = last.readStream().asString();
    // MuPDF writes the box as `0 g x y m … l f` after the page's own content.
    const cut = text.replace(/0 g\s+[-\d.]+ [-\d.]+ m(\s+[-\d.]+ [-\d.]+ l)+\s+f\s*$/u, '');
    if (cut === text) throw new Error(`no box found to take away in: ${text}`);
    last.writeStream(cut);
    const ink = inkOf(page, mark);
    process.stdout.write(`with the box taken away: ${String(ink?.inside ?? 0)} pixels painted inside the mark\n`);
  } finally {
    stripped.destroy();
  }
}
