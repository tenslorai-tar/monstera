import { PDFArray, PDFDocument, PDFName, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { CommandOfKind } from '@monstera/contract';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyDeskewPages, captureDeskewPages, invertDeskewPages } from './pageDeskew.js';
import { measurePageSkew } from './pageSkew.js';

/**
 * Deskew, measured in the raster on the way out.
 *
 * ## THE ROUND TRIP IS THE ONLY CASE THAT SEPARATES THE SIGN
 *
 * The measurement is taken in a bitmap, which is y-down; the transform is
 * written in PDF user space, which is y-up; and the correction is the opposite
 * of the tilt. Two flips cancel, so **the number to apply equals the number
 * measured** — and a fixture whose skew is symmetric, or whose expectation is
 * the measured figure, passes under either convention.
 *
 * What cannot pass under both is *draw a page at a known angle, deskew it, and
 * measure again*: the right sign lands near 0°, the wrong one near twice the
 * original. Every other case in this file is about the wrap, the boxes or the
 * inverse; this is the one about the arithmetic.
 *
 * ## The fixture's angle is this file's arithmetic
 *
 * `drawText` with a `rotate` turns each line about its own origin, which is the
 * artefact the 2026-09-05 deskew attempt measured and agreed with itself about.
 * Each line here is placed on its own computed baseline, so the page's skew is a
 * property of the numbers below rather than of pdf-lib's rotation origin.
 */

const PAGE_WIDTH = 420;
const PAGE_HEIGHT = 560;

/** How crooked the crooked fixture is, in PDF user space. */
const DRAWN_AT = 3;

/**
 * The tolerance every angle here is read to.
 *
 * The sweep's step is 0.1°, and a rotated raster quantises the baselines it is
 * measuring, so an exact equality would be asserting that the rasteriser and the
 * sweep agree to the last tenth. Half a degree is the same bound the research
 * instrument's own controls use, and it is an order of magnitude below the
 * failure this file exists to catch — a flipped sign leaves 6°.
 */
const TOLERANCE = 0.5;

const ALL: CommandOfKind<'deskewPages'> = { kind: 'deskewPages', pages: 'all' };

/** A page of text lines on a baseline computed at `angle`. */
async function page(angle: number, pages = 1): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const radians = (angle * Math.PI) / 180;
  const line = 'The quick brown fox jumps over the lazy dog, again and again.';
  for (let sheet = 0; sheet < pages; sheet += 1) {
    const added = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    for (let index = 0; index < 18; index += 1) {
      const x0 = 40;
      const y0 = PAGE_HEIGHT - 60 - index * 26;
      added.drawText(line, {
        x: x0 + Math.cos(radians) * 0 - Math.sin(radians) * 0,
        y: y0,
        size: 10,
        font,
        rotate: degrees(angle),
      });
    }
  }
  return document.save();
}

