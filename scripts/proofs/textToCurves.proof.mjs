// @ts-check
/**
 * *Convert text to curves* holds what ADR-0282 Decision 6 says it holds, with a real Ghostscript:
 *
 * 1. NO FONT LEFT: the kernel's census finds no font dictionary anywhere in any copy, appearances included.
 * 2. THE PAGES LOOK THE SAME: every page of every copy, drawn by MuPDF at 300 dpi in grey beside its original, has no
 *    pixel past 192 levels, at most 0.5% of its pixels past 128, and at most 1% of those past 64 inside a letter.
 * 3. THE ORIGINAL IS UNCHANGED: the input file's SHA-256 is the same after the converter ran.
 * 4. THE REPORT IS TRUE: the form fixture's census reports its three fields lost, and the copy's counts agree with a
 *    second reader (pdf-lib); the annotation fixture reports nothing lost.
 *
 * Each has a control that must fail: a copy written by plain `pdfwrite`, fonts kept; a copy of the page with one word
 * removed; a run that writes over its own input; and the census of an unconverted form, where nothing fell.
 *
 * The converter is run with the product's own arguments (`curvesArguments`) and counted with the product's own census
 * (`keptCensusOf`, `lostBetween`), UNCONTAINED: the containment is PDF/A's, proven by its own proofs. Ghostscript is
 * not provisioned on CI, so a run without one is a could-not-look, never a pass.
 *
 * Usage: node scripts/proofs/textToCurves.proof.mjs [--gs <ghostscript>] [--require-ghostscript]
 * Without `--gs` it looks for the provisioned `gswin64c.exe` (`scripts/provision/ghostscript.mjs`).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';

import { TEXT_TO_CURVES, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { gswin64cPath } from '../provision/ghostscript.mjs';

const ROOT = repoRoot();
const REQUIRE = process.argv.includes('--require-ghostscript');
const named = process.argv.indexOf('--gs');
const GS = named === -1 ? gswin64cPath(ROOT) : process.argv[named + 1];
if (GS === undefined || !existsSync(GS)) {
  exitUnverifiable({
    required: REQUIRE,
    subject: 'text to curves',
    why: `no Ghostscript at ${String(GS)}. \`node scripts/provision/ghostscript.mjs\` provisions the pinned one on Windows; elsewhere pass --gs.`,
    flag: '--require-ghostscript',
  });
}
refuseStaleBuild(ROOT, TEXT_TO_CURVES, 3);
if (bindNativeEngine(ROOT) === null) {
  exitUnverifiable({ required: REQUIRE, subject: 'text to curves', why: 'the MuPDF shim is not built here', flag: '--require-ghostscript' });
}
const mupdf = await import('../../packages/kernel/dist/mupdfRaw.js');
const { keptCensusOf, lostBetween } = await import('../../packages/kernel/dist/keptCensus.js');
const { curvesArguments } = await import('../../apps/desktop/dist/textToCurves.js');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 8 });
/** @param {string} name @param {boolean} ok @param {string} detail */
function record(name, ok, detail) {
  const mark = roster.mark();
  if (!ok) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, `${name} — ${detail}`);
}

const WORK = mkdtempSync(join(tmpdir(), 'monstera-curves-proof-'));
const WORDS = ['agreement', 'party', 'notice', 'term', 'clause', 'shall', 'the', 'of', 'any', 'such', 'provided', 'that'];

/** A page of text, with the word at `missing` left out where it is given: the pixel control's input. @param {number} [missing] */
async function textPage(missing) {
  const document = await PDFDocument.create();
  const times = await document.embedFont(StandardFonts.TimesRoman);
  const helvetica = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  page.drawText('A heading in Helvetica', { x: 72, y: 720, size: 20, font: helvetica });
  for (let at = 0; at < 20; at += 1) {
    const words = Array.from({ length: 9 }, (_unused, each) => WORDS[(at * 5 + each * 7) % WORDS.length] ?? 'word');
    if (missing === at) words[3] = '';
    page.drawText(words.join(' '), { x: 72, y: 690 - at * 16, size: 12, font: times });
  }
  return document.save();
}

async function formPage() {
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

async function annotatedPage() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  page.drawText('Highlighted words and a link to the site.', { x: 72, y: 700, size: 14, font });
  const { context } = document;
  const highlight = context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [72, 696, 260, 714], QuadPoints: [72, 714, 260, 714, 72, 696, 260, 696], C: [1, 1, 0] });
  const note = context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [400, 690, 420, 710], Contents: PDFString.of('a note'), Name: 'Comment' });
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

