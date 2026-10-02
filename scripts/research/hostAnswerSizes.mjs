// @ts-check
/**
 * How big is each engine host read's answer, against the frame it must fit?
 *
 * ## Why this exists
 *
 * The owner's install of 0.1.5.0 (2026-09-30) ended the PDFium host on two of their own PDFs. The host's diagnostic
 * said why: `engine/text-runs` answered 663,815 bytes for one page against `ENGINE_HOST_FRAME_MAX_BYTES`' 262,144, the
 * host could not frame it, and it ended itself. The document draws almost every glyph as its own text object, and
 * each run carries its full style and 17-digit coordinates. That is one channel on one document; the question this
 * answers is the CLASS — every read a host answers inside a frame, on real documents — so the fix is sized by what
 * was read rather than by the one failure that was reported.
 *
 * ## What it runs, and what it never prints
 *
 * The same readers the hosts register (`hostEntry.ts`, `pdfiumHostEntry.ts`), in this process, on the native
 * engines. It prints the size of each answer as it would be encoded — `JSON.stringify` of the value the handler
 * returns; the frame adds its envelope, 71 bytes on the failing call — and never a byte of content. Documents are
 * named by position: the files it is pointed at are private.
 *
 * ## Its positive control, on every run
 *
 * A page it generates with one text object per glyph, which `engine/text-runs` must report above the frame. An
 * instrument that measured nothing would print every channel comfortably under the cap, which is the answer hoped
 * for; so without the control over the cap, it refuses to report.
 *
 * Usage: node scripts/research/hostAnswerSizes.mjs <file.pdf> [<file.pdf> ...]
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

import { HOST_READS, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';

const ROOT = repoRoot();
// THE BUILT READERS ARE THE SUBJECT, so a stale build would measure yesterday's answers under today's name.
refuseStaleBuild(ROOT, HOST_READS, 3);
/** @param {string} relative */
const built = (relative) => import(pathToFileURL(`${ROOT}/${relative}`).href);

const { ENGINE_HOST_FRAME_MAX_BYTES } = await built('packages/contract/dist/hostProtocol.js');
const { mupdfWriter } = await built('packages/kernel/dist/mupdfWriter.js');
const { readPageGeometry } = await built('packages/kernel/dist/pageGeometry.js');
const { readPageTextJson } = await built('packages/kernel/dist/pageText.js');
const { PAGE_TEXT_READS } = await built('packages/kernel/dist/textStructure.js');
const { readPageLinks } = await built('packages/kernel/dist/pageLinks.js');
const { readPageFills } = await built('packages/kernel/dist/pageFills.js');
const { readDestinations } = await built('packages/kernel/dist/destinations.js');
const { readLayers } = await built('packages/kernel/dist/layers.js');
const { readAnnotations } = await built('packages/kernel/dist/pageAnnotations.js');
const { copyAnnotationData } = await built('packages/kernel/dist/annotationInterchange.js');
const { readFormFields } = await built('packages/kernel/dist/formFields.js');
const { detectFlatFields } = await built('packages/kernel/dist/flatFields.js');
const { findDuplicatePages } = await built('packages/kernel/dist/pageDuplicates.js');
const { checkAccessibility } = await built('packages/kernel/dist/accessibilityCheck.js');
const pdfium = await built('packages/kernel/dist/pdfiumFfi.js');

if (bindNativeEngine(ROOT) === null) throw new Error('the native MuPDF shim is not built: node scripts/provision/mupdf.mjs');
pdfium.openPdfium(pdfiumLibrary(ROOT));

/** @param {unknown} value */
const size = (value) => Buffer.byteLength(JSON.stringify(value));

/**
 * One page drawing `glyphs` characters, each its own text object — the shape of the owner's failing file, made here
 * so nothing of theirs is read to build it.
 *
 * @param {number} glyphs
 * @returns {Promise<Uint8Array>}
 */
export async function onePerGlyphPage(glyphs) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([595, 842]);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  for (let index = 0; index < glyphs; index += 1) {
    const column = index % 80;
    const row = Math.floor(index / 80);
    page.drawText(alphabet[index % alphabet.length] ?? 'a', { x: 20 + column * 7, y: 820 - row * 11, size: 9, font });
  }
  return document.save();
}

