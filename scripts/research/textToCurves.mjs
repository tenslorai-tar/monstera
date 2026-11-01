// @ts-check
/**
 * What turning every letter into curves costs and keeps (ADR-0282, Proposed): Ghostscript's `pdfwrite` with
 * `-dNoOutputFonts` on six generated or committed fixtures, each read before and after. A research instrument, run by
 * hand; it prints readings and no verdict.
 *
 * The fixtures: an ordinary page (two standard fonts, not embedded), a dense page (56 lines of 96 letters), the committed
 * Chromium print (`chromium-type3.pdf`: a Type 3 heading beside embedded subsets), a form (a text field with a value, a
 * ticked box, a list with a choice), a page with annotations (a highlight, a note, a link) and two bookmarks, and a page
 * with an attachment, a layer, a title and a tag tree.
 *
 * Each is read for: fonts anywhere in the file (every `/Type /Font` object, appearance streams' included); the letters
 * MuPDF can extract; annotations by kind, form fields and widgets, the link's address, bookmarks; the extras; and each
 * page drawn by MuPDF at 100 and 300 dpi before and after, as the share of pixels differing past 32, 64, 128 and 192
 * levels, and how many of those past 64 sit INSIDE a letter (all four neighbours inked in the original) rather than at
 * its edge, which tells a changed shape from a changed anti-aliasing.
 *
 * Usage: node scripts/research/textToCurves.mjs --gs <ghostscript> [--out <dir>]
 * The Ghostscript is the one to measure: on Windows the provisioned `gswin64c.exe` (`scripts/provision/ghostscript.mjs`);
 * elsewhere a build of the same version, stated as such. Uncontained: the contained run is the product's (ADR-0075).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts, rgb } from '@cantoo/pdf-lib';

import { NATIVE_ENGINE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';

const ROOT = repoRoot();
// THE ONE BUILD IT READS, the MuPDF object model it draws and reads pages with: a stale one would answer for yesterday's.
refuseStaleBuild(ROOT, NATIVE_ENGINE, 1);
const argument = (/** @type {string} */ name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};
const GS = argument('--gs');
if (GS === undefined) throw new Error('--gs names no Ghostscript to measure');
const OUT = argument('--out') ?? mkdtempSync(join(tmpdir(), 'text-to-curves-'));
mkdirSync(OUT, { recursive: true });
if (bindNativeEngine(ROOT) === null) throw new Error('the MuPDF shim is not built here: the pages cannot be drawn');
const mupdf = await import('../../packages/kernel/dist/mupdfRaw.js');

const WORDS = ['agreement', 'party', 'notice', 'term', 'clause', 'shall', 'the', 'of', 'any', 'such', 'provided', 'that'];
const line = (/** @type {number} */ seed) => {
  let text = '';
  let at = seed * 7;
  while (text.length < 96) text += `${WORDS[(at += 5) % WORDS.length] ?? 'word'} `;
  return text.slice(0, 96);
};

/** @returns {Promise<Uint8Array>} */
async function ordinary() {
  const document = await PDFDocument.create();
  const helvetica = await document.embedFont(StandardFonts.Helvetica);
  const times = await document.embedFont(StandardFonts.TimesRoman);
  const page = document.addPage([612, 792]);
  page.drawText('A heading in Helvetica', { x: 72, y: 720, size: 20, font: helvetica });
  for (let at = 0; at < 8; at += 1) page.drawText(line(at).slice(0, 80), { x: 72, y: 690 - at * 14, size: 11, font: times });
  page.drawRectangle({ x: 72, y: 500, width: 200, height: 30, color: rgb(0.2, 0.4, 0.8) });
  return document.save();
}

/** @returns {Promise<Uint8Array>} */
async function dense() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.TimesRoman);
  const page = document.addPage([612, 792]);
  for (let at = 0; at < 56; at += 1) page.drawText(line(at), { x: 54, y: 744 - at * 12.6, size: 10, font });
  return document.save();
}