/** @param {string} path */
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Runs Ghostscript on `bytes` with `args` built from the two paths; answers the copy and the input's digests. */
function convert(/** @type {string} */ name, /** @type {Uint8Array} */ bytes, /** @type {(input: string, output: string) => readonly string[]} */ args) {
  const input = join(WORK, `${name}.pdf`);
  const output = join(WORK, `${name}-out.pdf`);
  writeFileSync(input, bytes);
  const before = digest(input);
  const run = spawnSync(String(GS), [...args(input, output)], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`${name}: Ghostscript exited ${String(run.status)}: ${run.stderr}`);
  // NO COPY where the run wrote over its input instead: the control below, whose input is what changed.
  return { copy: existsSync(output) ? new Uint8Array(readFileSync(output)) : new Uint8Array(), inputBefore: before, inputAfter: digest(input) };
}

/** The product's census of `bytes`. @param {Uint8Array} bytes */
function census(bytes) {
  const document = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
    return keptCensusOf(document);
  } finally {
    document.destroy();
  }
}

const DPI = 300;
/** Each page of `bytes` in grey at 300 dpi. @param {Uint8Array} bytes */
function drawn(bytes) {
  const document = mupdf.Document.openDocument(bytes, 'application/pdf');
  const scale = DPI / 72;
  const pages = [];
  for (let at = 0; at < document.countPages(); at += 1) {
    const pixmap = document.loadPage(at).toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceGray, false, true);
    pages.push({ pixels: pixmap.getPixels().slice(), width: pixmap.getWidth() });
  }
  document.destroy();
  return pages;
}

/**
 * ADR-0282's tolerance as its 2026-11-01 correction states it, page by page: why a page fails, or `null` for every
 * page within it. COUNTS, never a rounded share: a share printed to three decimals of a percent is how *no pixel past
 * 192* came to be written where 32 were.
 *
 * - no pixel INSIDE a letter of the original (its four neighbours inked) differs by more than 192 levels: a changed
 *   shape shows there, where anti-aliasing cannot reach;
 * - at most 0.005% of a page's pixels differ by more than 192 anywhere (measured at most 0.0004%, all at an edge);
 * - at most 0.5% differ by more than 128;
 * - at most 1% of those differing by more than 64 sit inside a letter.
 *
 * @param {Uint8Array} original @param {Uint8Array} copy
 */
function outsideTolerance(original, copy) {
  const before = drawn(original);
  const after = drawn(copy);
  if (before.length !== after.length) return `${String(before.length)} pages became ${String(after.length)}`;
  for (const [page, a] of before.entries()) {
    const b = after[page];
    if (b === undefined || b.pixels.length !== a.pixels.length) return `page ${String(page + 1)} changed size`;
    const counts = { past192: 0, past128: 0, past64: 0, inside64: 0 };
    for (let at = 0; at < a.pixels.length; at += 1) {
      const d = Math.abs((a.pixels[at] ?? 0) - (b.pixels[at] ?? 0));
      if (d <= 64) continue;
      const inside = [at - 1, at + 1, at - a.width, at + a.width].every((each) => (a.pixels[each] ?? 255) < 64);
      if (d > 192 && inside) return `page ${String(page + 1)}: a pixel inside a letter differs by ${String(d)} levels`;
      if (d > 192) counts.past192 += 1;
      if (d > 128) counts.past128 += 1;
      counts.past64 += 1;
      if (inside) counts.inside64 += 1;
    }
    const total = a.pixels.length;
    const where = `page ${String(page + 1)}`;
    if (counts.past192 / total > 0.00005) return `${where}: ${String(counts.past192)} of ${String(total)} pixels past 192`;
    if (counts.past128 / total > 0.005) return `${where}: ${String(counts.past128)} of ${String(total)} pixels past 128`;
    if (counts.past64 > 0 && counts.inside64 / counts.past64 > 0.01) {
      return `${where}: ${String(counts.inside64)} of the ${String(counts.past64)} pixels past 64 inside a letter`;
    }
  }
  return null;
}

/** pdf-lib's own counts of a copy: the second reader the census is checked against. @param {Uint8Array} bytes */
async function secondReader(bytes) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  let marks = 0;
  let links = 0;
  for (const page of document.getPages()) {
    const list = page.node.lookup(PDFName.of('Annots'));
    if (!(list instanceof PDFArray)) continue;
    for (let at = 0; at < list.size(); at += 1) {
      const annot = list.lookup(at);
      const kind = annot instanceof PDFDict ? String(annot.get(PDFName.of('Subtype'))) : '';
      if (kind === '/Link') links += 1;
      else if (kind !== '/Widget' && kind !== '/Popup') marks += 1;
    }
  }
  return { fields: document.getForm().getFields().length, marks, links };
}

