import { PDFArray, PDFDocument, PDFName, degrees, rgb } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { CommandOfKind } from '@monstera/contract';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import {
  applyResizePages,
  captureResizePages,
  invertResizePages,
  type PriorPageResize,
} from './pageResize.js';

/**
 * Resize, read back through a **different parser** than the one that wrote.
 *
 * MuPDF writes here, so every box assertion below is pdf-lib's opinion of the
 * serialised bytes rather than MuPDF's own — which is the point of the pairing:
 * a reader and a writer that share a parse can agree about a document neither
 * of them wrote correctly.
 *
 * ## The file is arranged around one indistinguishable pair
 *
 * *Move the boxes* and *move the boxes and scale the content* produce pages
 * that declare the same size. Every assertion of the form **the page is now
 * A4** passes for both, and only one of them is a resize — the other is a crop
 * with a matte. So the cases that matter read the **content stream**, and a
 * box-only implementation fails them by carrying no transform at all.
 */

/** Source pages, chosen so the two axes fit differently. */
const SOURCE_WIDTH = 200;
const SOURCE_HEIGHT = 300;
const PAGE_COUNT = 3;

/** Halves both axes exactly, so every expected number is short. */
const HALF: CommandOfKind<'resizePages'> = {
  kind: 'resizePages',
  pages: 'all',
  widthPoints: 100,
  heightPoints: 150,
};

/** Three pages, each carrying one drawn rectangle so the content is not empty. */
async function drawnDocument(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < PAGE_COUNT; index += 1) {
    const page = document.addPage([SOURCE_WIDTH, SOURCE_HEIGHT]);
    page.drawRectangle({ x: 10, y: 20, width: 50, height: 60, color: rgb(1, 0, 0) });
  }
  return document.save();
}

/**
 * One page's declared boxes as pdf-lib sees them, as `[x, y, width, height]`.
 *
 * **Absence is preserved as `null`**, because that is the property half these
 * cases turn on: a page that inherited its box must come back inheriting it,
 * and a reader that resolved the inheritance would report the same numbers for
 * both and see nothing.
 */
async function boxesOn(
  bytes: Uint8Array,
  page: number,
): Promise<{ media: readonly number[] | null; crop: readonly number[] | null }> {
  const document = await PDFDocument.load(bytes);
  const node = document.getPages()[page]?.node;
  if (node === undefined) throw new Error(`the document has no page ${String(page)}`);
  const read = (key: string): readonly number[] | null => {
    const value = node.get(PDFName.of(key));
    if (value === undefined) return null;
    const box = document.context.lookup(value, PDFArray).asRectangle();
    return [box.x, box.y, box.width, box.height];
  };
  return { media: read('MediaBox'), crop: read('CropBox') };
}

/**
 * One page's content streams, in order, each decoded separately.
 *
 * Kept apart rather than joined, for `pageBackground.test.ts`' reason: a joined
 * string can say *the transform is present* and never *the transform is first*,
 * and a `cm` that follows the page's own marks scales nothing.
 */
async function streamsOn(bytes: Uint8Array, page: number): Promise<readonly string[]> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const contents = document.findPage(page).get('Contents');
      if (contents.isNull()) return [];
      const objects = contents.isArray()
        ? Array.from({ length: contents.length }, (_unused, index) => contents.get(index))
        : [contents];
      return objects
        .filter((object) => object.isStream())
        .map((object) => new TextDecoder().decode(object.readStream().asUint8Array()));
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Whether one page's `/Contents` is an array, and how long — the prior's shape. */
async function contentsShape(
  bytes: Uint8Array,
  page: number,
): Promise<{ isArray: boolean; length: number }> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const contents = document.findPage(page).get('Contents');
      return {
        isArray: contents.isArray(),
        length: contents.isArray() ? contents.length : 1,
      };
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * The streams among these that THIS COMMAND wrote.
 *
 * Keyed on the five-decimal scale, anchored at the stream's start. A looser
 * test — *does any stream contain `cm`* — separates nothing, because pdf-lib's
 * own `drawRectangle` emits four `cm` operators of its own before it draws
 * anything: the assertion would report a transform on every page in the
 * fixture, including the ones this command was told not to touch. That is the
 * audit's *never build a fixture the bug also handles correctly* arriving in
 * the matcher rather than in the input.
 */
