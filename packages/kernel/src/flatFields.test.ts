import { PDFDocument, PDFName, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { MupdfSession } from './engineSeam.js';
import { detectFlatFields } from './flatFields.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * Detecting where a flat page's fields probably are.
 *
 * ## The fixtures are the measurement's, and the ground truth is the generator's
 *
 * `scripts/research/flatFieldDetection.mjs` scored four candidate rules against
 * six drawn pages and only one of them separates. These cases are that result
 * pinned: a form is fully found, a filled table produces nothing, and — the
 * case the row exists to survive — a page carrying both finds the two fields
 * and none of the twenty cells.
 *
 * ## And the geometry is asserted on the two shapes that could falsify it
 *
 * The device reports display space, y **down**, and a create takes PDF user
 * space, y up. An upright page whose CropBox starts at the origin agrees with
 * several wrong conversions; a rotated page and a cropped one do not — which is
 * the fixture rule the create row was built under, one module along.
 */

const PAGE = { width: 612, height: 792 } as const;

/** Every fixture's ink, so a separator cannot be an artefact of two styles. */
const INK = { width: 1, colour: rgb(0, 0, 0), size: 10 } as const;

/**
 * A page with labelled rule lines, and optionally a filled table beside them.
 *
 * @param options `rotate` and `crop` are the two shapes that separate a
 *   conversion through the page's frame from one that assumes an upright page
 *   at the origin.
 */
async function flatPage(options: {
  readonly labels?: readonly string[];
  readonly tableRows?: number;
  readonly rotate?: number;
  readonly crop?: readonly [number, number, number, number];
} = {}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE.width, PAGE.height]);
  const font = await document.embedFont(StandardFonts.Helvetica);

  let y = 700;
  for (const label of options.labels ?? []) {
    page.drawText(`${label}:`, { x: 60, y: y + 4, size: INK.size, font });
    page.drawLine({
      start: { x: 150, y },
      end: { x: 540, y },
      thickness: INK.width,
      color: INK.colour,
    });
    y -= 40;
  }

  for (let row = 0; row < (options.tableRows ?? 0); row += 1) {
    for (const [index, left] of [60, 200, 340, 480].entries()) {
      page.drawRectangle({
        x: left,
        y,
        width: 140,
        height: 24,
        borderWidth: INK.width,
        borderColor: INK.colour,
      });
      // TEXT INSIDE, which is what makes it a cell rather than a place to
      // write — and the only feature that separates the two populations.
      page.drawText(`r${String(row)}c${String(index)}`, {
        x: left + 6,
        y: y + 7,
        size: INK.size,
        font,
      });
    }
    y -= 24;
  }

  if (options.rotate !== undefined) {
    page.node.set(PDFName.of('Rotate'), document.context.obj(options.rotate));
  }
  if (options.crop !== undefined) {
    page.node.set(PDFName.of('CropBox'), document.context.obj([...options.crop]));
  }
  return document.save();
}

/**
 * A `/Rotate 90` page whose content READS correctly on screen.
 *
 * Measured 2026-09-08: on a page turned 90°, display space takes user `y` as
 * its `x` and user `x` as its `y`. So a rule that is horizontal on screen is a
 * VERTICAL line in the file, and a label beside it is text turned a quarter
 * turn. Drawing the ink upright and declaring `/Rotate` produces a page that
 * reads sideways, which is a different fixture and has its own case.
 */
async function rotatedPage(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE.width, PAGE.height]);
  const font = await document.embedFont(StandardFonts.Helvetica);

  // ON SCREEN: a rule from x=150 to x=540 at y=92.
  page.drawLine({
    start: { x: 92, y: 150 },
    end: { x: 92, y: 540 },
    thickness: INK.width,
    color: INK.colour,
  });
  // ON SCREEN: `Full name:` immediately to its left, on the same line.
  page.drawText('Full name:', { x: 96, y: 100, size: INK.size, font, rotate: degrees(90) });

  page.node.set(PDFName.of('Rotate'), document.context.obj(90));
  return document.save();
}