/** The skew of one page of `bytes`, read back through a fresh session. */
async function skewIn(bytes: Uint8Array, index: number): Promise<number> {
  const session = await mupdfWriter.open(bytes);
  try {
    return (await measurePageSkew(session, index)).rasterDegrees;
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Applies the command and serialises, as the bus would. */
async function afterApply(
  bytes: Uint8Array,
  command: CommandOfKind<'deskewPages'>,
): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes);
  try {
    await applyDeskewPages(session, command);
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** One page's content streams, in order, each decoded separately. */
async function streamsOn(bytes: Uint8Array, index: number): Promise<readonly string[]> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const contents = document.findPage(index).get('Contents');
      if (contents.isNull()) return [];
      const objects = contents.isArray()
        ? Array.from({ length: contents.length }, (_unused, at) => contents.get(at))
        : [contents];
      return objects
        .filter((object) => object.isStream())
        .map((object) => new TextDecoder().decode(object.readStream().asUint8Array()));
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Whether one page's `/Contents` is an array, and how long. */
async function contentsShape(
  bytes: Uint8Array,
  index: number,
): Promise<{ isArray: boolean; length: number }> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const contents = document.findPage(index).get('Contents');
      return { isArray: contents.isArray(), length: contents.isArray() ? contents.length : 1 };
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/** One page's declared boxes as pdf-lib sees them, or `null`. */
async function boxesOn(
  bytes: Uint8Array,
  index: number,
): Promise<{ media: readonly number[] | null; crop: readonly number[] | null }> {
  const document = await PDFDocument.load(bytes);
  const node = document.getPages()[index]?.node;
  if (node === undefined) throw new Error(`the document has no page ${String(index)}`);
  const read = (key: string): readonly number[] | null => {
    const value = node.get(PDFName.of(key));
    if (value === undefined) return null;
    const box = document.context.lookup(value, PDFArray).asRectangle();
    return [box.x, box.y, box.width, box.height];
  };
  return { media: read('MediaBox'), crop: read('CropBox') };
}

/** The streams this command writes, found by the matrix's five-decimal spelling. */
function transformStreams(streams: readonly string[]): readonly string[] {
  // NOT KEYED ON `cm`, for `pageResize.test.ts`' reason: pdf-lib emits `cm`
  // before it draws anything, so a marker matching it reports a transform on
  // every page including the ones this command was told to leave alone. What
  // separates them is the five-decimal spelling `SCALE_DECIMALS` gives the
  // matrix.
  return streams.filter((body) => /^q\n-?\d\.\d{5} /u.test(body));
}

describe('deskewPages', () => {
  it('LEVELS A PAGE DRAWN AT A KNOWN ANGLE, which is the case a flipped sign fails', async () => {
    const crooked = await page(DRAWN_AT);
    const straightened = await afterApply(crooked, ALL);

    expect(Math.abs(await skewIn(straightened, 0))).toBeLessThanOrEqual(TOLERANCE);
  });

  it('CONTROL: and the same page, unprocessed, really is crooked in the raster', async () => {
    // Without this the case above is satisfied by a fixture that was never
    // skewed, and by a command that does nothing at all. The sign is the
    // instrument's own recorded finding: PDF user space is y-up and the raster
    // is y-down, so content drawn at +3° reads -3° in the bitmap.
    const before = await skewIn(await page(DRAWN_AT), 0);

    expect(before).toBeCloseTo(-DRAWN_AT, 0);
    expect(Math.abs(before + DRAWN_AT)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('CONTROL: and a page drawn level reads level, so the sweep can see zero', async () => {
    expect(Math.abs(await skewIn(await page(0), 0))).toBeLessThanOrEqual(TOLERANCE);
  });

  it('writes NO transform to a page that is already level', async () => {
    // Where the absence of a threshold lives: the sweep's maximum is at 0.0° for
    // a level page, so nothing has to decide at what angle a page counts as
    // crooked. A page the apply did not wrap is also a page whose recorded
    // `/Contents` shape is the shape it still has.
    const level = await page(0);
    const after = await afterApply(level, ALL);

    expect(transformStreams(await streamsOn(after, 0))).toEqual([]);
    expect(await contentsShape(after, 0)).toEqual(await contentsShape(level, 0));
  });

  it('writes exactly ONE transform to a crooked page', async () => {
    const after = await afterApply(await page(DRAWN_AT), ALL);

    expect(transformStreams(await streamsOn(after, 0))).toHaveLength(1);
  });

  it('LEAVES BOTH BOXES ALONE, because a deskew does not change a page’s size', async () => {
    const crooked = await page(DRAWN_AT);
    const after = await afterApply(crooked, ALL);

    expect((await boxesOn(after, 0)).media).toEqual([0, 0, PAGE_WIDTH, PAGE_HEIGHT]);
    expect((await boxesOn(after, 0)).crop).toEqual((await boxesOn(crooked, 0)).crop);
  });

  it('turns the page about the centre of the region it DISPLAYS, not of the sheet', async () => {
    // A page whose crop box hides a margin is turned about what the reader is
    // looking at. A rotation about the wrong centre is a rotation plus a
    // translation, and the translation is what slides the text off the edge —
    // which a fixture whose crop box is its media box cannot show.
    const source = await PDFDocument.load(await page(DRAWN_AT));
    const sheet = source.getPages()[0];
    if (sheet === undefined) throw new Error('the fixture lost a page');
    sheet.node.set(PDFName.of('CropBox'), source.context.obj([0, 0, 200, 200]));
    const after = await afterApply(await source.save(), ALL);

    const stream = transformStreams(await streamsOn(after, 0))[0];
    if (stream === undefined) throw new Error('the crooked page took no transform');
    // Centre (100, 100), turned by -3°: e = 100 - 100·cos(-3°) + 100·sin(-3°)
    // and f = 100 - 100·sin(-3°) - 100·cos(-3°). Both computed here rather than
    // copied out of a run, so a changed centre changes the expectation.
    const radians = (-DRAWN_AT * Math.PI) / 180;
    const e = 100 - 100 * Math.cos(radians) + 100 * Math.sin(radians);
    const f = 100 - 100 * Math.sin(radians) - 100 * Math.cos(radians);
    expect(stream).toContain(`${e.toFixed(3)} ${f.toFixed(3)} cm`);
  });

  it('deskews only the pages a list names', async () => {
    const after = await afterApply(await page(DRAWN_AT, 3), { ...ALL, pages: [2] });

    expect(transformStreams(await streamsOn(after, 0))).toEqual([]);
    expect(transformStreams(await streamsOn(after, 1))).toEqual([]);
    expect(transformStreams(await streamsOn(after, 2))).toHaveLength(1);
  });

  it('RESTORES the /Contents shape, and a bare reference comes back bare', async () => {
    const crooked = await page(DRAWN_AT);
    const before = await contentsShape(crooked, 0);
    const session = await mupdfWriter.open(crooked);
    try {
      const captured = await captureDeskewPages(session, ALL);
      if (!captured.captured) throw new Error('the fixture refused capture');
      await applyDeskewPages(session, ALL);
      const wrapped = await contentsShape(await mupdfWriter.serialise(session), 0);
      await invertDeskewPages(session, captured.prior);
      const restored = await mupdfWriter.serialise(session);

      // The wrap really happened, or the restore below proves nothing.
      expect(wrapped.isArray).toBe(true);
      expect(wrapped.length).toBe(before.length + 2);
      expect(await contentsShape(restored, 0)).toEqual(before);
      expect(transformStreams(await streamsOn(restored, 0))).toEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('and the restored page reads as crooked again, which is what an undo means', async () => {
    // The shape coming back is not the property a person cares about; the page
    // looking the way it did is. A restore that rebuilt the array from the wrong
    // entries would satisfy the shape assertions above exactly.
    const crooked = await page(DRAWN_AT);
    const session = await mupdfWriter.open(crooked);
    try {
      const captured = await captureDeskewPages(session, ALL);
      if (!captured.captured) throw new Error('the fixture refused capture');
      await applyDeskewPages(session, ALL);
      await invertDeskewPages(session, captured.prior);
      const restored = await mupdfWriter.serialise(session);

      expect(await skewIn(restored, 0)).toBeCloseTo(-DRAWN_AT, 0);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('REFUSES THE INVERSE when the /Contents shape is not the one it wrote', async () => {
    const session = await mupdfWriter.open(await page(DRAWN_AT));
    try {
      const captured = await captureDeskewPages(session, ALL);
      if (!captured.captured) throw new Error('the fixture refused capture');
      // NOT APPLIED, so the inverse meets the page's original `/Contents` —
      // exactly the mismatch it must refuse rather than rebuild from.
      await expect(invertDeskewPages(session, captured.prior)).rejects.toThrow(
        /does not carry the \/Contents this command wrote/u,
      );
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('refuses to capture a page whose /Contents is neither a stream nor an array', async () => {
    const source = await PDFDocument.load(await page(0));
    const sheet = source.getPages()[0];
    if (sheet === undefined) throw new Error('the fixture lost a page');
    sheet.node.set(PDFName.of('Contents'), PDFName.of('NotAStream'));

    const session = await mupdfWriter.open(await source.save());
    try {
      const captured = await captureDeskewPages(session, ALL);
      expect(captured.captured).toBe(false);
      if (captured.captured) throw new Error('unreachable');
      expect(captured.reason).toMatch(/neither a stream nor an array/u);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: captures a page whose /Contents is well formed', async () => {
    // Without it, a capture that refused every document would pass the case
    // above.
    const session = await mupdfWriter.open(await page(0));
    try {
      expect((await captureDeskewPages(session, ALL)).captured).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('refuses a page index the document does not have', async () => {
    const session = await mupdfWriter.open(await page(0));
    try {
      await expect(applyDeskewPages(session, { ...ALL, pages: [7] })).rejects.toThrow(
        /outside this document/u,
      );
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('does not re-measure a page it has already turned', async () => {
    // Every page is measured before the first write. A version that measured
    // inside the write loop would still be right for one page and wrong for the
    // second — so the fixture has two, and both must come out level.
    const after = await afterApply(await page(DRAWN_AT, 2), ALL);

    expect(Math.abs(await skewIn(after, 0))).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(await skewIn(after, 1))).toBeLessThanOrEqual(TOLERANCE);
  });
});