function transformStreams(streams: readonly string[]): readonly string[] {
  return streams.filter((stream) => /^q\n-?\d+\.\d{5} 0\.00000 0\.00000 /.test(stream));
}

/** Applies a command to a session opened on `bytes`, and returns the new bytes. */
async function afterApply(
  bytes: Uint8Array,
  command: CommandOfKind<'resizePages'>,
): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes);
  try {
    await applyResizePages(session, command);
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Captures, applies and inverts in one session, returning the restored bytes. */
async function afterRoundTrip(
  bytes: Uint8Array,
  command: CommandOfKind<'resizePages'>,
): Promise<{ prior: readonly PriorPageResize[]; resized: Uint8Array; restored: Uint8Array }> {
  const session = await mupdfWriter.open(bytes);
  try {
    const captured = await captureResizePages(session, command);
    if (!captured.captured) throw new Error(`the fixture refused capture: ${captured.reason}`);
    await applyResizePages(session, command);
    const resized = await mupdfWriter.serialise(session);
    await invertResizePages(session, captured.prior);
    return { prior: captured.prior, resized, restored: await mupdfWriter.serialise(session) };
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('resizePages', () => {
  it('SCALES THE CONTENT, which is what separates a resize from a crop', async () => {
    // THE CASE THE MODULE EXISTS FOR. An implementation that writes the boxes
    // and nothing else produces a page declaring 100×150 with its marks still
    // at their original size — a crop with a matte, indistinguishable from this
    // one by any assertion about the page's size.
    const after = await afterApply(await drawnDocument(), HALF);
    const streams = await streamsOn(after, 0);

    expect(streams.length).toBeGreaterThan(1);
    // FIRST, and carrying the scale. Both axes halve exactly here, so the
    // expected matrix is a constant this test states rather than recomputes.
    expect(streams[0]).toContain('0.50000 0.00000 0.00000 0.50000 0.000 0.000 cm');
    // AND THE PAGE'S OWN MARKS ARE STILL THERE, after it. Without this the
    // assertion above passes for an implementation that replaced the content.
    // The fixture's red fill, which nothing this command writes can produce.
    expect(streams.slice(1).join('\n')).toContain('1 0 0 rg');
    // Exactly one transform, so a second apply is not what produced it.
    expect(transformStreams(streams)).toHaveLength(1);
    // The bracket closes, so anything appended later is not scaled too.
    expect(streams[streams.length - 1]).toContain('Q');
  });

  it('fits uniformly and centres the remainder, rather than distorting', async () => {
    // 200×300 into 400×400: the height is the binding axis at 4/3, and a
    // per-axis fit would write 2 and 4/3 — which is the mutation this separates.
    const after = await afterApply(await drawnDocument(), {
      ...HALF,
      widthPoints: 400,
      heightPoints: 400,
    });
    const streams = await streamsOn(after, 0);

    expect(streams[0]).toContain('1.33333 0.00000 0.00000 1.33333 66.667 0.000 cm');
  });

  it('writes both boxes onto every page the scope names', async () => {
    const after = await afterApply(await drawnDocument(), HALF);

    for (let page = 0; page < PAGE_COUNT; page += 1) {
      const { media, crop } = await boxesOn(after, page);
      expect(media).toEqual([0, 0, 100, 150]);
      // The crop box follows the media box, because a resize makes the sheet
      // and a sheet it just made has no hidden margin.
      expect(crop).toEqual([0, 0, 100, 150]);
    }
  });

  it('resizes only the pages a list names', async () => {
    const after = await afterApply(await drawnDocument(), { ...HALF, pages: [2] });

    expect((await boxesOn(after, 0)).media).toEqual([0, 0, SOURCE_WIDTH, SOURCE_HEIGHT]);
    expect((await boxesOn(after, 2)).media).toEqual([0, 0, 100, 150]);
    expect(transformStreams(await streamsOn(after, 0))).toEqual([]);
    expect(transformStreams(await streamsOn(after, 2))).toHaveLength(1);
  });

  it('TAKES THE SOURCE BOX ORIGIN OFF THE TRANSLATION, which a zero-origin page cannot show', async () => {
    // A page whose visible box starts at [20 20] has its marks addressed in
    // coordinates that begin at 20. Centring without subtracting the origin
    // leaves the content 10 units up and to the right at this scale — and every
    // page in a fixture built by pdf-lib starts at zero, where the two
    // implementations agree exactly.
    const source = await PDFDocument.load(await drawnDocument());
    const page = source.getPages()[0];
    if (page === undefined) throw new Error('the fixture lost a page');
    page.node.set(
      PDFName.of('CropBox'),
      source.context.obj([20, 20, 20 + SOURCE_WIDTH, 20 + SOURCE_HEIGHT]),
    );
    const after = await afterApply(await source.save(), { ...HALF, pages: [0] });

    expect((await streamsOn(after, 0))[0]).toContain(
      '0.50000 0.00000 0.00000 0.50000 -10.000 -10.000 cm',
    );
  });

  it('reads an UNORDERED box as its extent, rather than mirroring the page', async () => {
    // `[0 300 200 0]` is a legal spelling of the same rectangle. Read
    // positionally it gives a negative height, and a negative scale renders a
    // mirrored page — which renders, and so announces nothing.
    const source = await PDFDocument.load(await drawnDocument());
    const page = source.getPages()[0];
    if (page === undefined) throw new Error('the fixture lost a page');
    page.node.set(PDFName.of('MediaBox'), source.context.obj([0, SOURCE_HEIGHT, SOURCE_WIDTH, 0]));
    page.node.delete(PDFName.of('CropBox'));
    const after = await afterApply(await source.save(), { ...HALF, pages: [0] });

    expect((await streamsOn(after, 0))[0]).toContain('0.50000 0.00000 0.00000 0.50000');
    expect((await streamsOn(after, 0))[0]).not.toContain('-0.50000');
  });

  it('SWAPS THE TARGET FOR A QUARTER-TURNED PAGE, so the DISPLAYED size is the one asked for', async () => {
    // `/Rotate 90` means the viewer shows the page turned. Writing a 100×150
    // box onto it produces a page that displays as 150×100 — landscape, from a
    // portrait request — and the box assertion above passes.
    const source = await PDFDocument.load(await drawnDocument());
    const rotated = source.getPages()[0];
    if (rotated === undefined) throw new Error('the fixture lost a page');
    rotated.setRotation(degrees(90));
    const after = await afterApply(await source.save(), HALF);

    expect((await boxesOn(after, 0)).media).toEqual([0, 0, 150, 100]);
    // THE CONTROL, in the same document and the same run: an unrotated page
    // takes the target unswapped. Without it, an implementation that swapped
    // every page's target would pass the line above.
    expect((await boxesOn(after, 1)).media).toEqual([0, 0, 100, 150]);
  });

  it('restores both boxes and the /Contents shape', async () => {
    const original = await drawnDocument();
    const { resized, restored } = await afterRoundTrip(original, HALF);

    expect((await boxesOn(resized, 0)).media).toEqual([0, 0, 100, 150]);
    expect((await boxesOn(restored, 0)).media).toEqual([0, 0, SOURCE_WIDTH, SOURCE_HEIGHT]);
    expect((await contentsShape(restored, 0)).length).toBe(
      (await contentsShape(original, 0)).length,
    );
    expect(transformStreams(await streamsOn(resized, 0))).toHaveLength(1);
    expect(transformStreams(await streamsOn(restored, 0))).toEqual([]);
    // AND THE PAGE'S OWN MARKS SURVIVED THE ROUND TRIP. An inverse that emptied
    // `/Contents` satisfies every line above.
    expect((await streamsOn(restored, 0)).join('\n')).toContain('1 0 0 rg');
  });

  it('RESTORES A BARE /Contents REFERENCE AS ONE, not as a one-element array', async () => {
    // The two render identically, which is `setPageTransition`'s argument for
    // restoring absence arriving on a different key: an inverse that always
    // writes an array passes every visual check and leaves a document whose
    // shape its producer never wrote.
    const source = await PDFDocument.load(await drawnDocument());
    const page = source.getPages()[0];
    if (page === undefined) throw new Error('the fixture lost a page');
    const contents = page.node.get(PDFName.of('Contents'));
    const single = contents instanceof PDFArray ? contents.get(0) : contents;
    if (single === undefined) throw new Error('the fixture has no content stream to collapse');
    page.node.set(PDFName.of('Contents'), single);
    const bare = await source.save();
    expect((await contentsShape(bare, 0)).isArray).toBe(false);

    const { restored } = await afterRoundTrip(bare, { ...HALF, pages: [0] });

    expect((await contentsShape(restored, 0)).isArray).toBe(false);
  });

  it('RESTORES AN INHERITED BOX AS INHERITED, rather than as one the page declares', async () => {
    // A page that took its `/MediaBox` from the tree must come back taking it
    // from the tree. Writing the same numbers onto the leaf renders identically
    // and leaves the page declaring what it used to inherit — `cropPages`' §3
    // rule, and the case a fixture of self-declaring pages cannot see.
    const source = await PDFDocument.load(await drawnDocument());
    for (const page of source.getPages()) page.node.delete(PDFName.of('MediaBox'));
    source.catalog
      .Pages()
      .set(PDFName.of('MediaBox'), source.context.obj([0, 0, SOURCE_WIDTH, SOURCE_HEIGHT]));
    const inherited = await source.save();
    expect((await boxesOn(inherited, 0)).media).toBeNull();

    const { resized, restored } = await afterRoundTrip(inherited, HALF);

    // The resized page DECLARES its box — it cannot go on inheriting a size it
    // no longer has.
    expect((await boxesOn(resized, 0)).media).toEqual([0, 0, 100, 150]);
    expect((await boxesOn(restored, 0)).media).toBeNull();
    expect((await boxesOn(restored, 0)).crop).toBeNull();
  });

  it('resizes an EMPTY page by its boxes alone, adding no transform to bracket nothing', async () => {
    const source = await PDFDocument.create();
    source.addPage([SOURCE_WIDTH, SOURCE_HEIGHT]);
    const empty = await source.save();

    const { resized, restored } = await afterRoundTrip(empty, HALF);

    expect((await boxesOn(resized, 0)).media).toEqual([0, 0, 100, 150]);
    expect(await streamsOn(resized, 0)).toEqual([]);
    expect((await boxesOn(restored, 0)).media).toEqual([0, 0, SOURCE_WIDTH, SOURCE_HEIGHT]);
  });

  it('REFUSES CAPTURE on a malformed box, rather than throwing', async () => {
    // ADR-0009's 2026-08-19 decision: *this document cannot have its prior
    // state recorded* is an outcome the bus answers with a checkpoint, where
    // *this command is illegal* is a caller error.
    const source = await PDFDocument.load(await drawnDocument());
    const page = source.getPages()[0];
    if (page === undefined) throw new Error('the fixture lost a page');
    page.node.set(PDFName.of('CropBox'), PDFName.of('NotABox'));

    const session = await mupdfWriter.open(await source.save());
    try {
      const captured = await captureResizePages(session, HALF);
      expect(captured.captured).toBe(false);
      if (captured.captured) throw new Error('the malformed /CropBox was captured as a box');
      expect(captured.reason).toContain('page 0');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('captures a page whose boxes are WELL FORMED, so the refusal above is not a constant', async () => {
    // The control for the case above: without it, a capture that refused every
    // document would pass it.
    const session = await mupdfWriter.open(await drawnDocument());
    try {
      const captured = await captureResizePages(session, HALF);
      expect(captured.captured).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('REFUSES THE INVERSE when the /Contents shape is not the one it wrote', async () => {
    // A refused undo is `applyCropPages`' stated preference over a half-restore:
    // rebuilding from an array of the wrong length gives the page some other
    // command's streams, and the result renders.
    const original = await drawnDocument();
    const session = await mupdfWriter.open(original);
    try {
      const captured = await captureResizePages(session, HALF);
      if (!captured.captured) throw new Error('the fixture refused capture');
      // NOT APPLIED. The inverse therefore meets the page's original
      // `/Contents`, which is exactly the mismatch it must refuse.
      await expect(invertResizePages(session, captured.prior)).rejects.toThrow(
        /does not carry the \/Contents this command wrote/,
      );
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('refuses a page index the document does not have', async () => {
    const session = await mupdfWriter.open(await drawnDocument());
    try {
      await expect(applyResizePages(session, { ...HALF, pages: [PAGE_COUNT] })).rejects.toThrow(
        /outside this document/,
      );
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('refuses a page whose box has no area', async () => {
    const source = await PDFDocument.load(await drawnDocument());
    const page = source.getPages()[0];
    if (page === undefined) throw new Error('the fixture lost a page');
    page.node.set(PDFName.of('MediaBox'), source.context.obj([0, 0, 0, SOURCE_HEIGHT]));
    page.node.delete(PDFName.of('CropBox'));

    const session = await mupdfWriter.open(await source.save());
    try {
      await expect(applyResizePages(session, { ...HALF, pages: [0] })).rejects.toThrow(/no area/);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