async function onSession<T>(
  bytes: Uint8Array,
  work: (session: MupdfSession) => Promise<T>,
): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await work(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

function detected(bytes: Uint8Array) {
  return onSession(bytes, (session) => detectFlatFields(session, 0));
}

describe('detectFlatFields', () => {
  it('FINDS EVERY LABELLED RULE on a flat form, and names each from its label', async () => {
    const found = await detected(await flatPage({ labels: ['Full name', 'Date of birth'] }));

    expect(found.truncated).toBe(false);
    expect(found.candidates.map((candidate) => candidate.name)).toStrictEqual([
      'Full_name',
      'Date_of_birth',
    ]);
    // AND THE LABEL ITSELF, because the name is derived and a reader confirming
    // a proposal needs the words the page actually carries.
    expect(found.candidates.map((candidate) => candidate.label)).toStrictEqual([
      'Full name:',
      'Date of birth:',
    ]);
  });

  it('FINDS NOTHING on a table whose cells hold values', async () => {
    // The population the row exists to avoid. A detector offering a field on
    // every cell of a financial table is worse than none: a person would delete
    // forty to keep two.
    const found = await detected(await flatPage({ tableRows: 5 }));
    expect(found.candidates).toStrictEqual([]);
  });

  it('CONTROL: on a page with both, it finds the fields and none of the cells', async () => {
    // Neither case above separates alone — the first passes for a detector that
    // proposes everything and the second for one that proposes nothing. This is
    // the page where those two answers differ, and it is also what a real
    // application form looks like.
    const found = await detected(
      await flatPage({ labels: ['Full name', 'Address'], tableRows: 5 }),
    );

    expect(found.candidates.map((candidate) => candidate.name)).toStrictEqual([
      'Full_name',
      'Address',
    ]);
  });

  it('PUTS THE BOX ABOVE THE RULE, because a line has no height to click', async () => {
    // A rule line is where somebody writes ABOVE it, and display space is
    // y-down — so a build that added rather than subtracted would put the field
    // under the line, over the next label.
    const found = await detected(await flatPage({ labels: ['Full name'] }));
    const rect = found.candidates[0]?.rect;

    expect(rect).toBeDefined();
    if (rect === undefined) throw new Error('nothing was detected');
    // WITHIN A POINT, and the half point is the stroke's own outset: a 1pt line
    // drawn at y=700 has bounds 699.5 to 700.5, which is the path MuPDF reports
    // rather than the coordinate pdf-lib was given.
    expect(Math.abs(rect.y0 - 700)).toBeLessThan(1);
    expect(rect.y1).toBeGreaterThan(rect.y0);
    // AND IT SPANS THE RULE, which is what a person drew the line for.
    expect(Math.abs(rect.x0 - 150)).toBeLessThan(1);
    expect(Math.abs(rect.x1 - 540)).toBeLessThan(1);
  });

  it('ANSWERS USER SPACE ON A ROTATED PAGE, which an upright fixture cannot check', async () => {
    // MEASURED FIRST, because the obvious fixture is the wrong one. `/Rotate`
    // turns the page for the reader and leaves the ink where it is, so a
    // horizontal rule with `/Rotate 90` reads SIDEWAYS — measured 2026-09-08,
    // a rule at user (150,700)–(540,700) arrives in display space at
    // (699.5,149.5)–(700.5,540.5), vertical, with its label above rather than
    // beside it. That page has no field a reader would recognise, and the case
    // below pins that it finds none.
    //
    // So a rotated page whose content READS correctly has its ink drawn turned,
    // which is what this fixture does: the rule is vertical in user space and
    // the label is rotated beside it, and both are horizontal on screen.
    const found = await detected(await rotatedPage());
    const rect = found.candidates[0]?.rect;

    expect(rect).toBeDefined();
    if (rect === undefined) throw new Error('nothing was detected on the rotated page');
    // THE ANSWER IS USER SPACE, where the rule is the vertical line that was
    // drawn: x≈92, y from 150 to 540. A conversion that answered display space
    // would give x 150–540, which is the same numbers on the other axis — and
    // an upright fixture cannot tell those two apart.
    expect(Math.abs(rect.x1 - 92)).toBeLessThan(1);
    expect(Math.abs(rect.y0 - 150)).toBeLessThan(1);
    expect(Math.abs(rect.y1 - 540)).toBeLessThan(1);
  });

  it('CONTROL: content that reads SIDEWAYS is not proposed, which is the measurement', async () => {
    // The fixture above would have been this one, written without measuring.
    // A rule and a label that are level in the file but stacked on screen are
    // not a labelled field to the person looking at the page, and a detector
    // that proposed one would be reading the file rather than the page.
    const found = await detected(await flatPage({ labels: ['Full name'], rotate: 90 }));
    expect(found.candidates).toStrictEqual([]);
  });

  it('ANSWERS USER SPACE ON A CROPPED PAGE, whose visible corner is not the origin', async () => {
    // The other shape an upright page at the origin agrees with every wrong
    // answer on: a conversion measured from the visible box rather than from
    // user space is off by the CropBox's corner, and only here does that show.
    const found = await detected(
      await flatPage({ labels: ['Full name'], crop: [30, 70, 580, 760] }),
    );
    const rect = found.candidates[0]?.rect;

    expect(rect).toBeDefined();
    if (rect === undefined) throw new Error('nothing was detected on the cropped page');
    expect(Math.abs(rect.x0 - 150)).toBeLessThan(1);
    expect(Math.abs(rect.y0 - 700)).toBeLessThan(1);
  });

  it('MAKES A SECOND FIELD OF THE SAME NAME UNIQUE, because a create refuses a collision', async () => {
    // Two rows labelled the same is ordinary on a real form — *Signature* twice,
    // once per party. The create refuses a duplicate name outright, so a
    // proposal carrying one would be a batch the apply throws on.
    const found = await detected(await flatPage({ labels: ['Signature', 'Signature'] }));
    expect(found.candidates.map((candidate) => candidate.name)).toStrictEqual([
      'Signature',
      'Signature_2',
    ]);
  });

  it('DROPS THE DOTS from a label, because a dot makes a parent in the field tree', async () => {
    // Measured by the create row: `owner.first` is a child of `owner`. A
    // detector reading punctuation as hierarchy would propose a field under a
    // parent nobody asked for — and `Mr. Smith` is a label, not a path.
    const found = await detected(await flatPage({ labels: ['Mr. Smith'] }));
    expect(found.candidates[0]?.name).toBe('Mr_Smith');
  });
});

/**
 * The page the owner reported: a title with a rule under it, a hint beside a place to write, boxes with a border AND a
 * background, small squares with their words on the right, and (optionally) fields the document already has.
 *
 * Detect proposed the labels, the title and the hint as fields, proposed every box twice (the second `_2`), and
 * proposed the places the fields already were. Each case below names which of those it separates.
 */
async function reportedPage(options: { readonly withFields?: boolean } = {}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE.width, PAGE.height]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const draw = (words: string, x: number, y: number): void => {
    page.drawText(words, { x, y, size: INK.size, font });
  };

  draw('Registration form', 60, 740);
  // THE TITLE'S RULE: as wide as the title, just under it.
  page.drawLine({ start: { x: 60, y: 736 }, end: { x: 60 + font.widthOfTextAtSize('Registration form', INK.size), y: 736 }, thickness: 1, color: INK.colour });

  // A BOX WITH A BORDER AND A BACKGROUND reaches the device as a fill and a stroke of one outline.
  draw('Full name', 60, 686);
  page.drawRectangle({ x: 170, y: 680, width: 300, height: 21, borderWidth: 1, borderColor: INK.colour, color: rgb(1, 1, 1) });
  draw('Date of birth', 60, 646);
  page.drawRectangle({ x: 170, y: 640, width: 100, height: 21, borderWidth: 1, borderColor: INK.colour, color: rgb(1, 1, 1) });
  // THE HINT BESIDE THE BOX, which is words and not a place to write.
  draw('DD_MM_YYYY', 280, 646);

  // TWO TICK BOXES, the word on the right.
  for (const [at, words] of [[600, 'Send me the newsletter'], [570, 'I accept the terms']] as const) {
    page.drawRectangle({ x: 60, y: at, width: 14, height: 14, borderWidth: 1, borderColor: INK.colour, color: rgb(1, 1, 1) });
    draw(words, 82, at + 3);
  }

  if (options.withFields === true) {
    const form = document.getForm();
    const name = form.createTextField('Full_name');
    name.addToPage(page, { x: 170, y: 680, width: 300, height: 21, font, borderWidth: 1 });
    const birth = form.createTextField('Date_of_birth');
    birth.addToPage(page, { x: 170, y: 640, width: 100, height: 21, font, borderWidth: 1 });
    const news = form.createCheckBox('Send_me_the_newsletter');
    news.addToPage(page, { x: 60, y: 600, width: 14, height: 14, borderWidth: 1 });
    const terms = form.createCheckBox('I_accept_the_terms');
    terms.addToPage(page, { x: 60, y: 570, width: 14, height: 14, borderWidth: 1 });
  }
  return document.save();
}

