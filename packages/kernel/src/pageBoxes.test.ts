import { PDFArray, PDFDocument, PDFName, PDFNumber } from '@cantoo/pdf-lib';
import { type Box, pageTransform, pdfPoint, toViewport } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { MupdfSession } from './engineSeam.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { displayedBox } from './pageBoxes.js';

/**
 * What region a page displays, with MuPDF as the control.
 *
 * ## The load-bearing cases are the ones a WELL-FORMED document cannot produce
 *
 * `displayedBox`' predecessor returned the crop box as written, and every
 * ordinary document has a crop box inside its media box — so a fixture built
 * the obvious way is a fixture the defect handles correctly. The clip only
 * shows up on a crop box that reaches outside, and there are two arithmetically
 * different ways for it to do that: fully containing the media box, and
 * overlapping one corner of it. A single containing case is satisfied by
 * *fall back to the media box*, which is not the rule.
 *
 * ## MuPDF's own transform is the independent source
 *
 * Asserting the returned box against numbers written in this file proves this
 * file agrees with itself. `PDFPage.getTransform()` is MuPDF's
 * `pdf_page_transform` — the matrix it uses to place an annotation — and it is
 * derived from the same two boxes by code nobody here wrote. The agreement case
 * maps a point through both and compares, which is what makes *this build and
 * its writer of record place a rectangle in the same spot* an assertion rather
 * than a hope.
 *
 * **The comparison is mutated towards DISAGREEMENT**, per the audit's rule for
 * a check whose property is *these two agree*: absence produces agreement too,
 * so the case that separates is one where a wrong box gives a different point.
 * The crop-bearing fixtures are what supply that — on an uncropped upright page
 * a great many wrong transforms still agree.
 */

const MEDIA: readonly [number, number] = [200, 300];

/** One page of {@link MEDIA}, with whatever `/CropBox` and `/Rotate` are asked for. */
async function page({
  crop,
  rotate,
}: {
  readonly crop?: readonly number[] | 'malformed';
  readonly rotate?: number;
}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const added = document.addPage([...MEDIA]);
  if (crop === 'malformed') {
    added.node.set(PDFName.of('CropBox'), PDFName.of('Landscape'));
  } else if (crop !== undefined) {
    const array = PDFArray.withContext(document.context);
    for (const value of crop) array.push(PDFNumber.of(value));
    added.node.set(PDFName.of('CropBox'), array);
  }
  if (rotate !== undefined) added.node.set(PDFName.of('Rotate'), PDFNumber.of(rotate));
  return document.save({ useObjectStreams: false });
}

