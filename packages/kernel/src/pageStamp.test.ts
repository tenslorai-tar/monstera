import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { CommandOfKind } from '@monstera/contract';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import {
  applyHeaderFooterPages,
  captureHeaderFooterPages,
  invertHeaderFooterPages,
  resolveStampTokens,
} from './pageStamp.js';

/**
 * Headers and footers, read back through **MuPDF** — a different library from
 * the one that wrote them, for `pageWatermark.test.ts`'s reason.
 *
 * ## THREE PAGES OF DIFFERENT SIZES, and both properties depend on it
 *
 * A single-page fixture makes *resolve `{n}` per page* and *resolve it once*
 * the same observation, which is the defect this file exists to catch. Unequal
 * widths make *align to each page's own box* and *align to the first page's*
 * the same observation too — the same trap `pageCrop.test.ts` names, arriving
 * on a different axis.
 */
const FIRST_WIDTH = 300;
const PAGE_COUNT = 3;

const NO_SLOTS = { left: '', centre: '', right: '' } as const;

/** Three pages of different sizes, carrying nothing drawn. */
async function sizedDocument(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < PAGE_COUNT; index += 1) {
    document.addPage([FIRST_WIDTH + index * 80, 500 + index * 40]);
  }
  document.setModificationDate(new Date(Date.UTC(2001, 0, 2, 3, 4, 5)));
  return document.save();
}

const STAMP: CommandOfKind<'headerFooterPages'> = {
  kind: 'headerFooterPages',
  pages: 'all',
  header: { left: 'Monstera', centre: '', right: '' },
  footer: { left: '', centre: 'Page {n} of {N}', right: '' },
  fontSize: 10,
  marginPoints: 36,
};

/** One page's content-stream text, read with MuPDF. */
async function contentOf(bytes: Uint8Array, page: number): Promise<string> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const contents = document.findPage(page).get('Contents');
      if (contents.isNull()) return '';
      const streams = contents.isArray()
        ? Array.from({ length: contents.length }, (_unused, index) => contents.get(index))
        : [contents];
      return streams
        .filter((stream) => stream.isStream())
        .map((stream) => new TextDecoder().decode(stream.readStream().asUint8Array()))
        .join('\n');
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * The strings a content stream actually shows, decoded.
 *
 * pdf-lib emits text as a hex string, so a substring search for `Page 1 of 3`
 * is false for a page that carries it — measured while writing
 * `pageWatermark.test.ts`, and the reason that file decodes too.
 */
function shownStringsOf(content: string): readonly string[] {
  const shown: string[] = [];
  for (const [, hex] of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/gu)) {
    const pairs = (hex ?? '').match(/../gu) ?? [];
    shown.push(pairs.map((pair) => String.fromCharCode(Number.parseInt(pair, 16))).join(''));
  }
  for (const [, literal] of content.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/gu)) {
    shown.push(literal ?? '');
  }
  return shown;
}

/** The strings one page shows. */
async function shownOn(bytes: Uint8Array, page: number): Promise<readonly string[]> {
  return shownStringsOf(await contentOf(bytes, page));
}