describe('detectFlatFields on the page that was reported', () => {
  it('proposes each place once, and nothing for the title, its rule, the hint or any label', async () => {
    const found = await detected(await reportedPage());
    expect(found.candidates.map((candidate) => [candidate.name, candidate.kind])).toStrictEqual([
      ['Full_name', 'text'],
      ['Date_of_birth', 'text'],
      ['Send_me_the_newsletter', 'checkbox'],
      ['I_accept_the_terms', 'checkbox'],
    ]);
    // NO `_2`: one box drawn with a border and a background is one place.
    expect(found.candidates.every((candidate) => !candidate.name.endsWith("_2"))).toBe(true);
    expect(found.alreadyFields).toBe(0);
  });

  it('proposes nothing where the document already has a field, says how many, and names no field twice', async () => {
    const found = await detected(await reportedPage({ withFields: true }));
    expect(found.candidates).toStrictEqual([]);
    expect(found.alreadyFields).toBe(4);
  });

  it('CONTROL: the same geometry as plain page content IS proposed, so the case above saw the fields and not a blind detector', async () => {
    const found = await detected(await reportedPage());
    expect(found.candidates.length).toBe(4);
  });

  it('gives a new field a name no field in the document carries', async () => {
    const document = await PDFDocument.load(await flatPage({ labels: ['Signature'] }));
    const font = await document.embedFont(StandardFonts.Helvetica);
    document.getForm().createTextField('Signature').addToPage(document.getPage(0), { x: 60, y: 300, width: 100, height: 20, font });
    const found = await detected(await document.save());
    expect(found.candidates.map((candidate) => candidate.name)).toStrictEqual(['Signature_2']);
  });
});