/**
 * A form with `fields` text fields spread over pages of forty — the size a long government form reaches.
 *
 * @param {number} fields
 * @returns {Promise<Uint8Array>}
 */
export async function manyFieldsForm(fields) {
  const document = await PDFDocument.create();
  const form = document.getForm();
  let page = document.addPage([595, 842]);
  for (let index = 0; index < fields; index += 1) {
    if (index > 0 && index % 40 === 0) page = document.addPage([595, 842]);
    const field = form.createTextField(`section.part${String(Math.floor(index / 40))}.line${String(index % 40)}.entry`);
    field.addToPage(page, { x: 40, y: 800 - (index % 40) * 19, width: 500, height: 16 });
  }
  return document.save();
}

/**
 * A document whose outline has `entries` items, one per page's worth of headings — a long manual's shape.
 *
 * @param {number} entries
 * @returns {Promise<Uint8Array>}
 */
export async function longOutline(entries) {
  const document = await PDFDocument.create();
  const pages = Array.from({ length: 50 }, () => document.addPage([595, 842]));
  const { PDFName, PDFNumber, PDFString, PDFArray } = await import('@cantoo/pdf-lib');
  const context = document.context;
  const outlines = context.obj({ Type: 'Outlines' });
  const outlinesRef = context.register(outlines);
  /** @type {import('@cantoo/pdf-lib').PDFRef[]} */
  const items = [];
  for (let index = 0; index < entries; index += 1) {
    const target = pages[index % pages.length];
    if (target === undefined) throw new Error('no page for an outline entry');
    const destination = PDFArray.withContext(context);
    destination.push(target.ref);
    destination.push(PDFName.of('XYZ'));
    destination.push(PDFNumber.of(0));
    destination.push(PDFNumber.of(842));
    destination.push(PDFNumber.of(0));
    items.push(
      context.register(
        context.obj({ Title: PDFString.of(`Chapter ${String(index + 1)}: a heading of ordinary length`), Parent: outlinesRef, Dest: destination }),
      ),
    );
  }
  for (const [index, ref] of items.entries()) {
    const item = context.lookup(ref);
    if (!(item instanceof (await import('@cantoo/pdf-lib')).PDFDict)) throw new Error('an outline entry is not a dictionary');
    const previous = items[index - 1];
    const next = items[index + 1];
    if (previous !== undefined) item.set(PDFName.of('Prev'), previous);
    if (next !== undefined) item.set(PDFName.of('Next'), next);
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) throw new Error('an outline needs entries');
  outlines.set(PDFName.of('First'), first);
  outlines.set(PDFName.of('Last'), last);
  outlines.set(PDFName.of('Count'), PDFNumber.of(items.length));
  document.catalog.set(PDFName.of('Outlines'), outlinesRef);
  return document.save();
}

/**
 * Every frame-answered read on one document: the largest answer per channel and the page it came from.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<Map<string, { bytes: number, page: number | null, failed?: string }>>}
 */