/** @returns {Promise<Uint8Array>} */
async function form() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  page.drawText('Name:', { x: 72, y: 700, size: 12, font });
  const fields = document.getForm();
  const name = fields.createTextField('name');
  name.setText('Ada Lovelace');
  name.addToPage(page, { x: 130, y: 692, width: 200, height: 20 });
  const agree = fields.createCheckBox('agree');
  agree.addToPage(page, { x: 72, y: 650, width: 14, height: 14 });
  agree.check();
  const colour = fields.createDropdown('colour');
  colour.addOptions(['Red', 'Green', 'Blue']);
  colour.select('Green');
  colour.addToPage(page, { x: 130, y: 600, width: 120, height: 20 });
  fields.updateFieldAppearances(font);
  return document.save();
}

/** @returns {Promise<Uint8Array>} */
async function annotations() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  page.drawText('Highlighted words and a link to the site.', { x: 72, y: 700, size: 14, font });
  const context = document.context;
  const highlight = context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [72, 696, 260, 714], QuadPoints: [72, 714, 260, 714, 72, 696, 260, 696], C: [1, 1, 0], Contents: PDFString.of('a highlight') });
  const note = context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [400, 690, 420, 710], Contents: PDFString.of('a sticky note'), Name: 'Comment' });
  const link = context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [280, 696, 400, 714], Border: [0, 0, 0], A: context.obj({ S: 'URI', URI: PDFString.of('https://example.org/') }) });
  page.node.set(PDFName.of('Annots'), context.obj([context.register(highlight), context.register(note), context.register(link)]));
  const outlines = context.nextRef();
  const first = context.nextRef();
  const second = context.nextRef();
  const target = [page.ref, PDFName.of('XYZ'), 0, 792, 0];
  context.assign(first, context.obj({ Title: PDFString.of('First'), Parent: outlines, Next: second, Dest: target }));
  context.assign(second, context.obj({ Title: PDFString.of('Second'), Parent: outlines, Prev: first, Dest: target }));
  context.assign(outlines, context.obj({ Type: 'Outlines', First: first, Last: second, Count: 2 }));
  document.catalog.set(PDFName.of('Outlines'), outlines);
  return document.save();
}

/** @returns {Promise<Uint8Array>} */
async function extras() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  page.drawText('A page with an attachment, a layer and tags.', { x: 72, y: 700, size: 14, font });
  document.setTitle('Extras fixture');
  await document.attach(new TextEncoder().encode('attached words'), 'note.txt', { mimeType: 'text/plain' });
  const context = document.context;
  const layer = context.register(context.obj({ Type: 'OCG', Name: PDFString.of('Layer one') }));
  document.catalog.set(PDFName.of('OCProperties'), context.obj({ OCGs: [layer], D: context.obj({ ON: [layer] }) }));
  document.catalog.set(PDFName.of('StructTreeRoot'), context.register(context.obj({ Type: 'StructTreeRoot' })));
  document.catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }));
  return document.save();
}

/** What a file holds. @param {Uint8Array} bytes */
async function census(bytes) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  let fonts = 0;
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    /** @type {any} */
    const any = object;
    const dict = any instanceof PDFDict ? any : any?.dict instanceof PDFDict ? any.dict : null;
    if (dict?.get(PDFName.of('Type'))?.toString() === '/Font') fonts += 1;
  }
  /** @type {Record<string, number>} */
  const annots = {};
  /** @type {string[]} */
  const links = [];
  for (const page of document.getPages()) {
    const list = page.node.lookup(PDFName.of('Annots'));
    if (!(list instanceof PDFArray)) continue;
    for (let at = 0; at < list.size(); at += 1) {
      /** @type {any} */
      const annot = list.lookup(at);
      const kind = String(annot?.get?.(PDFName.of('Subtype')) ?? '?');
      annots[kind] = (annots[kind] ?? 0) + 1;
      if (kind === '/Link') links.push(String(annot.lookup(PDFName.of('A'))?.lookup(PDFName.of('URI'))?.decodeText?.() ?? 'no address'));
    }
  }
  const fields = document.getForm().getFields().map((field) => field.getName());
  let bookmarks = 0;
  const outlines = document.catalog.lookup(PDFName.of('Outlines'));
  /** @type {any} */
  let item = outlines instanceof PDFDict ? outlines.lookup(PDFName.of('First')) : undefined;
  while (item instanceof PDFDict && bookmarks < 1000) {
    bookmarks += 1;
    item = item.lookup(PDFName.of('Next'));
  }
  const names = document.catalog.lookup(PDFName.of('Names'));
  const engine = mupdf.Document.openDocument(bytes, 'application/pdf');
  let letters = 0;
  for (let at = 0; at < engine.countPages(); at += 1) letters += engine.loadPage(at).toStructuredText('').asText().replace(/\s/gu, '').length;
  return {
    fonts,
    letters,
    annots,
    links,
    fields,
    bookmarks,
    attachments: names instanceof PDFDict && names.lookup(PDFName.of('EmbeddedFiles')) !== undefined,
    layers: document.catalog.lookup(PDFName.of('OCProperties')) !== undefined,
    tags: document.catalog.lookup(PDFName.of('StructTreeRoot')) !== undefined,
    title: document.getTitle() ?? null,
  };
}

