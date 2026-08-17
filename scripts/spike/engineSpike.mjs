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

import { buildFixture, buildNestedFixture } from './makeFixture.mjs';
import { reorderPagesInPlace } from './reorderInPlace.mjs';

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
 * The three things that decide how `rotatePages` and its inverse must be built:
 * what the page itself declares, what it would inherit, and what MuPDF actually
 * renders. `own` and `inherited` differ exactly when a page takes its rotation
 * from an ancestor `/Pages` node, which is the case a delta-based inverse gets
 * wrong.
 *
 * @param {mupdf.PDFDocument} doc
 * @param {number} index
 * @returns {{own: number | null, inherited: number | null, size: string}}
 */
function rotationOf(doc, index) {
  const page = doc.findPage(index);
  const own = page.get('Rotate');
  const inherited = page.getInheritable('Rotate');
  const [x0, y0, x1, y1] = doc.loadPage(index).getBounds();
  return {
    own: own.isNull() ? null : own.asNumber(),
    inherited: inherited.isNull() ? null : inherited.asNumber(),
    size: `${String(Math.round(x1 - x0))}x${String(Math.round(y1 - y0))}`,
  };
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

  // ── H1d: the nested page tree, where the naive rewrite is wrong ─────────
  {
    // A flat tree hides this entirely. The first version of the in-place
    // rewrite reversed the root /Kids array, which on a nested tree permutes
    // subtrees rather than pages.
    const nested = await buildNestedFixture();
    const naive = openWithMupdf(nested);
    const kids = naive.getTrailer().get('Root').get('Pages').get('Kids');
    const n = kids.length;
    const held = [];
    for (let i = 0; i < n; i += 1) held.push(kids.get(i));
    for (let i = 0; i < n; i += 1) kids.put(i, held[n - 1 - i]);
    naive.setPageTreeCache(true);

    record(
      'H1d naive /Kids reversal on a nested tree',
      'REFUTED',
      pageMarkers(naive).join(',') === 'marker-6,marker-5,marker-4,marker-3,marker-2,marker-1',
      `root /Kids holds ${String(n)} subtrees for 6 pages; reversing it gives ${pageMarkers(naive).join(' ')}`,
    );
  }

  // ── H1e: the reorder that is actually correct ───────────────────────────
  {
    const nested = await buildNestedFixture();
    const doc = openWithMupdf(nested);

    // Orientation before: pages 4-6 are landscape only by inheriting /Rotate 90
    // from their branch. If the flatten drops that, they come back portrait and
    // the page order still looks right.
    /** @param {any} d A MuPDF document handle; the binding ships no types. */
    const orientation = (d) => {
      const out = [];
      for (let i = 0; i < d.countPages(); i += 1) {
        const b = d.loadPage(i).getBounds();
        out.push(b[2] - b[0] > b[3] - b[1] ? 'land' : 'port');
      }
      return out.join(' ');
    };
    const before = orientation(doc);

    reorderPagesInPlace(doc, [5, 4, 3, 2, 1, 0]);
    const saved = saveWithMupdf(doc);
    const reopened = openWithMupdf(saved);

    const orderOk = pageMarkers(reopened).join(',') === 'marker-6,marker-5,marker-4,marker-3,marker-2,marker-1';
    const rotationFollowed = orientation(reopened) === before.split(' ').reverse().join(' ');
    const formKept = (await catalogKeys(saved)).includes('AcroForm');

    record(
      'H1e in-place reorder on a nested tree',
      'CONFIRMED',
      orderOk && rotationFollowed && formKept,
      `order ${pageMarkers(reopened).join(' ')}; orientation ${before} -> ${orientation(reopened)}; /AcroForm kept: ${String(formKept)}`,
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

  // ── R1: page rotation is a leaf attribute write, not an API call ─────────
  // `mupdf.d.ts` declares no rotation setter on PDFPage — `Rotate` appears only
  // as a type and as an `addPage` parameter — so the write goes through the
  // low-level PDFObject API. Unlike a reorder, no `setPageTreeCache` is needed:
  // rotation changes an attribute read when bounds are computed, whereas a
  // reorder changes the tree structure MuPDF memoises for page lookup.
  {
    const doc = openWithMupdf(fixture);
    const before = rotationOf(doc, 1);
    doc.findPage(1).put('Rotate', 90);
    const live = rotationOf(doc, 1);
    const reopened = openWithMupdf(saveWithMupdf(doc));

    record(
      'R1 rotation takes effect with no page-tree cache reset',
      'CONFIRMED',
      before.size === '600x800' &&
        live.size === '800x600' &&
        rotationOf(reopened, 1).own === 90 &&
        rotationOf(reopened, 0).own === null,
      `page 1 ${before.size} -> ${live.size} without setPageTreeCache; survives reopen; page 0 untouched`,
    );
  }

  // ── R2: a leaf /Rotate must shadow an inherited one ──────────────────────
  {
    const doc = openWithMupdf(await buildNestedFixture());
    const inheriting = rotationOf(doc, 3);
    doc.findPage(3).put('Rotate', 180);
    const shadowed = rotationOf(doc, 3);
    const sibling = rotationOf(doc, 4);
    const reopened = openWithMupdf(saveWithMupdf(doc));

    record(
      'R2 a leaf /Rotate shadows an inherited one, siblings untouched',
      'CONFIRMED',
      inheriting.own === null &&
        inheriting.inherited === 90 &&
        shadowed.own === 180 &&
        sibling.own === null &&
        sibling.inherited === 90 &&
        rotationOf(reopened, 4).inherited === 90,
      `page 3 inherited 90 then declared 180; page 4 still inherits 90 after reopen`,
    );
  }

  // ── R3: the inverse of rotating an inheriting page ───────────────────────
  // The finding that kills a delta-based inverse. Writing back the value that
  // *was showing* leaves a declared `/Rotate` on a leaf that previously had
  // none. Both documents render identically, so nothing downstream would notice
  // — the page has silently stopped tracking its ancestor, and a later rotation
  // of that branch will leave it behind. An inverse must therefore capture the
  // page's prior **own** value, including the case where there was none.
  {
    const doc = openWithMupdf(await buildNestedFixture());
    const original = rotationOf(doc, 3);

    doc.findPage(3).put('Rotate', 270);
    doc.findPage(3).put('Rotate', 90);
    const byWriteBack = rotationOf(doc, 3);

    doc.findPage(3).delete('Rotate');
    const byDelete = rotationOf(doc, 3);

    record(
      'R3 the inverse of an inherited rotation is delete, not write-back',
      'CONFIRMED',
      original.own === null &&
        byWriteBack.own === 90 &&
        byWriteBack.size === original.size &&
        byDelete.own === null &&
        byDelete.inherited === original.inherited,
      `write-back renders identically (${byWriteBack.size}) but leaves own=90 where own was absent; ` +
        `only delete() restores own=null, inherited=${String(byDelete.inherited)}`,
    );
  }

  // ── R4: does MuPDF normalise /Rotate? ────────────────────────────────────
  // The PDF specification requires a multiple of 90. MuPDF stores whatever it
  // is given and interprets it loosely, so normalisation is the kernel's job:
  // a document carrying `/Rotate 45` is one other readers may disagree about.
  {
    const doc = openWithMupdf(fixture);
    const QUADRANTS = [0, 90, 180, 270];
    /** @type {string[]} */
    const stored = [];
    /** @type {(number | null)[]} */
    const roundTripped = [];
    for (const value of [450, -90, 45]) {
      doc.findPage(0).put('Rotate', value);
      const round = rotationOf(openWithMupdf(saveWithMupdf(doc)), 0);
      roundTripped.push(round.own);
      stored.push(`${String(value)}->${String(round.own)} (${round.size})`);
    }

    // Computed, not asserted. Were a future MuPDF to start normalising, every
    // round-tripped value would land in a quadrant, this would read CONFIRMED
    // against a recorded REFUTED, and the case would go red — which is the only
    // thing that makes it a regression gate rather than a comment.
    const normalises = roundTripped.every((own) => own !== null && QUADRANTS.includes(own));

    record(
      'R4 MuPDF normalises /Rotate to a quadrant',
      'REFUTED',
      normalises,
      `stored verbatim through a round trip: ${stored.join(', ')} — the kernel must normalise before writing`,
    );
  }

  // ── R5: rotation must not disturb what L6 protects ───────────────────────
  {
    const doc = openWithMupdf(fixture);
    doc.findPage(1).put('Rotate', 90);
    const saved = saveWithMupdf(doc);
    const kept = await catalogKeys(saved);
    const reopened = openWithMupdf(saved);

    record(
      'R5 rotation preserves the catalog entries L6 protects',
      'CONFIRMED',
      kept.length === CATALOG_KEYS.length &&
        reopened.countPages() === 6 &&
        reopened.loadPage(0).getWidgets().length === 2 &&
        reopened.loadPage(1).getAnnotations().length === 1,
      `read back by pdf-lib: [${kept.join(', ')}]; 6 pages, 2 widgets, 1 foreign annotation intact`,
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