async function measure(bytes) {
  /** @type {Map<string, { bytes: number, page: number | null, failed?: string }>} */
  const largest = new Map();
  /**
   * @param {string} channel
   * @param {number | null} page
   * @param {() => Promise<unknown>} read
   */
  const take = async (channel, page, read) => {
    try {
      const answer = size(await read());
      const before = largest.get(channel);
      if (before === undefined || answer > before.bytes) largest.set(channel, { bytes: answer, page });
    } catch (thrown) {
      // REPORTED, never dropped: a read that throws on a document is a finding of its own, and silence would read as
      // a small answer.
      largest.set(channel, { bytes: -1, page, failed: thrown instanceof Error ? thrown.name : 'non-error' });
    }
  };

  const session = await mupdfWriter.open(bytes);
  try {
    const pages = (await readPageGeometry(session, [0])).pageCount;
    const all = Array.from({ length: pages }, (_, page) => page);
    await take('engine/page-geometry', null, () => readPageGeometry(session, all.slice(0, 512)));
    for (const page of all) {
      for (const read of PAGE_TEXT_READS) {
        await take(`engine/page-text (${read})`, page, async () => ({ json: await readPageTextJson(session, page, read) }));
      }
      await take('engine/page-links', page, async () => ({ links: await readPageLinks(session, page) }));
      await take('engine/page-fills', page, async () => ({ fills: await readPageFills(session, page) }));
      await take('engine/flat-fields', page, () => detectFlatFields(session, page));
    }
    // THE READERS' OWN ANSWERS, which are the channels' shapes: each is `{ list, truncated }` (ADR-0130).
    await take('engine/destinations', null, () => readDestinations(session));
    await take('engine/layers', null, () => readLayers(session));
    const listed = await readAnnotations(session);
    await take('engine/annotations', null, async () => listed);
    /** @type {Map<number, number[]>} */
    const byPage = new Map();
    for (const [position, entry] of listed.annotations.entries()) {
      const onPage = byPage.get(entry.page) ?? [];
      onPage.push(typeof entry.index === 'number' ? entry.index : position);
      byPage.set(entry.page, onPage);
    }
    for (const [page, indices] of byPage) {
      await take('engine/annotation-records', page, () => copyAnnotationData(session, page, indices));
    }
    await take('engine/form-fields', null, () => readFormFields(session));
    await take('engine/duplicate-pages', null, async () => ({ groups: await findDuplicatePages(session) }));
    await take('engine/accessibility-check', null, () => checkAccessibility(session));
  } finally {
    await mupdfWriter.close(session);
  }

  const held = await pdfium.pdfiumWriter.open(bytes);
  try {
    const pages = await pdfium.pageCount(held);
    for (let page = 0; page < pages; page += 1) {
      await take('engine/text-runs', page, () => pdfium.textRuns(held, page));
      await take('engine/page-objects', page, async () => ({ objects: await pdfium.pageObjects(held, page) }));
    }
  } finally {
    await pdfium.pdfiumWriter.close(held);
  }
  return largest;
}

/** @param {Map<string, { bytes: number, page: number | null, failed?: string }>} largest */
function report(largest) {
  for (const [channel, { bytes, page, failed }] of [...largest].sort((a, b) => b[1].bytes - a[1].bytes)) {
    const where = page === null ? 'document' : `page ${String(page + 1)}`;
    if (failed !== undefined) {
      console.log(`  ${channel.padEnd(34)} FAILED (${failed}) at ${where}`);
      continue;
    }
    const share = ((bytes / ENGINE_HOST_FRAME_MAX_BYTES) * 100).toFixed(1);
    const mark = bytes > ENGINE_HOST_FRAME_MAX_BYTES ? '  OVER THE FRAME' : '';
    console.log(`  ${channel.padEnd(34)} ${String(bytes).padStart(9)} B  ${share.padStart(6)}%  ${where}${mark}`);
  }
}

// THE CONTROL FIRST: if the one-per-glyph page is not reported over the frame, nothing below means anything.
const control = await measure(await onePerGlyphPage(1600));
const controlRuns = control.get('engine/text-runs');
if (controlRuns === undefined || controlRuns.bytes <= ENGINE_HOST_FRAME_MAX_BYTES) {
  throw new Error(
    `REFUSING TO REPORT: the generated one-object-per-glyph page answered ${String(controlRuns?.bytes)} bytes on ` +
      `engine/text-runs, which must exceed ${String(ENGINE_HOST_FRAME_MAX_BYTES)}. An instrument that cannot see the ` +
      'case it was built for reports every channel as fitting.',
  );
}
console.log(`frame maximum: ${String(ENGINE_HOST_FRAME_MAX_BYTES)} bytes`);
console.log('CONTROL — a generated page, 1,600 glyphs, one text object each:');
report(control);

// GENERATED SHAPES THAT REAL DOCUMENTS HAVE, for the MuPDF host's channels: a long form and a long outline. Nothing in
// the corpus is either, so without these the MuPDF half of the class would be a schema's promise and not a reading.
if (process.argv.includes('--shapes')) {
  console.log('GENERATED — a form of 3,000 text fields:');
  report(await measure(await manyFieldsForm(3000)));
  console.log('GENERATED — an outline of 10,000 entries:');
  report(await measure(await longOutline(10000)));
}

for (const [position, path] of process.argv.slice(2).filter((argument) => !argument.startsWith('--')).entries()) {
  console.log(`document ${String(position + 1)}:`);
  report(await measure(new Uint8Array(readFileSync(path))));
}