/** Page 0 before and after at `dpi`, in grey. @param {Uint8Array} before @param {Uint8Array} after @param {number} dpi */
function pixels(before, after, dpi) {
  const scale = dpi / 72;
  const draw = (/** @type {Uint8Array} */ bytes) => {
    const pixmap = mupdf.Document.openDocument(bytes, 'application/pdf').loadPage(0).toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceGray, false, true);
    return { pixels: pixmap.getPixels(), width: pixmap.getWidth() };
  };
  const a = draw(before);
  const b = draw(after);
  if (a.pixels.length !== b.pixels.length) return { sizes: [a.pixels.length, b.pixels.length] };
  /** @type {Record<string, number>} */
  const past = { 32: 0, 64: 0, 128: 0, 192: 0 };
  let inside = 0;
  for (let at = 0; at < a.pixels.length; at += 1) {
    const d = Math.abs((a.pixels[at] ?? 0) - (b.pixels[at] ?? 0));
    for (const threshold of Object.keys(past)) if (d > Number(threshold)) past[threshold] = (past[threshold] ?? 0) + 1;
    if (d > 64 && [at - 1, at + 1, at - a.width, at + a.width].every((each) => (a.pixels[each] ?? 255) < 64)) inside += 1;
  }
  const share = (/** @type {number} */ count) => Number(((100 * count) / a.pixels.length).toFixed(3));
  return { dpi, past32: share(past[32] ?? 0), past64: share(past[64] ?? 0), past128: share(past[128] ?? 0), past192: share(past[192] ?? 0), insideOfPast64: (past[64] ?? 0) === 0 ? 0 : Number(((100 * inside) / (past[64] ?? 1)).toFixed(1)) };
}

/** @type {Record<string, Uint8Array>} */
const fixtures = {
  ordinary: await ordinary(),
  dense: await dense(),
  type3: new Uint8Array(readFileSync(join(ROOT, 'packages', 'testing', 'fixtures', 'text-edit', 'chromium-type3.pdf'))),
  form: await form(),
  annotations: await annotations(),
  extras: await extras(),
};
for (const [name, bytes] of Object.entries(fixtures)) {
  const input = join(OUT, `${name}.pdf`);
  const output = join(OUT, `${name}-curves.pdf`);
  writeFileSync(input, bytes);
  const started = performance.now();
  const run = spawnSync(GS, ['-dBATCH', '-dNOPAUSE', '-dSAFER', '-sDEVICE=pdfwrite', '-dNoOutputFonts', `-sOutputFile=${output}`, '-f', input], { encoding: 'utf8' });
  const ms = Math.round(performance.now() - started);
  if (run.status !== 0) {
    process.stdout.write(`${name}: Ghostscript exited ${String(run.status)}\n`);
    continue;
  }
  const after = new Uint8Array(readFileSync(output));
  process.stdout.write(
    `${JSON.stringify({
      name,
      ms,
      bytes: [statSync(input).size, statSync(output).size],
      before: await census(bytes),
      after: await census(after),
      drawn: [pixels(bytes, after, 100), pixels(bytes, after, 300)],
      // WHAT GHOSTSCRIPT SAID: every line of its output, since a removal it does not announce is the finding.
      said: `${run.stdout}${run.stderr}`.split('\n').filter((each) => each.trim() !== '').slice(0, 6),
    })}\n`,
  );
}