/** Every `Tm` origin in a page's content stream, as `[x, y]` pairs. */
function originsOf(content: string): readonly (readonly [number, number])[] {
  const origins: (readonly [number, number])[] = [];
  for (const match of content.matchAll(
    /(?:-?[\d.]+) (?:-?[\d.]+) (?:-?[\d.]+) (?:-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm/gu,
  )) {
    origins.push([Number(match[1]), Number(match[2])]);
  }
  return origins;
}

describe('resolveStampTokens', () => {
  it('substitutes {n} and {N}', () => {
    expect(resolveStampTokens('Page {n} of {N}', 2, 7)).toBe('Page 2 of 7');
  });

  it('leaves an unrecognised token VERBATIM rather than deleting it', () => {
    // Silently removing text a person typed is the worse failure, so this is
    // the behaviour rather than a gap. `{total}` is what somebody reaches for
    // before reading the two tokens that exist.
    expect(resolveStampTokens('Page {n} of {total}', 1, 4)).toBe('Page 1 of {total}');
  });

  it('does not re-substitute text a substitution produced', () => {
    // ONE PASS, and this is the case that says why. With two `replaceAll` calls
    // a page number that produced the literal text `{N}` would be rewritten by
    // the second pass. It cannot happen with digits — which is exactly why the
    // fixture has to make the produced text a token on purpose.
    expect(resolveStampTokens('{n}', 1, 9)).toBe('1');
    expect(resolveStampTokens('{N}{n}', 5, 9)).toBe('95');
  });
});

describe('headerFooterPages', () => {
  it('resolves {n} PER PAGE, so every page carries its own number', async () => {
    const stamped = await applyHeaderFooterPages(await sizedDocument(), STAMP);

    // THE MUTATION THIS CATCHES: hoisting the resolution out of the page loop,
    // which stamps page 1's number onto all three. Every other assertion in
    // this file stays green under it.
    expect(await shownOn(stamped, 0)).toStrictEqual(['Monstera', 'Page 1 of 3']);
    expect(await shownOn(stamped, 1)).toStrictEqual(['Monstera', 'Page 2 of 3']);
    expect(await shownOn(stamped, 2)).toStrictEqual(['Monstera', 'Page 3 of 3']);
  });

  it('centres a slot on each page’s OWN width, not on the first page’s', async () => {
    const stamped = await applyHeaderFooterPages(await sizedDocument(), STAMP);

    const centres = await Promise.all(
      [0, 1, 2].map(async (page) => {
        const origins = originsOf(await contentOf(stamped, page));
        // The footer is the centred slot and the header is left-aligned, so the
        // centred one is whichever origin is not the margin.
        const centred = origins.find(([x]) => x !== STAMP.marginPoints);
        return centred?.[0] ?? 0;
      }),
    );

    // Each page is 80pt wider than the last, so a correct centre moves by 40pt
    // per page. An implementation centring on the first page's box produces
    // three identical numbers — which a uniform fixture would also produce from
    // a correct one.
    const [first, second, third] = centres;
    expect(second).toBeCloseTo((first ?? 0) + 40, 1);
    expect(third).toBeCloseTo((first ?? 0) + 80, 1);
  });

  it('puts the header near the TOP and the footer near the BOTTOM', async () => {
    const stamped = await applyHeaderFooterPages(await sizedDocument(), STAMP);
    const origins = originsOf(await contentOf(stamped, 0));

    // 500pt tall, 36pt margin: the header's baseline is at 464 and the
    // footer's at 36. Asserting BOTH is what separates a correct placement from
    // one that put them both at the same edge — which would still show the
    // right strings and pass every case above.
    const ys = origins.map(([, y]) => y).sort((a, b) => a - b);
    expect(ys).toHaveLength(2);
    expect(ys[0]).toBeCloseTo(36, 1);
    expect(ys[1]).toBeCloseTo(500 - 36, 1);
  });

  it('right-aligns by subtracting the MEASURED text width', async () => {
    // ONE STRING AND ITS DOUBLE, so the assertion needs no font metric at all.
    // A first attempt hard-coded the advance of `i` at 10pt from memory and was
    // wrong by 0.56pt — a magic number nobody can check, which is the shape B6
    // is about even when it happens to be right.
    //
    // Helvetica's raw advances sum without kerning, so `WW` is exactly twice
    // the width of `W`. Right-aligning both to the same edge R gives
    // `single = R − w` and `double = R − 2w`, so `2·single − double = R`
    // whatever `w` turns out to be — the font is eliminated rather than
    // guessed.
    const stamped = await applyHeaderFooterPages(await sizedDocument(), {
      ...STAMP,
      header: { left: '', centre: '', right: 'W' },
      footer: { left: '', centre: '', right: 'WW' },
    });
    const origins = originsOf(await contentOf(stamped, 0));
    const [single, double] = origins
      .slice()
      .sort((a, b) => b[1] - a[1])
      .map(([x]) => x);

    // The wider string starts further left. An implementation right-aligning to
    // a constant — the margin, or the page width — gives them the same origin.
    expect(double).toBeLessThan(single ?? 0);
    expect(2 * (single ?? 0) - (double ?? 0)).toBeCloseTo(FIRST_WIDTH - STAMP.marginPoints, 1);
  });

  it('draws NOTHING for an empty slot', async () => {
    const stamped = await applyHeaderFooterPages(await sizedDocument(), {
      ...STAMP,
      header: NO_SLOTS,
      footer: { left: '', centre: 'only this', right: '' },
    });

    // An empty string still produces a text object in pdf-lib, which is an
    // invisible operator for a slot the person left blank — enough to make
    // *this document has no header* false. Counting the origins is what sees
    // it; reading the shown strings would not, because an empty string shows
    // nothing.
    expect(originsOf(await contentOf(stamped, 0))).toHaveLength(1);
  });

  it('stamps only the pages a list names', async () => {
    const stamped = await applyHeaderFooterPages(await sizedDocument(), {
      ...STAMP,
      pages: [2],
    });

    expect(await shownOn(stamped, 0)).toStrictEqual([]);
    expect(await shownOn(stamped, 1)).toStrictEqual([]);
    // AND `{N}` IS THE DOCUMENT'S PAGE COUNT, not the number of pages stamped.
    // An implementation resolving `{N}` from the target list would print
    // "Page 3 of 1" here, which is the shape a whole-document fixture cannot
    // separate.
    expect(await shownOn(stamped, 2)).toStrictEqual(['Monstera', 'Page 3 of 3']);
  });

  it('refuses a page this document does not have, and changes nothing', async () => {
    const original = await sizedDocument();

    await expect(
      applyHeaderFooterPages(original, { ...STAMP, pages: [0, 9] }),
    ).rejects.toThrow(/Page 9 is outside this document, which has 3 page\(s\)/u);

    expect(await shownOn(original, 0)).toStrictEqual([]);
  });

  it('is reproducible, and preserves the document’s own /ModDate', async () => {
    const original = await sizedDocument();
    const once = await applyHeaderFooterPages(original, STAMP);
    const twice = await applyHeaderFooterPages(original, STAMP);

    expect(Buffer.from(twice)).toStrictEqual(Buffer.from(once));

    // THE CASE THAT HOLDS THE PROPERTY. Byte equality also holds when two runs
    // land inside one clock tick, measured on `pageWatermark.test.ts`; reading
    // the value cannot, because the fixture's date is pinned to 2001 and no
    // stamp can produce it.
    const session = await mupdfWriter.open(once);
    try {
      const date = await withDocument(session, (document) =>
        document.getTrailer().get('Info').get('ModDate').asString(),
      );
      expect(date).toBe('D:20010102030405Z');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: the fixture shows nothing before the command runs', async () => {
    // Without this every negative assertion above passes vacuously, and the
    // decoder's silence would be indistinguishable from a decoder that cannot
    // see.
    const original = await sizedDocument();
    for (let page = 0; page < PAGE_COUNT; page += 1) {
      expect(await shownOn(original, page)).toStrictEqual([]);
    }
  });

  it('CONTROL: the decoder reads a string the fixture really shows', async () => {
    const stamped = await applyHeaderFooterPages(await sizedDocument(), {
      ...STAMP,
      header: { left: 'CONTROL TEXT', centre: '', right: '' },
      footer: NO_SLOTS,
    });
    expect(await shownOn(stamped, 0)).toStrictEqual(['CONTROL TEXT']);
  });

  it('capture always refuses, and names why', async () => {
    const captured = await captureHeaderFooterPages(await sizedDocument(), STAMP);
    expect(captured.captured).toBe(false);
    if (captured.captured) throw new Error('capture reported success, which its type forbids');
    expect(captured.reason).toMatch(/content stream/u);
  });

  it('invert is unreachable and says so rather than corrupting a document', () => {
    expect(() => invertHeaderFooterPages(new Uint8Array(), undefined as never)).toThrow(
      /no inverse/u,
    );
  });
});
