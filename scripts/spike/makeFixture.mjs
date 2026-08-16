// @ts-check
/**
 * Generates the spike fixture.
 *
 * Self-generated, per Part J's fixture provenance rule: never a real-world
 * document, because a fixture carrying a stranger's name becomes permanently
 * public the moment it is pushed.
 *
 * The document is built to make invariant L6 testable, which means it must
 * actually carry the four catalog entries a page-tree rebuild is known to drop:
 *
 *   /AcroForm      form fields
 *   /Outlines      bookmarks
 *   /Names         named destinations
 *   /OCProperties  optional content groups (layers)
 *
 * A fixture without them would let a reorder that silently destroys all four
 * pass the test. Annotations are added for the same reason — the `srcRef`
 * invariant says a save must never rewrite annotations the app did not author,
 * and proving that needs annotations the app did not author.
 */

import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from '@cantoo/pdf-lib';

const PAGE_COUNT = 6;

/**
 * @returns {Promise<Uint8Array>}
 */
export async function buildFixture() {
  const doc = await PDFDocument.create();
  doc.setTitle('Monstera engine spike fixture');
  doc.setAuthor('Tenslor Inc.');
  doc.setSubject('Self-generated. Contains no real-world data.');

  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Each page is visually identifiable so a reorder can be verified by reading
  // the page text back rather than by trusting an index.
  for (let index = 0; index < PAGE_COUNT; index += 1) {
    const page = doc.addPage([600, 800]);
    page.drawText(`PAGE ${String(index + 1)}`, {
      x: 60,
      y: 700,
      size: 48,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    page.drawText(`marker-${String(index + 1)}`, { x: 60, y: 640, size: 18, font });
  }

  const pages = doc.getPages();
  const pageRefs = pages.map((page) => page.ref);

  // --- /AcroForm -----------------------------------------------------------
  const form = doc.getForm();
  const textField = form.createTextField('spike.text');
  textField.setText('original value');
  const firstPage = pages[0];
  if (firstPage === undefined) throw new Error('fixture has no pages');
  textField.addToPage(firstPage, { x: 60, y: 560, width: 240, height: 28 });

  const checkbox = form.createCheckBox('spike.check');
  checkbox.addToPage(firstPage, { x: 60, y: 510, width: 20, height: 20 });
  checkbox.check();

  // --- /Outlines -----------------------------------------------------------
  // Built through the low-level object API: pdf-lib has no outline builder, and
  // a hand-built tree is exactly what a reader has to survive.
  const context = doc.context;
  const outlinesRef = context.nextRef();

  const firstRef = pageRefs[0];
  const thirdRef = pageRefs[2];
  if (firstRef === undefined || thirdRef === undefined) throw new Error('missing page refs');

  const itemOne = context.obj({
    Title: PDFString.of('Start'),
    Parent: outlinesRef,
    Dest: [firstRef, PDFName.of('Fit')],
  });
  const itemOneRef = context.register(itemOne);

  const itemTwo = context.obj({
    Title: PDFString.of('Third page'),
    Parent: outlinesRef,
    Dest: [thirdRef, PDFName.of('Fit')],
  });
  const itemTwoRef = context.register(itemTwo);

  itemOne.set(PDFName.of('Next'), itemTwoRef);
  itemTwo.set(PDFName.of('Prev'), itemOneRef);

  context.assign(
    outlinesRef,
    context.obj({
      Type: 'Outlines',
      First: itemOneRef,
      Last: itemTwoRef,
      Count: 2,
    }),
  );
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);

  // --- /Names (named destinations) ----------------------------------------
  const namesRef = context.register(
    context.obj({
      Dests: context.obj({
        Names: [PDFString.of('intro'), [firstRef, PDFName.of('Fit')]],
      }),
    }),
  );
  doc.catalog.set(PDFName.of('Names'), namesRef);

  // --- /OCProperties (layers) ---------------------------------------------
  const ocgRef = context.register(
    context.obj({ Type: 'OCG', Name: PDFString.of('Spike layer') }),
  );
  doc.catalog.set(
    PDFName.of('OCProperties'),
    context.obj({
      OCGs: [ocgRef],
      D: context.obj({ ON: [ocgRef], Order: [ocgRef] }),
    }),
  );

  // --- A foreign annotation the app did not author -------------------------
  // Marked so the srcRef invariant has something to protect. A Square with an
  // unusual property set is deliberately not something our writers would emit.
  const secondPage = pages[1];
  if (secondPage === undefined) throw new Error('fixture needs a second page');
  const annotRef = context.register(
    context.obj({
      Type: 'Annot',
      Subtype: 'Square',
      Rect: [72, 400, 300, 520],
      C: [1, 0, 0],
      T: PDFString.of('foreign-author'),
      Contents: PDFString.of('authored by another application'),
      F: 4,
    }),
  );
  secondPage.node.set(PDFName.of('Annots'), context.obj([annotRef]));

  return doc.save({ useObjectStreams: false });
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  process.argv[1].replace(/\\/g, '/').endsWith('scripts/spike/makeFixture.mjs');

if (invokedDirectly) {
  const bytes = await buildFixture();
  process.stdout.write(`fixture built: ${String(bytes.byteLength)} bytes\n`);
}
