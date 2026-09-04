import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { CommandOfKind } from '@monstera/contract';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import {
  applySetPageBackground,
  captureSetPageBackground,
  invertSetPageBackground,
} from './pageBackground.js';

/**
 * Backgrounds, read back through **MuPDF**.
 *
 * ## The fixture has CONTENT, and that is what makes the file mean anything
 *
 * A background on a blank page is indistinguishable from a foreground on a
 * blank page. Every case here runs against pages carrying drawn text, so
 * *before* and *after* are different observations rather than the same one.
 */
const PAGE_COUNT = 3;
const RED = { red: 1, green: 0, blue: 0 } as const;

/** Three pages of different sizes, each carrying text. */
async function drawnDocument(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < PAGE_COUNT; index += 1) {
    const page = document.addPage([200 + index * 40, 300]);
    page.drawText('CONTENT', { x: 10, y: 100, size: 12, font, color: rgb(0, 0, 0) });
  }
  document.setModificationDate(new Date(Date.UTC(2001, 0, 2, 3, 4, 5)));
  return document.save();
}

const COMMAND: CommandOfKind<'setPageBackground'> = {
  kind: 'setPageBackground',
  pages: 'all',
  ...RED,
};

/**
 * One page's content streams, **in order**, each decoded separately.
 *
 * The order is the whole point of this module, so the reader keeps the streams
 * apart rather than joining them: a joined string can say *the fill is present*
 * and never *the fill is first*.
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

describe('setPageBackground', () => {
  it('puts the fill FIRST, so it sits behind the page’s own content', async () => {
    // THE CASE THE MODULE EXISTS FOR. Every drawing API appends, and PDF paints
    // in stream order — so the obvious implementation covers the document. An
    // assertion that the page "has a fill" passes for both, which is why this
    // reads the ORDER.
    const after = await applySetPageBackground(await drawnDocument(), COMMAND);
    const streams = await streamsOn(after, 0);

    expect(streams.length).toBeGreaterThan(1);
    expect(streams[0]).toContain(' rg');
    expect(streams[0]).toContain(' re');
    // AND THE PAGE'S OWN CONTENT IS STILL THERE, in a later stream. Without
    // this, an implementation that REPLACED `/Contents` with the fill would
    // pass the order assertion perfectly.
    expect(streams.slice(1).join('\n')).toContain('Tj');
  });

  it('brackets the fill in q/Q, so the colour does not leak into the page’s stream', async () => {
    // The one way a prepended stream corrupts the content it sits behind: with
    // no restore, the fill's colour is still current when the page's own stream
    // begins, and a page whose first operator assumes default black draws in
    // the background colour. Invisible on any page that sets its own colour
    // first — which is most of them, and why this is asserted rather than seen.
    const after = await applySetPageBackground(await drawnDocument(), COMMAND);
    const [fill] = await streamsOn(after, 0);

    expect(fill?.trimStart().startsWith('q')).toBe(true);
    expect(fill?.trimEnd().endsWith('Q')).toBe(true);
  });

  it('fills each page’s OWN box, not the first page’s', async () => {
    const after = await applySetPageBackground(await drawnDocument(), COMMAND);

    const widths = await Promise.all(
      [0, 1, 2].map(async (page) => {
        const [fill] = await streamsOn(after, page);
        const match = /0\.000 0\.000 ([\d.]+) [\d.]+ re/u.exec(fill ?? '');
        return Number(match?.[1] ?? 0);
      }),
    );

    // Each page is 40pt wider than the last. An implementation reading the
    // first page's box produces three identical numbers — which a uniform
    // fixture would also produce from a correct one.
    expect(widths).toStrictEqual([200, 240, 280]);
  });

  it('writes the colour the command carried', async () => {
    const after = await applySetPageBackground(await drawnDocument(), {
      ...COMMAND,
      red: 0.25,
      green: 0.5,
      blue: 0.75,
    });
    const [fill] = await streamsOn(after, 0);

    expect(fill).toContain('0.250 0.500 0.750 rg');
  });

  it('writes FIXED notation, never exponential', async () => {
    // `String(0.0000001)` is `1e-7`, which a content stream does not define —
    // the page would be unparseable and the symptom a blank page rather than an
    // error. A component small enough to trigger it is the fixture.
    const after = await applySetPageBackground(await drawnDocument(), {
      ...COMMAND,
      red: 0.0000001,
    });
    const [fill] = await streamsOn(after, 0);

    expect(fill).not.toContain('e-');
    expect(fill).toContain('0.000 0.000 0.000 rg');
  });

  it('fills only the pages a list names', async () => {
    const after = await applySetPageBackground(await drawnDocument(), {
      ...COMMAND,
      pages: [1],
    });

    expect((await streamsOn(after, 0))[0]).not.toContain(' re');
    expect((await streamsOn(after, 1))[0]).toContain(' re');
    expect((await streamsOn(after, 2))[0]).not.toContain(' re');
  });

  it('refuses a page this document does not have, and changes nothing', async () => {
    const original = await drawnDocument();

    await expect(
      applySetPageBackground(original, { ...COMMAND, pages: [0, 9] }),
    ).rejects.toThrow(/Page 9 is outside this document, which has 3 page\(s\)/u);

    expect((await streamsOn(original, 0))[0]).not.toContain(' re');
  });

  it('is reproducible, and preserves the document’s own /ModDate', async () => {
    const original = await drawnDocument();
    const once = await applySetPageBackground(original, COMMAND);
    const twice = await applySetPageBackground(original, COMMAND);
    expect(Buffer.from(twice)).toStrictEqual(Buffer.from(once));

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

  it('CONTROL: the fixture has content and no fill before the command runs', async () => {
    // Both halves. Without the first, the *content survived* assertion above is
    // vacuous; without the second, every `not.toContain(' re')` is.
    const original = await drawnDocument();
    const streams = await streamsOn(original, 0);
    expect(streams.join('\n')).toContain('Tj');
    expect(streams.join('\n')).not.toContain(' re');
  });

  it('capture always refuses, and invert is unreachable', async () => {
    const captured = await captureSetPageBackground(await drawnDocument(), COMMAND);
    expect(captured.captured).toBe(false);
    if (captured.captured) throw new Error('capture reported success, which its type forbids');
    expect(captured.reason).toMatch(/content stream/u);

    expect(() => invertSetPageBackground(new Uint8Array(), undefined as never)).toThrow(
      /no inverse/u,
    );
  });
});
