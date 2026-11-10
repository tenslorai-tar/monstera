import { describe, expect, it } from 'vitest';

import { mupdfWriter } from './mupdfWriter.js';
import * as mupdf from './mupdfRaw.js';
import { applyAddAnnotation } from './pageAnnotations.js';
import { applyApplyRedactions } from './pageRedact.js';

/**
 * A page of thousands of drawings keeps about its size through a burn-in (the owner's item 5, 2026-11-06): the cut
 * (`mz_cut_line_art`, ADR-0286) writes a run of joined edges as one polygon, not each edge as its own quadrilateral.
 * Measured before the change on this page: the content grew from 151,983 to 222,086 bytes under one mark, almost all of
 * it six cut shapes written as stacks of slices; the owner's document grew from 132,274 to 402,373.
 *
 * The control is the picture: inside the mark nothing is drawn, and beyond {@link NEAR} pixels of it no pixel moves by
 * more than {@link SHADE} grey levels. Measured 2026-11-06 at 4x, the burned-in page drawn by the cut before this change
 * and after it differ in 0 of 7,755,264 pixels: the runs are the same drawing. What the cut changes outside the mark is
 * `redactionOutside.test.ts`' subject and ADR-0286's amendment of 2026-11-07: since it, this page's content comes back
 * at 145,047 bytes, and what still moves (143 pixels at 4x, worst 14 levels, 9 points out) is all on thin lines cut short
 * where they cross the mark, which the renderer draws a little differently from the whole line.
 */
const NEAR = 10;
const SHADE = 8;

const MARK = { x0: 100, y0: 592, x1: 200, y1: 692 } as const;
const STAMP = { author: 'Priya Raman', created: '2026-11-06T09:00:00.000Z' } as const;

/** 4,000 drawings: filled boxes, stroked lines, filled curves and stroked squares drawn through a transform. */
function drawings(): Uint8Array {
  const document = new mupdf.PDFDocument();
  try {
    let content = '';
    let seed = 3;
    for (let at = 0; at < 4000; at += 1) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const x = 20 + (seed % 560);
      const y = 20 + ((seed >>> 10) % 740);
      const kind = at % 4;
      if (kind === 0) content += `${String((seed % 100) / 100)} g ${String(x)} ${String(y)} 12.5 8.25 re f\n`;
      else if (kind === 1) content += `0.5 w ${String(x)} ${String(y)} m ${String(x + 20.75)} ${String(y + 3.5)} l S\n`;
      else if (kind === 2) content += `${String(x)} ${String(y)} m ${String(x + 5)} ${String(y + 9)} ${String(x + 11)} ${String(y - 4)} ${String(x + 15)} ${String(y + 2)} c h f\n`;
      else content += `q 1 0 0 1 ${String(x)} ${String(y)} cm 0 0 m 6 0 l 6 6 l 0 6 l h S Q\n`;
    }
    document.insertPage(-1, document.addPage([0, 0, 612, 792], 0, document.addObject({}), content));
    return document.saveToBuffer('garbage,compress').asUint8Array().slice();
  } finally {
    document.destroy();
  }
}

/** The page's decoded content, every stream of it. */
function contentLength(bytes: Uint8Array): number {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the case expected a PDF');
  try {
    const contents = document.findPage(0).get('Contents');
    let total = 0;
    if (contents.isArray()) contents.forEach((each) => (total += each.readStream().getLength()));
    else total = contents.readStream().getLength();
    if (total === 0) throw new Error('no content was read, so the comparison would mean nothing');
    return total;
  } finally {
    document.destroy();
  }
}

/** The page drawn at 2x in grey, its content only, rows top down. */
function drawn(bytes: Uint8Array): { readonly width: number; readonly samples: Uint8Array } {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  try {
    const page = document.loadPage(0);
    const pixmap = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceGray, false, false);
    try {
      return { width: pixmap.getWidth(), samples: Uint8Array.from(pixmap.getPixels()) };
    } finally {
      pixmap.destroy();
    }
  } finally {
    document.destroy();
  }
}

