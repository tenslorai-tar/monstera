// @ts-check
/**
 * What does a document's extracted text COST, and may `main` hold it?
 *
 * ## The question this answers, and why it comes before the channel
 *
 * `findInPages(pages, query)` is pure and takes an array of pages. Nothing in
 * the range that built it decides **who materialises that array or holds it**,
 * and that is the whole of D1's gate: invariant 11 says no channel's payload
 * scales with document size per *operation*, and §9.17 argues `main`'s budget
 * from *"main holds canonical bytes and never parses"*. Extracted text is
 * neither of those things and is named in neither.
 *
 * Three shapes are available and they are not interchangeable:
 *
 * 1. **Page at a time** — read one page's text, search it, drop it. Nothing
 *    document-scaled is ever resident.
 * 2. **Whole document, transient** — extract every page inside one call, search,
 *    drop. Peak holds the document's whole text for the length of the call.
 * 3. **Whole document, retained** — extract once and cache, so a second search
 *    is free. A second document-scaled structure in `main`, permanently.
 *
 * Deciding between them by argument is what this project calls modelling. The
 * number that decides it is **what the text costs relative to the bytes**, and
 * nobody here has measured it.
 *
 * ## What is measured
 *
 * A text-heavy document generated at a known size, extracted both ways, with
 * peak RSS read from the kernel and the retained structure's own size measured
 * by serialising it. Peak RSS alone cannot separate *the engine is holding this*
 * from *the allocator has not returned it*, which is why the retained figure is
 * taken as well and reported beside it rather than instead.
 *
 * Usage: node scripts/research/textRetention.mjs [--pages N]
 */

import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

import { readPageText } from '../../packages/kernel/dist/pageText.js';
import { mupdfWriter } from '../../packages/kernel/dist/mupdfWriter.js';
import { findInPages } from '../../packages/kernel/dist/textSearch.js';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { formatBytes, peakRssBytes } from '../perf/peakRss.mjs';
import { formatError } from '../lib/reportError.mjs';

const ROOT = repoRoot();

refuseStaleBuild(
  ROOT,
  [
    ['packages/kernel/src/pageText.ts', 'packages/kernel/dist/pageText.js', 'tsc'],
    ['packages/kernel/src/textSearch.ts', 'packages/kernel/dist/textSearch.js', 'tsc'],
  ],
  2,
);

/** Lines per page, chosen to fill a US Letter page at 12pt with normal leading. */
const LINES_PER_PAGE = 50;

/**
 * A text-heavy document: no images, no vectors, just prose.
 *
 * **The shape that makes extracted text expensive**, which is the opposite of
 * the perf corpus's image-heavy fixture. A budget argued against a 200 MB file
 * that is one JPEG says nothing about a 2 MB file that is all words, and this
 * question is about the words.
 *
 * @param {number} pages
 * @returns {Promise<Uint8Array>}
 */
async function textHeavyDocument(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let page = 0; page < pages; page += 1) {
    const sheet = doc.addPage([612, 792]);
    for (let line = 0; line < LINES_PER_PAGE; line += 1) {
      // Deterministic, and long enough to be a realistic measure rather than a
      // token. The page and line numbers make a search hit countable.
      sheet.drawText(
        `page ${String(page)} line ${String(line)} the quick brown fox jumps over the lazy dog again`,
        { x: 54, y: 740 - line * 14, size: 11, font },
      );
    }
  }
  return doc.save({ useObjectStreams: false });
}

/**
 * The serialised size of a parsed structure, as a stand-in for what it retains.
 *
 * A stand-in and not the thing: the in-memory objects carry per-property
 * overhead this does not count, so the figure is a **floor** on what is held.
 * That is the safe direction for a question about whether something fits.
 *
 * @param {unknown} value @returns {number}
 */
function retainedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

async function main() {
  const requested = process.argv.indexOf('--pages');
  const pages = requested < 0 ? 40 : Number(process.argv[requested + 1] ?? 40);
  const workspace = mkdtempSync(join(tmpdir(), 'monstera-textretention-'));

  try {
    const bytes = await textHeavyDocument(pages);
    const path = join(workspace, 'text-heavy.pdf');
    writeFileSync(path, bytes);
    const documentBytes = statSync(path).size;

    process.stdout.write(
      `\n${String(pages)} page(s), ${String(LINES_PER_PAGE)} lines each — ` +
        `${formatBytes(documentBytes)} on disk\n\n`,
    );

    // ---------------------------------------------------------------------
    // SHAPE 3: whole document, retained.
    // ---------------------------------------------------------------------
    const beforeAll = peakRssBytes();
    const session = await mupdfWriter.open(bytes);
    const every = Array.from({ length: pages }, (_, index) => index);
    const whole = await readPageText(session, every);
    const wholePeak = peakRssBytes();
    const wholeRetained = retainedBytes(whole.pages);
    const hits = findInPages(whole.pages, 'lazy').length;

    process.stdout.write(
      `  WHOLE DOCUMENT, retained\n` +
        `    text retained   ${formatBytes(wholeRetained)}  ` +
        `(${(wholeRetained / documentBytes).toFixed(2)}x the document)\n` +
        `    peak RSS        ${formatBytes(wholePeak)} (was ${formatBytes(beforeAll)})\n` +
        `    matches         ${String(hits)}\n\n`,
    );

    // ---------------------------------------------------------------------
    // SHAPE 1: page at a time. The same total work, nothing document-scaled
    // resident — which is the property, not the speed.
    // ---------------------------------------------------------------------
    const perPageSession = await mupdfWriter.open(bytes);
    let largestPage = 0;
    let perPageHits = 0;
    for (const index of every) {
      const one = await readPageText(perPageSession, [index]);
      const page = one.pages[0];
      if (page === undefined) throw new Error('one page was requested');
      largestPage = Math.max(largestPage, retainedBytes(page));
      perPageHits += findInPages([page], 'lazy').length;
    }
    const perPagePeak = peakRssBytes();

    process.stdout.write(
      `  PAGE AT A TIME\n` +
        `    largest page    ${formatBytes(largestPage)}  ` +
        `(${((largestPage / wholeRetained) * 100).toFixed(1)}% of the whole)\n` +
        `    peak RSS        ${formatBytes(perPagePeak)}\n` +
        `    matches         ${String(perPageHits)}\n\n`,
    );

    // THE CONTROL, and without it the two shapes could be measuring different
    // documents: a per-page loop that silently read fewer pages would report a
    // smaller footprint and look like the better shape.
    if (hits !== perPageHits) {
      throw new Error(
        `the two shapes found different numbers of matches (${String(hits)} vs ` +
          `${String(perPageHits)}), so they did not search the same text and neither ` +
          `footprint means anything.`,
      );
    }
    process.stdout.write(
      `  CONTROL: both shapes found ${String(hits)} matches, so the footprints ` +
        `describe the same work.\n\n`,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});