try {
  const fixtures = { text: await textPage(), form: await formPage(), annotations: await annotatedPage() };
  const converted = {
    text: convert('text', fixtures.text, curvesArguments),
    form: convert('form', fixtures.form, curvesArguments),
    annotations: convert('annotations', fixtures.annotations, curvesArguments),
  };

  const fonts = Object.entries(converted).map(([name, run]) => `${name} ${String(census(run.copy).fonts)}`);
  record('no font is left in any copy', Object.values(converted).every((run) => census(run.copy).fonts === 0), `fonts per copy: ${fonts.join(', ')}`);
  const plain = convert('plain', fixtures.text, (input, output) => ['-dBATCH', '-dNOPAUSE', '-dSAFER', '-sDEVICE=pdfwrite', `-sOutputFile=${output}`, '-f', input]);
  const plainFonts = census(plain.copy).fonts;
  record('CONTROL: a copy written by plain pdfwrite, fonts kept, is seen to have fonts', plainFonts > 0, `${String(plainFonts)} font(s) in the plain copy`);

  const outside = Object.entries(converted).map(([name, run]) => ({ name, why: outsideTolerance(fixtures[/** @type {keyof typeof fixtures} */ (name)], run.copy) }));
  record(
    'every page of every copy is within the tolerance at 300 dpi',
    outside.every((each) => each.why === null),
    outside.map((each) => `${each.name}: ${each.why ?? 'within'}`).join('; '),
  );
  const missing = convert('missing', await textPage(4), curvesArguments);
  const missingWhy = outsideTolerance(fixtures.text, missing.copy);
  record('CONTROL: a copy of the page with one word removed is outside the tolerance', missingWhy !== null, missingWhy ?? 'it was within');

  record(
    'the original’s bytes are unchanged by every conversion',
    Object.values(converted).every((run) => run.inputBefore === run.inputAfter),
    `${String(Object.keys(converted).length)} input digest(s) compared`,
  );
  const over = convert('over', fixtures.text, (input) => ['-dBATCH', '-dNOPAUSE', '-dSAFER', '-sDEVICE=pdfwrite', '-dNoOutputFonts', `-sOutputFile=${input}`, '-f', join(WORK, 'text.pdf')]);
  record('CONTROL: a run that writes over its input is seen to change it', over.inputBefore !== over.inputAfter, 'the digest moved');

  const formLost = lostBetween(census(fixtures.form).kept, census(converted.form.copy).kept);
  const formRead = await secondReader(converted.form.copy);
  const formCensus = census(converted.form.copy).kept;
  record(
    'the form’s three fields are reported lost, and the copy’s counts agree with a second reader',
    formLost.some((loss) => loss.kind === 'fields' && loss.before === 3 && loss.after === 0) &&
      formRead.fields === formCensus.fields &&
      formRead.marks === formCensus.marks &&
      formRead.links === formCensus.links,
    `lost ${JSON.stringify(formLost)}; census ${JSON.stringify({ fields: formCensus.fields, marks: formCensus.marks, links: formCensus.links })}, pdf-lib ${JSON.stringify(formRead)}`,
  );
  const annotationsLost = lostBetween(census(fixtures.annotations).kept, census(converted.annotations.copy).kept);
  const read = await secondReader(converted.annotations.copy);
  const counted = census(converted.annotations.copy).kept;
  // NON-ZERO ON BOTH SIDES, so the two readers agreeing is not the agreement of two absences, which the form's zeros
  // above would be on their own.
  record(
    'CONTROL: the annotated page reports nothing lost, and the census and the second reader both count its two marks and link',
    annotationsLost.length === 0 && read.marks === 2 && read.links === 1 && counted.marks === read.marks && counted.links === read.links,
    `lost ${JSON.stringify(annotationsLost)}; census ${JSON.stringify({ marks: counted.marks, links: counted.links })}, pdf-lib ${JSON.stringify(read)}`,
  );
} finally {
  rmSync(WORK, { recursive: true, force: true });
}

process.stdout.write(
  failures.length > 0
    ? `${String(failures.length)} text-to-curves case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : `${roster.format('text-to-curves case')}\n  Ghostscript: ${String(GS)}, uncontained.\n`,
);
if (failures.length > 0) process.exitCode = 1;
