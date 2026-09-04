import { PDFArray, PDFDocument, PDFName, PDFNumber } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { CommandOfKind } from '@monstera/contract';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyCropPages, captureCropPages, invertCropPages } from './pageCrop.js';

/**
 * Cropping, read back through a DIFFERENT library than the one that wrote.
 *
 * ## Every page is a different size, which a uniform fixture cannot show
 *
 * The command carries **margins** rather than a rectangle precisely because
 * pages need not agree, so a fixture whose pages agree makes *insetting each
 * page's own box* and *writing one box to every page* the same observation.
 *
 * ## The crop box and the media box are asserted separately
 *
 * Cropping by shrinking `/MediaBox` throws the content away and renders the
 * same. Only a case that reads both says which one happened.
 */
const WIDTH_BASE = 100;

/** Three pages of different sizes, none of them carrying a `/CropBox`. */
async function sizedDocument(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < 3; index += 1) {
    document.addPage([WIDTH_BASE + index * 50, 500 + index * 50]);
  }
  return document.save({ useObjectStreams: false });
}

/** The same, with page 1 declaring a `/CropBox` already inset by 10. */
async function preCropped(): Promise<Uint8Array> {
  const document = await PDFDocument.load(await sizedDocument());
  const page = document.getPages()[1];
  if (page === undefined) throw new Error('the fixture lost a page');
  const box = PDFArray.withContext(document.context);
  for (const value of [10, 10, WIDTH_BASE + 50 - 10, 550 - 10]) box.push(PDFNumber.of(value));
  page.node.set(PDFName.of('CropBox'), box);
  return document.save({ useObjectStreams: false });
}

/**
 * A page whose `/CropBox` is a NAME rather than an array.
 *
 * Malformed and openable in every other reader, which is the shape
 * `rotatePages` uses for the same purpose: a capture that cannot record prior
 * state is an outcome, not a caller error.
 */
async function malformed(): Promise<Uint8Array> {
  const document = await PDFDocument.load(await sizedDocument());
  const page = document.getPages()[0];
  if (page === undefined) throw new Error('the fixture lost a page');
  page.node.set(PDFName.of('CropBox'), PDFName.of('Landscape'));
  return document.save({ useObjectStreams: false });
}

/** Each page's own `/CropBox` and `/MediaBox`, read off a live session. */
function boxesOf(session: Parameters<typeof applyCropPages>[0]): Promise<{
  readonly crop: (readonly number[] | null)[];
  readonly media: (readonly number[] | null)[];
}> {
  return withDocument(session, (document) => {
    const read = (object: ReturnType<typeof document.findPage>): readonly number[] | null => {
      if (!object.isArray()) return null;
      const values: number[] = [];
      for (let index = 0; index < object.length; index += 1) {
        values.push(object.get(index).asNumber());
      }
      return values;
    };
    const crop: (readonly number[] | null)[] = [];
    const media: (readonly number[] | null)[] = [];
    for (let page = 0; page < document.countPages(); page += 1) {
      const object = document.loadPage(page).getObject();
      crop.push(read(object.get('CropBox')));
      media.push(read(object.get('MediaBox')));
    }
    return { crop, media };
  });
}

