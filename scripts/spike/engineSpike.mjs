// @ts-check
/**
 * Engine capability spike (Part G, ARCHITECTURE §3.1).
 *
 * The writer-of-record matrix is provisional until every row has been executed
 * against a real document. This is that execution. It is evidence, not shipped
 * code — nothing in packages/ imports it.
 *
 * The discipline that matters here: **a declared API is not a working one.**
 * Introspection already showed `rearrangePages` and `bake` exist. That says
 * nothing about whether a reorder preserves the catalog entries invariant L6
 * depends on, which is the only question that changes the architecture. So each
 * case writes a real document, reopens it, and checks the result — and where
 * the point is cross-engine truth, it reopens with a *different* library than
 * the one that wrote it.
 *
 * Usage: node scripts/spike/engineSpike.mjs
 */

import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

import { buildFixture } from './makeFixture.mjs';

/** Catalog entries a page-tree rebuild is known to drop (invariant L6). */
const CATALOG_KEYS = ['AcroForm', 'Outlines', 'Names', 'OCProperties'];

/** @type {{name: string, verdict: string, expected: string, detail: string}[]} */
const findings = [];

/**
 * Records one result against what the architecture currently believes.
 *
 * A refuted hypothesis is a finding, not a failure — rearrangePages dropping
 * /AcroForm is the whole reason for running this. The spike fails only when
 * reality differs from the recorded expectation, which turns it from a one-off
 * investigation into a regression gate: if a MuPDF upgrade changes any of these
 * behaviours, the matrix built on them goes red.
 *
 * @param {string} name
 * @param {'CONFIRMED' | 'REFUTED'} expected
 * @param {boolean} holds
 * @param {string} detail
 */
function record(name, expected, holds, detail) {
  const verdict = holds ? 'CONFIRMED' : 'REFUTED';
  findings.push({ name, verdict, expected, detail });
  process.stdout.write(`${verdict === expected ? ' ' : '!'} ${verdict.padEnd(9)} ${name}\n           ${detail}\n`);
}

/**
 * Reads the catalog keys with a different library from the one under test, so
 * "the writer says it kept them" is never the evidence.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<string[]>}
 */
async function catalogKeys(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return CATALOG_KEYS.filter((key) => doc.catalog.get(PDFName.of(key)) !== undefined);
}

/**
 * @param {mupdf.PDFDocument} doc
 * @returns {string[]} The `marker-N` token on each page, in page order.
 */
function pageMarkers(doc) {
  const markers = [];
  for (let i = 0; i < doc.countPages(); i += 1) {
    const text = doc.loadPage(i).toStructuredText().asText();
    const match = /marker-(\d+)/.exec(text);
    markers.push(match === null ? '?' : `marker-${String(match[1])}`);
  }
  return markers;
}

/**
 * @param {Uint8Array} bytes
 * @returns {mupdf.PDFDocument}
 */
function openWithMupdf(bytes) {
  return /** @type {mupdf.PDFDocument} */ (
    mupdf.PDFDocument.openDocument(bytes, 'application/pdf')
  );
}

/**
 * @param {mupdf.PDFDocument} doc
 * @returns {Uint8Array}
 */
function saveWithMupdf(doc) {
  return doc.saveToBuffer('').asUint8Array();
}