/** Opens a fixture, runs `work` against page 0's object, and closes. */
async function onPage<T>(
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

/** `displayedBox` for page 0 of a fixture. */
function boxFor(bytes: Uint8Array): Promise<Box | null> {
  return onPage(bytes, (session) =>
    withDocument(session, (document) => displayedBox(document.loadPage(0).getObject())),
  );
}

describe('displayedBox', () => {
  it('is the media box when the page declares no crop box', async () => {
    expect(await boxFor(await page({}))).toStrictEqual({ x0: 0, y0: 0, x1: 200, y1: 300 });
  });

  it('is the crop box when it sits inside the media box', async () => {
    expect(await boxFor(await page({ crop: [50, 100, 150, 250] }))).toStrictEqual({
      x0: 50,
      y0: 100,
      x1: 150,
      y1: 250,
    });
  });

  it('orders the corners of a box written diagonally the other way', async () => {
    // The format specifies a rectangle by ANY two opposite corners, so this is
    // the same region as the case above and must read as the same box.
    expect(await boxFor(await page({ crop: [150, 250, 50, 100] }))).toStrictEqual({
      x0: 50,
      y0: 100,
      x1: 150,
      y1: 250,
    });
  });

  it('clips a crop box that contains the media box', async () => {
    // THE SEPARATOR. Returning the crop box as written gives
    // {-20,-30,400,500}; MuPDF's transform for this page is the media box's.
    expect(await boxFor(await page({ crop: [-20, -30, 400, 500] }))).toStrictEqual({
      x0: 0,
      y0: 0,
      x1: 200,
      y1: 300,
    });
  });

  it('clips a crop box that overlaps one corner of the media box', async () => {
    // The second separator, and it is not the same arithmetic: a rule spelt
    // "if the crop box is not contained, use the media box" passes the case
    // above and answers {0,0,200,300} here, where the region displayed is
    // {0,0,100,150}.
    expect(await boxFor(await page({ crop: [-20, -30, 100, 150] }))).toStrictEqual({
      x0: 0,
      y0: 0,
      x1: 100,
      y1: 150,
    });
  });

  it('is null when the crop box and the media box do not overlap', async () => {
    expect(await boxFor(await page({ crop: [400, 500, 600, 700] }))).toBeNull();
  });

  it('is null when the crop box has no area', async () => {
    expect(await boxFor(await page({ crop: [50, 50, 50, 50] }))).toBeNull();
  });

  it('falls back to the media box when the crop box is not four numbers', async () => {
    // A page every other reader opens. Refusing to place anything on it would
    // be stricter than the readers the document has already been through.
    expect(await boxFor(await page({ crop: 'malformed' }))).toStrictEqual({
      x0: 0,
      y0: 0,
      x1: 200,
      y1: 300,
    });
  });
});

/**
 * The four corners of the media box plus one asymmetric interior point.
 *
 * Asymmetric on purpose: a point at the centre of the page maps to the centre
 * under every rotation, so a transform that turned the page the wrong way round
 * would agree with a correct one there.
 */
const PROBES: readonly (readonly [number, number])[] = [
  [0, 0],
  [200, 300],
  [10, 20],
  [110, 70],
];

describe('displayedBox agrees with MuPDF about where a point lands', () => {
  const fixtures: readonly {
    readonly name: string;
    readonly crop?: readonly number[];
    readonly rotate?: number;
  }[] = [
    { name: 'upright, no crop box' },
    { name: 'upright, cropped', crop: [50, 100, 150, 250] },
    { name: 'rotated 90, no crop box', rotate: 90 },
    { name: 'rotated 90, cropped', crop: [50, 100, 150, 250], rotate: 90 },
    { name: 'rotated 180, cropped', crop: [50, 100, 150, 250], rotate: 180 },
    { name: 'rotated 270, cropped', crop: [50, 100, 150, 250], rotate: 270 },
    { name: 'crop box containing the media box', crop: [-20, -30, 400, 500] },
    { name: 'crop box overlapping one corner', crop: [-20, -30, 100, 150] },
  ];

  for (const fixture of fixtures) {
    it(`maps every probe to MuPDF's own point — ${fixture.name}`, async () => {
      const bytes = await page(fixture);
      const measured = await onPage(bytes, (session) =>
        withDocument(session, (document) => {
          const loaded = document.loadPage(0);
          const box = displayedBox(loaded.getObject());
          if (box === null) throw new Error('this fixture displays a region and must have a box');
          const transform = pageTransform(box, fixture.rotate ?? 0, 1);
          const [a, b, c, d, e, f] = loaded.getTransform();
          return PROBES.map(([x, y]) => {
            const ours = toViewport(pdfPoint(x, y), transform);
            return {
              ours: [ours.x, ours.y],
              // MuPDF's matrix is [a b c d e f] exactly as the format writes
              // one, applied here rather than through `fromXObject` because
              // that function's return brand says PDF space and this point is
              // in the page's displayed space.
              theirs: [a * x + c * y + e, b * x + d * y + f],
            };
          });
        }),
      );

      for (const { ours, theirs } of measured) {
        expect(ours[0]).toBeCloseTo(theirs[0] ?? Number.NaN, 9);
        expect(ours[1]).toBeCloseTo(theirs[1] ?? Number.NaN, 9);
      }
    });
  }

  it('separates: a transform built from the UNCLIPPED crop box disagrees', async () => {
    // THE CONTROL FOR THE CONTROL. Every case above asserts agreement, and
    // agreement is also what a comparison of two identical mistakes produces —
    // or what a `toBeCloseTo` against `undefined` would produce if the matrix
    // were read wrongly. This runs the same comparison with the box the
    // predecessor returned, and requires it to DIFFER, so the agreement above
    // is a property of the clip rather than of the assertion.
    const bytes = await page({ crop: [-20, -30, 400, 500] });
    const gap = await onPage(bytes, (session) =>
      withDocument(session, (document) => {
        const loaded = document.loadPage(0);
        const unclipped: Box = { x0: -20, y0: -30, x1: 400, y1: 500 };
        const ours = toViewport(pdfPoint(10, 20), pageTransform(unclipped, 0, 1));
        const [a, b, c, d, e, f] = loaded.getTransform();
        return {
          ours: [ours.x, ours.y],
          theirs: [a * 10 + c * 20 + e, b * 10 + d * 20 + f],
        };
      }),
    );
    expect(gap.ours).not.toStrictEqual(gap.theirs);
  });
});
