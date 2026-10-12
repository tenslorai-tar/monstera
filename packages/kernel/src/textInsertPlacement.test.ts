import { PDFArray, PDFDocument as LibDocument, PDFName, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { blockEditOf, type CommandOfKind, type PageInsert } from '@monstera/contract/host';
import { asDocVersion, newTextBox, pageTransform, toPdf, viewportPoint } from '@monstera/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bindEditFaces, bindEditFolders } from './editFaces.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyEditTextOperators } from './textOperatorEdit.js';

/**
 * Text added with Add text is ON THE PAGE where it was pressed, at every height down the page, on every turn of the page
 * and on a page whose box does not start at the origin (the owner's W1: words typed 85% or more down a page turned half
 * round were gone when the editor ended, and kept at 78%).
 *
 * ## Why this reads the page WITH MuPDF's clip
 *
 * The write's own read-back (`textOperatorEdit.ts`) reads with `clip=no`, on purpose: a word wider than the page is kept
 * and said, never refused. So a box written off the page is a box that "wrote", and the person sees nothing — the
 * silent drop. This reading clips to the page as a reader shows it, so a word here is a word a person can see.
 *
 * The press is turned into the box exactly as the editor does it (`TextEditLayer.tsx`' `freshBox`): the point through
 * the page transform, the left clamped into the page's width, the first baseline 0.8 of the size below the press.
 *
 * The CONTROL is a press below the page's foot, whose words must be found NOT on the page, so the reading is shown able
 * to tell a word on the page from one written beyond it.
 */

/**
 * ONE LINE OF THE NARROWEST MEASURE (56 points of Helvetica at 12 against 80): what this proves is where the box STARTS.
 * Words that wrap and grow past the page's edge are the owner's Q7, kept and said by the editor (`pastItsPage`), and that
 * is only possible while the box's first line is on the page, where the next read finds it.
 */
const WORDS = 'Added words';
const SIZE = 12;

interface Shape {
  readonly name: string;
  readonly rotate: number;
  readonly crop: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  /** Content drawn under a half turn it never restores, as a scan turned by its producer is. */
  readonly turnedContent: boolean;
}

const LETTER = { x0: 0, y0: 0, x1: 612, y1: 792 };
const INSET = { x0: 36, y0: 54, x1: 576, y1: 756 };

const SHAPES: readonly Shape[] = [
  ...[0, 90, 180, 270].map((rotate) => ({ name: `turned ${String(rotate)}`, rotate, crop: LETTER, turnedContent: false })),
  ...[0, 90, 180, 270].map((rotate) => ({ name: `turned ${String(rotate)}, box from (36, 54)`, rotate, crop: INSET, turnedContent: false })),
  { name: 'turned 180 by /Rotate over content turned 180 by its matrix', rotate: 180, crop: LETTER, turnedContent: true },
];

async function pageOf(shape: Shape): Promise<Uint8Array> {
  const document = await LibDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('Existing words on the page', { x: 72, y: 700, size: 12, font });
  if (shape.turnedContent) {
    // A HALF TURN NEVER RESTORED, before everything the page draws, so the content ends under it and an added box is
    // written through its inverse.
    const turn = document.context.register(document.context.flateStream('q -1 0 0 -1 612 792 cm\n'));
    const drawn = page.node.get(PDFName.of('Contents'));
    const streams = drawn instanceof PDFArray ? drawn.asArray() : drawn === undefined ? [] : [drawn];
    page.node.set(PDFName.of('Contents'), document.context.obj([turn, ...streams]));
  }
  page.setCropBox(shape.crop.x0, shape.crop.y0, shape.crop.x1 - shape.crop.x0, shape.crop.y1 - shape.crop.y0);
  page.setRotation(degrees(shape.rotate));
  return document.save();
}

/** The insert a press at `across` and `down` of the page as shown makes, by the editor's own rule. */
function insertAt(shape: Shape, across: number, down: number): PageInsert {
  const transform = pageTransform(shape.crop, shape.rotate, 1);
  const at = toPdf(viewportPoint(transform.viewport.width * across, transform.viewport.height * down), transform);
  const box = newTextBox(at, shape.crop, SIZE);
  return { left: box.left, baseline: box.baseline, measure: box.measure, size: SIZE, text: WORDS };
}

const command = (insert: PageInsert): CommandOfKind<'editTextOperators'> => ({
  kind: 'editTextOperators',
  page: 0,
  ...blockEditOf([], [insert]),
  fit: 'reflow',
  version: asDocVersion(1),
});

/** Whether the added words are on the page as a reader shows it: MuPDF's reading, clipped to the page. */
async function onThePage(bytes: Uint8Array, insert: PageInsert): Promise<boolean> {
  const session = await mupdfWriter.open(bytes);
  try {
    // THE PAGE'S ONE TEXT OBJECT, as PDFium's read numbers it: the existing line, which the edit leaves alone.
    await applyEditTextOperators(session, command(insert), { textObjects: [0], runs: [] });
    const saved = await mupdfWriter.serialise(session);
    const reopened = await mupdfWriter.open(saved);
    try {
      const text = await withDocument(reopened, (document) => document.loadPage(0).toStructuredText().asText());
      return text.replace(/\s+/gu, ' ').includes(WORDS);
    } finally {
      await mupdfWriter.close(reopened);
    }
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('text added with Add text is on the page where it was pressed', () => {
  // THE BUNDLED FACES, as the host binds them: an added box is set in one where the page's own fonts do not carry it.
  beforeEach(() => {
    bindEditFolders(process.env['MONSTERA_FONTS_DIRECTORY'] ?? '', null);
  });
  afterEach(() => {
    bindEditFaces(null);
  });

  it('CONTROL: words pressed below the page’s foot are written and are not on the page, so the reading can tell', async () => {
    const shape = SHAPES[0];
    if (shape === undefined) throw new Error('no shape');
    expect(await onThePage(await pageOf(shape), { ...insertAt(shape, 0.15, 0.5), baseline: -40 })).toBe(false);
  });

  for (const shape of SHAPES) {
    for (const across of [0.02, 0.15, 0.98]) {
      for (const down of [0.02, 0.5, 0.78, 0.85, 0.89, 0.95, 0.99]) {
        it(`${shape.name}: pressed ${String(Math.round(down * 100))}% down and ${String(Math.round(across * 100))}% across`, async () => {
          expect(await onThePage(await pageOf(shape), insertAt(shape, across, down))).toBe(true);
        });
      }
    }
  }
});