async function main() {
  const fixture = await buildFixture();
  const before = await catalogKeys(fixture);
  process.stdout.write(
    `fixture: ${String(fixture.byteLength)} bytes, catalog carries [${before.join(', ')}]\n\n`,
  );

  if (before.length !== CATALOG_KEYS.length) {
    process.stderr.write(
      `The fixture is missing ${CATALOG_KEYS.filter((k) => !before.includes(k)).join(', ')}, ` +
        `so the L6 test below would pass vacuously. Fix the fixture before trusting any result.\n`,
    );
    return 1;
  }

  // ── H1: page reorder ────────────────────────────────────────────────────
  {
    const doc = openWithMupdf(fixture);
    const original = pageMarkers(doc);
    const count = doc.countPages();

    // A full permutation. rearrangePages is a page *selection* primitive, so
    // omitting an index deletes that page — passing anything short of a full
    // permutation here would silently be a delete test.
    const permutation = Array.from({ length: count }, (_, i) => count - 1 - i);
    doc.rearrangePages(permutation);

    const saved = saveWithMupdf(doc);
    const reopened = openWithMupdf(saved);
    const after = pageMarkers(reopened);
    const survived = await catalogKeys(saved);
    const lost = CATALOG_KEYS.filter((key) => !survived.includes(key));

    const orderCorrect = after.join(',') === [...original].reverse().join(',');
    record(
      'H1 rearrangePages: page order',
      'CONFIRMED',
      orderCorrect,
      `${original.join(' ')} -> ${after.join(' ')}`,
    );
    record(
      'H1 rearrangePages: catalog survives (L6)',
      'REFUTED',
      lost.length === 0,
      lost.length === 0 ? `all of [${survived.join(', ')}] preserved` : `LOSES: ${lost.join(', ')}`,
    );
  }

  // ── H1c: the in-place /Kids rewrite invariant L6 actually prescribes ────
  {
    const doc = openWithMupdf(fixture);
    const original = pageMarkers(doc);

    // Reorder by rewriting the page tree's /Kids array through MuPDF's own
    // object API, touching nothing else. This is what L6 means by "in place",
    // and it is the difference between preserving /AcroForm and orphaning it.
    const kids = doc.getTrailer().get('Root').get('Pages').get('Kids');
    const count = kids.length;
    const current = [];
    for (let i = 0; i < count; i += 1) current.push(kids.get(i));
    for (let i = 0; i < count; i += 1) kids.put(i, current[count - 1 - i]);

    const saved = saveWithMupdf(doc);
    const reopened = openWithMupdf(saved);
    const after = pageMarkers(reopened);
    const survived = await catalogKeys(saved);
    const lost = CATALOG_KEYS.filter((key) => !survived.includes(key));
    const orderCorrect = after.join(',') === [...original].reverse().join(',');

    record(
      'H1c in-place /Kids rewrite: order AND catalog',
      'CONFIRMED',
      orderCorrect && lost.length === 0,
      orderCorrect && lost.length === 0
        ? `${original.join(' ')} -> ${after.join(' ')}, all of [${survived.join(', ')}] preserved`
        : `order ok: ${String(orderCorrect)}; lost: ${lost.join(', ') || 'none'}`,
    );
  }

  // ── H1b: the deletion semantics, stated so nobody rediscovers them ──────
  {
    const doc = openWithMupdf(fixture);
    doc.rearrangePages([0, 1, 2]);
    record(
      'H1b rearrangePages: omitted indices are deleted',
      'CONFIRMED',
      doc.countPages() === 3,
      `passing 3 of 6 indices left ${String(doc.countPages())} pages — this is subset+reorder, not reorder`,
    );
  }

  // ── H2: form flattening ─────────────────────────────────────────────────
  {
    const doc = openWithMupdf(fixture);
    const widgetsBefore = doc.loadPage(0).getWidgets().length;
    doc.bake(false, true);
    const saved = saveWithMupdf(doc);
    const reopened = openWithMupdf(saved);
    const widgetsAfter = reopened.loadPage(0).getWidgets().length;
    const acroFormGone = !(await catalogKeys(saved)).includes('AcroForm');

    record(
      'H2 bake: flattens form widgets',
      'CONFIRMED',
      widgetsBefore > 0 && widgetsAfter === 0,
      `widgets ${String(widgetsBefore)} -> ${String(widgetsAfter)}; /AcroForm removed: ${String(acroFormGone)}`,
    );
  }

  // ── H3: widget creation ─────────────────────────────────────────────────
  {
    const names = Object.getOwnPropertyNames(mupdf.PDFDocument.prototype).concat(
      Object.getOwnPropertyNames(mupdf.PDFPage.prototype),
    );
    const creators = names.filter((n) => /createWidget|addWidget|newWidget|createField|addField/i.test(n));
    record(
      'H3 no widget creation in MuPDF',
      'CONFIRMED',
      creators.length === 0,
      creators.length === 0
        ? 'no widget/field creation method on PDFDocument or PDFPage — this gap is real'
        : `found: ${creators.join(', ')}`,
    );
  }

  // ── H4: the one row MuPDF cannot cover, and who can ─────────────────────
  {
    // Form field creation is the only concern with no MuPDF path, so whatever
    // covers it is load-bearing — which is why it cannot be pdf-lib, whose last
    // release was 2021-11-06.
    const doc = await PDFDocument.load(fixture);
    const form = doc.getForm();
    const pages = doc.getPages();
    const third = pages[2];
    if (third === undefined) throw new Error('fixture needs a third page');

    const field = form.createTextField('spike.created');
    field.setText('made by @cantoo');
    field.addToPage(third, { x: 60, y: 400, width: 200, height: 24 });
    const saved = await doc.save();

    // Verified by MuPDF, not by the library that wrote it. A writer agreeing
    // with itself is not evidence that another reader accepts the output.
    const widgets = openWithMupdf(saved).loadPage(2).getWidgets();
    const first = widgets[0];
    const readable = first !== undefined && first.getValue() === 'made by @cantoo';

    record(
      'H4 @cantoo/pdf-lib creates fields MuPDF can read',
      'CONFIRMED',
      readable,
      readable
        ? `MuPDF reads back ${first.getName()}:${first.getFieldType()} = "${first.getValue()}"`
        : `MuPDF saw ${String(widgets.length)} widget(s) and could not read the value`,
    );
  }

  // ── H5: journal and incremental save ────────────────────────────────────
  {
    const doc = openWithMupdf(fixture);
    doc.enableJournal();
    doc.beginOperation('spike');
    doc.deletePage(0);
    doc.endOperation();
    const canUndo = doc.canUndo();
    doc.undo();
    const restored = doc.countPages();

    record(
      'H5 journal: undo restores a deleted page',
      'CONFIRMED',
      canUndo && restored === 6,
      `canUndo=${String(canUndo)}, pages after undo=${String(restored)}`,
    );
  }

  // ── Annotation write API, the largest matrix row ────────────────────────
  {
    const doc = openWithMupdf(fixture);
    const page = doc.loadPage(0);
    const annot = page.createAnnotation('Highlight');
    annot.setQuadPoints([[60, 690, 300, 690, 60, 740, 300, 740]]);
    annot.setColor([1, 1, 0]);
    annot.update();

    const saved = saveWithMupdf(doc);
    const reopened = openWithMupdf(saved);
    const annots = reopened.loadPage(0).getAnnotations();
    const subtypes = annots.map((a) => a.getType());

    record(
      'Annotations: create + persist through save',
      'CONFIRMED',
      subtypes.includes('Highlight'),
      `after reopen page 0 carries: ${subtypes.join(', ') || '(none)'}`,
    );
  }

  // ── srcRef: does a MuPDF save preserve a foreign annotation? ────────────
  {
    const doc = openWithMupdf(fixture);
    const saved = saveWithMupdf(doc);
    const reopened = openWithMupdf(saved);
    const annots = reopened.loadPage(1).getAnnotations();
    const foreign = annots.filter((a) => a.getType() === 'Square');

    record(
      'srcRef: a foreign annotation survives a plain save',
      'CONFIRMED',
      foreign.length === 1,
      `page 1 Square annotations after round trip: ${String(foreign.length)}`,
    );
  }

  const surprises = findings.filter((f) => f.verdict !== f.expected);
  process.stdout.write(
    `\n${String(findings.length - surprises.length)}/${String(findings.length)} matched the recorded expectation\n`,
  );

  if (surprises.length > 0) {
    process.stderr.write(
      `\nEngine behaviour has changed since the matrix was stamped:\n` +
        surprises
          .map((f) => `  ${f.name}: expected ${f.expected}, got ${f.verdict}\n    ${f.detail}`)
          .join('\n') +
        `\n\nThe writer-of-record matrix rests on these results. Re-run the spike, update ` +
        `docs/ENGINE-SPIKE.md, and amend ARCHITECTURE §3 before building further on it.\n`,
    );
  }
  return surprises.length > 0 ? 1 : 0;
}

main().then(
  (status) => process.exit(status),
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  },
);