async function burnedIn(bytes: Uint8Array): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes);
  try {
    await applyAddAnnotation(session, {
      kind: 'addAnnotation',
      page: 0,
      stamp: STAMP,
      annotation: { type: 'redact', over: 'region', rect: MARK, colour: [0, 0, 0], opacity: 1 },
    });
    await applyApplyRedactions(session, { kind: 'applyRedactions', pages: 'all', cover: 'none', images: 'pixels', keepTitle: false, keepBookmarks: false });
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * One curve stroked 1.2 points wide across the mark's right side at x 200, or its mirror image across the left side at
 * x 100. A stroke that wide crossing a mark is outlined whole (ADR-0286's amendment, accepted by the owner on
 * 2026-11-07), and the outline of the part outside the mark is the same size either side.
 */
function oneCurve(side: 'right' | 'left'): Uint8Array {
  const document = new mupdf.PDFDocument();
  try {
    // MIRRORED ABOUT x = 150, the mark's own middle, so the part outside it is the same curve turned round.
    const x = (at: number) => String(side === 'right' ? at : 300 - at);
    const content = `1.2 w ${x(195)} 630 m ${x(201)} 646 ${x(207)} 614 ${x(213)} 634 c S\n`;
    document.insertPage(-1, document.addPage([0, 0, 612, 792], 0, document.addObject({}), content));
    return document.saveToBuffer('garbage,compress').asUint8Array().slice();
  } finally {
    document.destroy();
  }
}

describe('a wide stroke across a mark costs the same on either side of it', () => {
  // THE CAUSE, measured 2026-11-10 with `scripts/research/redactCutTiming.mjs`' page of 4,000 drawings: the cut's slabs
  // ran right to beyond the ink, so every edge inside the mark left a sliver between the mark's right side and there.
  // They cancel and nothing shows, but each is written: three such curves were 160 KB of that page's 291,383 bytes. A
  // curve across the mark's LEFT side had none, which is what makes its mirror image the control.
  it('the curve across the right side is written no larger than its mirror image across the left', async () => {
    const right = contentLength(await burnedIn(oneCurve('right')));
    const left = contentLength(await burnedIn(oneCurve('left')));
    expect(left, 'the cut wrote the outline, so the comparison is of something').toBeGreaterThan(1000);
    expect(right).toBeLessThanOrEqual(left * 1.05);
  }, 60_000);

  it('CONTROL: the curve across the right side is drawn as before outside the mark, and not at all inside it', async () => {
    const bytes = oneCurve('right');
    const was = drawn(bytes);
    const now = drawn(await burnedIn(bytes));
    const inside = (x: number, y: number, by: number) => x >= 200 + by && x < 400 - by && y >= 200 + by && y < 400 - by;
    const differing: { x: number; y: number; was: number; now: number }[] = [];
    let inked = 0;
    let wasInked = 0;
    let outsideInk = 0;
    for (let at = 0; at < was.samples.length; at += 1) {
      const x = at % was.width;
      const y = Math.floor(at / was.width);
      if (inside(x, y, 1)) {
        if ((now.samples[at] ?? 255) < 255) inked += 1;
        if ((was.samples[at] ?? 255) < 255) wasInked += 1;
      } else if (!inside(x, y, -NEAR)) {
        // BEYOND NEAR, as the page's own control reads it: within it a stroke cut short at the mark is drawn a little
        // differently by the renderer, which ADR-0286's amendment measured and the owner accepted on 2026-11-07.
        if ((now.samples[at] ?? 255) < 255) outsideInk += 1;
        const shade = Math.abs((now.samples[at] ?? 0) - (was.samples[at] ?? 0));
        if (shade > SHADE) differing.push({ x, y, was: was.samples[at] ?? 0, now: now.samples[at] ?? 0 });
      }
    }
    expect(wasInked, 'the curve drew under the mark before').toBeGreaterThan(20);
    expect(outsideInk, 'the part outside the mark is still drawn').toBeGreaterThan(20);
    expect(inked).toBe(0);
    // THE ONE PIXEL THE CUT ALREADY MOVED, and no other: read 2026-11-10 from this case with the shim built before this
    // change and after it, the same pixel by the same amount both times, ten pixels right of the mark, 9 levels where
    // SHADE allows 8. Pinned rather than allowed, so a cut that moves any pixel the old one did not turns this red.
    expect(differing).toStrictEqual([{ x: 410, y: 327, was: 132, now: 123 }]);
  }, 60_000);
});

describe('a burn-in on a page of thousands of drawings', () => {
  it('keeps the content within a tenth of its size, where it grew by nearly half', async () => {
    const bytes = drawings();
    const before = contentLength(bytes);
    const after = contentLength(await burnedIn(bytes));
    expect(after).toBeLessThan(before * 1.1);
  }, 60_000);

  it('CONTROL: draws the same page outside the mark, and nothing inside it', async () => {
    const bytes = drawings();
    const was = drawn(bytes);
    const now = drawn(await burnedIn(bytes));
    // THE MARK IN PIXELS at 2x, top down: x 200 to 400, y (792 - 692) * 2 = 200 to (792 - 592) * 2 = 400.
    const inside = (x: number, y: number, by: number) => x >= 200 + by && x < 400 - by && y >= 200 + by && y < 400 - by;
    let differing = 0;
    let inked = 0;
    let wasInked = 0;
    for (let at = 0; at < was.samples.length; at += 1) {
      const x = at % was.width;
      const y = Math.floor(at / was.width);
      if (inside(x, y, 1)) {
        if ((now.samples[at] ?? 255) < 255) inked += 1;
        if ((was.samples[at] ?? 255) < 255) wasInked += 1;
      } else if (!inside(x, y, -NEAR) && Math.abs((now.samples[at] ?? 0) - (was.samples[at] ?? 0)) > SHADE) {
        differing += 1;
      }
    }
    expect(wasInked, 'the page drew under the mark before, so the read is of something').toBeGreaterThan(1000);
    expect(inked).toBe(0);
    expect(differing).toBe(0);
  }, 60_000);
});
