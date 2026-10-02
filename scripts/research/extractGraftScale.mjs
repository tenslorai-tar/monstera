/**
 * How many objects an extract and a merge write, against how many pages the
 * source has — the measurement behind the graft map's `/Parent` rule.
 *
 * Run: `node scripts/research/extractGraftScale.mjs` after `npm run build`.
 *
 * A page leaf's `/Parent` names the source's page-tree node, which names every
 * other leaf, so a graft that follows it copies the whole source. Grafting each
 * page through a map of its own does that once per page. The figure that shows
 * it is the output's object count as the source grows with the extract held at
 * a few pages: a correct copy stays flat, a copy of the source grows with it.
 */
import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';

import {
  applyDuplicatePage,
  applyMergeDocument,
  extractPages,
  mupdfWriter,
} from '../../packages/kernel/dist/engine.js';
import { asDocId } from '../../packages/shared/dist/index.js';
import { HOST_READS, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';

// THE KERNEL, CONTRACT AND SHARED BUILDS this measures, refused when older than their sources.
refuseStaleBuild(repoRoot(), HOST_READS, 3);
bindNativeEngine();

/**
 * A source of `count` pages, each with a link annotation whose `/P` names its
 * page — the back-pointer a merge's annotation graft follows.
 *
 * @param {number} count pages
 * @returns {Promise<Uint8Array>} the bytes
 */
async function source(count) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < count; index += 1) {
    const page = document.addPage([200, 200]);
    page.drawText(String(index), { x: 10, y: 10, font, size: 12 });
    const annot = document.context.register(
      document.context.obj({
        Type: 'Annot',
        Subtype: 'Square',
        Rect: [0, 0, 20, 20],
        P: page.ref,
      }),
    );
    page.node.set(PDFName.of('Annots'), document.context.obj([annot]));
  }
  return document.save({ useObjectStreams: false });
}

/**
 * The highest object number in a PDF's bytes — what MuPDF's limit is about.
 *
 * @param {Uint8Array} bytes the PDF
 * @returns {Promise<number>} its object count as pdf-lib reads it
 */
async function objects(bytes) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return document.context.largestObjectNumber;
}

for (const count of [10, 40, 160]) {
  const bytes = await source(count);
  console.log(`source ${count} pages: ${await objects(bytes)} objects`);
  const session = await mupdfWriter.open(bytes);
  try {
    const out = await extractPages(session, [0, 1]);
    console.log(`  extract of 2 pages: ${await objects(out)} objects`);
  } finally {
    await mupdfWriter.close(session);
  }

  const duplicated = await mupdfWriter.open(bytes);
  try {
    await applyDuplicatePage(duplicated, { kind: 'duplicatePage', pages: [0] });
    const out = await mupdfWriter.serialise(duplicated);
    console.log(`  after duplicating page 1: ${await objects(out)} objects`);
  } finally {
    await mupdfWriter.close(duplicated);
  }

  const target = await mupdfWriter.open(await source(1));
  const from = await mupdfWriter.open(bytes);
  try {
    await applyMergeDocument(target, { kind: 'mergeDocument', at: 1, source: asDocId('unused') }, from);
    const out = await mupdfWriter.serialise(target);
    console.log(`  a 1-page document after merging it: ${await objects(out)} objects`);
  } finally {
    await mupdfWriter.close(target);
    await mupdfWriter.close(from);
  }
}