/** Runs `work` against a live session over `bytes`. */
async function against<T>(
  bytes: Uint8Array,
  work: (session: Parameters<typeof applyCropPages>[0]) => Promise<T>,
): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await work(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

const MARGINS = { top: 5, right: 10, bottom: 15, left: 20 } as const;

describe('applyCropPages', () => {
  it('INSETS EACH PAGE FROM ITS OWN BOX, which one rectangle cannot do', async () => {
    const boxes = await against(await sizedDocument(), async (session) => {
      await applyCropPages(session, { kind: 'cropPages', pages: [0, 1], margins: MARGINS });
      return boxesOf(session);
    });

    // Page 0 is 100×500 and page 1 is 150×550. A command that wrote one
    // rectangle would put the same four numbers on both, which is the same
    // page count, the same key, and a document that clips one page and leaves
    // white on the other.
    expect(boxes.crop[0]).toStrictEqual([20, 15, 90, 495]);
    expect(boxes.crop[1]).toStrictEqual([20, 15, 140, 545]);
    // AND PAGE 2 IS UNTOUCHED, because the command did not name it.
    expect(boxes.crop[2]).toBeNull();
  });

  it('LEAVES /MediaBox ALONE, which is the difference between cropping and cutting', async () => {
    // Shrinking the media box renders identically and throws the margin away —
    // the page no longer HAS it, and undo could not bring it back without a
    // checkpoint. Only reading both keys separates the two.
    const boxes = await against(await sizedDocument(), async (session) => {
      await applyCropPages(session, { kind: 'cropPages', pages: [0], margins: MARGINS });
      return boxesOf(session);
    });

    expect(boxes.media[0]).toStrictEqual([0, 0, 100, 500]);
  });

  it('INSETS FROM THE EXISTING CROP BOX when the page already has one', async () => {
    // A second crop compounds. Insetting from `/MediaBox` regardless would
    // widen the visible area on a page already cropped — a crop that uncrops.
    const boxes = await against(await preCropped(), async (session) => {
      await applyCropPages(session, { kind: 'cropPages', pages: [1], margins: MARGINS });
      return boxesOf(session);
    });

    expect(boxes.crop[1]).toStrictEqual([30, 25, 130, 535]);
  });

  it('REFUSES margins that leave a page with no visible area, before writing anything', async () => {
    // The page named is the SECOND of two, so a command that wrote as it went
    // would have cropped page 0 already. The assertion is that it did not.
    const boxes = await against(await sizedDocument(), async (session) => {
      await expect(
        applyCropPages(session, {
          kind: 'cropPages',
          pages: [0, 1],
          margins: { top: 300, right: 100, bottom: 300, left: 100 },
        }),
      ).rejects.toThrow(/no visible area/u);
      return boxesOf(session);
    });

    expect(boxes.crop).toStrictEqual([null, null, null]);
  });

  it('REFUSES a page the document does not have', async () => {
    await against(await sizedDocument(), async (session) => {
      await expect(
        applyCropPages(session, { kind: 'cropPages', pages: [9], margins: MARGINS }),
      ).rejects.toThrow(/outside this document/u);
    });
  });

  it('RESOLVES `all` to every page, so a whole-document crop crosses as two words', async () => {
    // Invariant L11: a list for every page is one integer per page, which
    // scales with the document. The scope is resolved where the count is
    // already known.
    //
    // The pages differ in size, so this also says each was inset from its OWN
    // box — a resolution that produced the right COUNT and one rectangle would
    // pass a page-count assertion perfectly.
    const boxes = await against(await sizedDocument(), async (session) => {
      await applyCropPages(session, { kind: 'cropPages', pages: 'all', margins: MARGINS });
      return boxesOf(session);
    });

    expect(boxes.crop).toStrictEqual([
      [20, 15, 90, 495],
      [20, 15, 140, 545],
      [20, 15, 190, 595],
    ]);
  });

  it('CONTROL: zero margins are legal and write the box unchanged', async () => {
    // A no-op crop is a legal command with an inverse that changes nothing.
    // Refusing it would be a branch the bus never takes, and it is what a
    // surface sends when a person clears the fields.
    const boxes = await against(await sizedDocument(), async (session) => {
      await applyCropPages(session, {
        kind: 'cropPages',
        pages: [0],
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
      });
      return boxesOf(session);
    });

    expect(boxes.crop[0]).toStrictEqual([0, 0, 100, 500]);
  });
});

describe('captureCropPages and invertCropPages', () => {
  it('RESTORES ABSENCE, which writing the media box back would not', async () => {
    // §3's rule on a second key. A page that displayed its media box because it
    // declared no crop box must come back declaring none: a write-back renders
    // identically, and the NEXT crop would then inset from a box the page never
    // had — which is how a document drifts one undo at a time.
    const boxes = await against(await sizedDocument(), async (session) => {
      // NOT `as const` on the whole literal: the scope is a union with an
      // array member, and a `readonly [0]` is not assignable to `number[]`.
      const command: CommandOfKind<'cropPages'> = {
        kind: 'cropPages',
        pages: [0],
        margins: MARGINS,
      };
      const capture = await captureCropPages(session, command);
      if (!capture.captured) throw new Error('the capture was refused');
      expect(capture.prior).toStrictEqual([{ page: 0, prior: { present: false } }]);

      await applyCropPages(session, command);
      await invertCropPages(session, capture.prior);
      return boxesOf(session);
    });

    expect(boxes.crop[0]).toBeNull();
  });

  it('RESTORES A PRIOR BOX VERBATIM', async () => {
    const boxes = await against(await preCropped(), async (session) => {
      const command: CommandOfKind<'cropPages'> = {
        kind: 'cropPages',
        pages: [1],
        margins: MARGINS,
      };
      const capture = await captureCropPages(session, command);
      if (!capture.captured) throw new Error('the capture was refused');

      await applyCropPages(session, command);
      await invertCropPages(session, capture.prior);
      return boxesOf(session);
    });

    expect(boxes.crop[1]).toStrictEqual([10, 10, 140, 540]);
  });

  it('a MALFORMED /CropBox is NOT CAPTURED, with a reason', async () => {
    // The distinction ADR-0009's 2026-08-19 decision draws, and `rotatePages`
    // holds the same one for `/Rotate`: prior state that cannot be recorded is
    // an outcome the bus answers with a checkpoint, not a caller error.
    await against(await malformed(), async (session) => {
      const capture = await captureCropPages(session, {
        kind: 'cropPages',
        pages: [0],
        margins: MARGINS,
      });

      expect(capture.captured).toBe(false);
      if (capture.captured) throw new Error('the capture should have been refused');
      expect(capture.reason).toMatch(/not four numbers/u);
    });
  });

  it('CONTROL: a well-formed prior box IS captured, so the refusal is not universal', async () => {
    await against(await preCropped(), async (session) => {
      const capture = await captureCropPages(session, {
        kind: 'cropPages',
        pages: [1],
        margins: MARGINS,
      });
      expect(capture.captured).toBe(true);
    });
  });
});
