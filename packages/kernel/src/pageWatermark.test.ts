import { PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { CommandOfKind } from '@monstera/contract';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import {
  applyWatermarkPages,
  captureWatermarkPages,
  invertWatermarkPages,
} from './pageWatermark.js';

/**
 * The watermark, read back through **MuPDF** — a different library from the one
 * that wrote it.
 *
 * ## Why the read-back library matters here more than usual
 *
 * This is the first command whose writer both parses and re-serialises the
 * whole document (ADR-0039). Asking pdf-lib whether pdf-lib kept something is
 * one library agreeing with itself, and the failure ADR-0006 measured for
 * MuPDF's own rewrite — `/AcroForm` dropped while the widgets stayed on their
 * pages — is invisible to exactly that kind of check.
 *
 * ## Pages of DIFFERENT sizes, and text at a NON-ZERO angle
 *
 * Both are choices a uniform fixture would hide, and each hides a different
 * defect:
 *
 * - equal page sizes make *centre on each page's own box* and *centre on the
 *   first page's box* the same observation;
 * - a rotation of 0° makes *offset by the rotated half-extent* and *offset by
 *   the half-extent* the same arithmetic, because `cos 0 = 1` and `sin 0 = 0`.
 *   A fixture at 0° cannot separate an implementation that reads
 *   `rotationDegrees` from one that ignores it.
 */
const FIRST_WIDTH = 200;
const PAGE_COUNT = 3;

/** Three pages of different sizes, carrying all four catalog entries. */
async function richDocument(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < PAGE_COUNT; index += 1) {
    document.addPage([FIRST_WIDTH + index * 60, 500 + index * 40]);
  }

  const pages = document.getPages();
  const second = pages[1];
  if (second === undefined) throw new Error('the fixture lost a page');
  const field = document.getForm().createTextField('applicant.name');
  field.addToPage(second, { x: 10, y: 10, width: 60, height: 16, font });

  const context = document.context;
  const child = context.obj({ Title: PDFString.of('Chapter one') });
  const outlines = context.obj({
    Type: PDFName.of('Outlines'),
    First: context.register(child),
  });
  document.catalog.set(PDFName.of('Outlines'), context.register(outlines));
  document.catalog.set(PDFName.of('Names'), context.register(context.obj({})));
  document.catalog.set(PDFName.of('OCProperties'), context.register(context.obj({})));

  // PINNED, so a reproducibility reading cannot come out right by accident.
  // `PDFDocument.create` stamps today's date, and two runs inside one clock
  // tick then produce the same `/ModDate` whether or not the command preserves
  // it — a fixture the defect also handles correctly.
  document.setModificationDate(new Date(Date.UTC(2001, 0, 2, 3, 4, 5)));
  return document.save();
}

const DRAFT: CommandOfKind<'watermarkPages'> = {
  kind: 'watermarkPages',
  pages: 'all',
  text: 'DRAFT',
  opacity: 0.3,
  rotationDegrees: 45,
  fontSize: 36,
};

/**
 * One page's content-stream text, read with MuPDF.
 *
 * A page that has never been drawn on carries **no `/Contents` at all** — read
 * from the fixture, not assumed — so absence answers with the empty string
 * rather than throwing. `isStream()` is checked per entry for the same reason
 * `pageDuplicates.ts` checks it: `/Contents` is one stream or an array of them,
 * and pdf-lib appends rather than replacing, so the drawn text lands in a
 * stream that is not the first.
 */
async function contentOf(bytes: Uint8Array, page: number): Promise<string> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      // `isNull()` ALONE. MuPDF's `get` answers with a null object rather than
      // `undefined` for a key a dictionary does not have, so an `=== undefined`
      // beside this is a branch the type says cannot run — and lint says so.
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
 * The strings a content stream actually **shows**, decoded.
 *
 * ## Why not a substring search for `DRAFT`
 *
 * Measured against the real output: pdf-lib emits the text as a **hex string**,
 * `<4452414654> Tj`, so `content.includes('DRAFT')` is false for a page that
 * carries the watermark and would have been false for every implementation.
 * A test asserting the absence of a string a correct implementation never
 * writes is the reassuring answer in its most convincing form — it fails now
 * and would have passed as a `not.toContain`.
 *
 * Decoding is also the stronger assertion. A substring search cannot tell a
 * drawn `DRAFT` from the letters appearing in a font name or a resource key;
 * this reads what the page shows.
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

/** The strings one page of a document shows. */
async function shownOn(bytes: Uint8Array, page: number): Promise<readonly string[]> {
  return shownStringsOf(await contentOf(bytes, page));
}

/** Which of ADR-0006's four catalog entries a document carries, read with MuPDF. */
async function catalogEntriesOf(bytes: Uint8Array): Promise<readonly string[]> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const root = document.getTrailer().get('Root');
      return ['AcroForm', 'Outlines', 'Names', 'OCProperties'].filter((name) => {
        return !root.get(name).isNull();
      });
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/** How many widget annotations sit on the document's pages, read with MuPDF. */
async function widgetCountOf(bytes: Uint8Array): Promise<number> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      let total = 0;
      for (let index = 0; index < document.countPages(); index += 1) {
        const annotations = document.findPage(index).get('Annots');
        if (annotations.isNull()) continue;
        total += annotations.length;
      }
      return total;
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/** The `Tm` text-matrix operands of the first text object in a content stream. */
function textMatrixOf(content: string): readonly number[] {
  const match = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm/u.exec(
    content,
  );
  if (match === null) throw new Error(`no text matrix in:\n${content}`);
  return match.slice(1).map(Number);
}

describe('watermarkPages', () => {
  it('draws the text onto every page when the scope is "all"', async () => {
    const stamped = await applyWatermarkPages(await richDocument(), DRAFT);

    for (let page = 0; page < PAGE_COUNT; page += 1) {
      expect(await shownOn(stamped, page)).toStrictEqual(['DRAFT']);
    }
  });

  it('draws it onto only the pages a list names, and leaves the others alone', async () => {
    const original = await richDocument();
    const stamped = await applyWatermarkPages(original, { ...DRAFT, pages: [0, 2] });

    expect(await shownOn(stamped, 0)).toStrictEqual(['DRAFT']);
    expect(await shownOn(stamped, 2)).toStrictEqual(['DRAFT']);
    // THE NEGATIVE HALF, and it is what makes the scope mean anything: without
    // it, an implementation that ignored `pages` and stamped everything would
    // pass the two assertions above.
    expect(await shownOn(stamped, 1)).toStrictEqual([]);
  });

  it('centres the text on each page’s OWN box, not on the first page’s', async () => {
    const stamped = await applyWatermarkPages(await richDocument(), {
      ...DRAFT,
      // ZERO DEGREES HERE ONLY, so this case measures the centring alone. The
      // rotation case below is what covers the other half; a single case at 45°
      // would confound the two and could not say which was wrong.
      rotationDegrees: 0,
    });

    const centres = await Promise.all(
      [0, 1, 2].map(async (page) => textMatrixOf(await contentOf(stamped, page))[4] ?? 0),
    );

    // Each page is 60pt wider than the last, so a correct centre moves by 30pt
    // per page. An implementation centring every page on the first page's box
    // produces three identical numbers — which is exactly what a uniform
    // fixture would also produce from a CORRECT implementation.
    const [first, second, third] = centres;
    expect(second).toBeCloseTo((first ?? 0) + 30, 1);
    expect(third).toBeCloseTo((first ?? 0) + 60, 1);
  });

  it('offsets the origin by the ROTATED half-extent, so the text stays centred', async () => {
    const upright = await applyWatermarkPages(await richDocument(), {
      ...DRAFT,
      rotationDegrees: 0,
    });
    const turned = await applyWatermarkPages(await richDocument(), {
      ...DRAFT,
      rotationDegrees: 45,
    });

    const uprightX = textMatrixOf(await contentOf(upright, 0))[4] ?? 0;
    const turnedX = textMatrixOf(await contentOf(turned, 0))[4] ?? 0;

    // THE MUTATION THIS CATCHES: dropping the `cos`/`sin` terms and offsetting
    // by the plain half-extent. That leaves the origin identical at every
    // angle, so the two numbers here would be equal — and every other case in
    // this file would stay green, because the text is still on the page and
    // still says DRAFT.
    expect(turnedX).not.toBeCloseTo(uprightX, 1);

    // And the rotation really is in the matrix, so the case is not passing
    // because the offset changed for some unrelated reason.
    const [a, b] = textMatrixOf(await contentOf(turned, 0));
    expect(a).toBeCloseTo(Math.cos(Math.PI / 4), 3);
    expect(b).toBeCloseTo(Math.sin(Math.PI / 4), 3);
  });

  it('keeps all four catalog entries and the form widget across the rewrite', async () => {
    const original = await richDocument();
    expect(await catalogEntriesOf(original)).toHaveLength(4);
    expect(await widgetCountOf(original)).toBe(1);

    const stamped = await applyWatermarkPages(original, DRAFT);

    // ADR-0006's measured failure for MuPDF's own rewrite was `/AcroForm`
    // dropped while the widgets stayed on their pages, so both halves are read:
    // the catalog side alone would miss an orphaned field tree, and the page
    // side alone would miss a catalog that lost it.
    expect(await catalogEntriesOf(stamped)).toStrictEqual([
      'AcroForm',
      'Outlines',
      'Names',
      'OCProperties',
    ]);
    expect(await widgetCountOf(stamped)).toBe(1);
  });

  it('is reproducible: the same command against the same bytes writes the same bytes', async () => {
    const original = await richDocument();

    const once = await applyWatermarkPages(original, DRAFT);
    const twice = await applyWatermarkPages(original, DRAFT);

    // `commandDeclarations.ts` declares this `reproducible: true`, which is what
    // lets `redo` re-run the command rather than replay a stored effect.
    //
    // THIS CASE DOES NOT CATCH THE METADATA STAMP, measured 2026-09-04 rather
    // than reasoned: flipping `updateMetadata` to `true` in `pageWatermark.ts`
    // leaves it GREEN, because both runs land inside one clock tick and are
    // stamped with the same date. It is kept because it covers the rest of
    // reproducibility — an implementation that minted an object identifier or
    // read a counter would redden it — and it is labelled because a case that
    // reads as covering the stamp and does not is worse than no case at all.
    //
    // The `/ModDate` case below is what actually holds that property, and it
    // was verified by the same mutation.
    expect(Buffer.from(twice)).toStrictEqual(Buffer.from(once));
  });

  it('preserves the document’s own /ModDate rather than stamping the clock', async () => {
    const stamped = await applyWatermarkPages(await richDocument(), DRAFT);
    const session = await mupdfWriter.open(stamped);
    try {
      const date = await withDocument(session, (document) =>
        document.getTrailer().get('Info').get('ModDate').asString(),
      );
      // THE CASE THAT ACTUALLY HOLDS THE PROPERTY, and the one above does not:
      // byte equality also holds when two runs land in the same clock tick,
      // which is how the research script's first version reported IDENTICAL for
      // both settings and how the case above stays green under the mutation.
      // Reading the value is independent of the clock, because the fixture's
      // date is pinned to 2001 and no stamp can produce it.
      expect(date).toBe('D:20010102030405Z');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('refuses a page this document does not have, and changes nothing', async () => {
    const original = await richDocument();

    await expect(applyWatermarkPages(original, { ...DRAFT, pages: [0, 9] })).rejects.toThrow(
      /Page 9 is outside this document, which has 3 page\(s\)/u,
    );

    // EVERY PAGE IS VALIDATED BEFORE THE FIRST IS DRAWN, so a refusal is not a
    // partial application. Page 0 was named first and would have been stamped
    // by an implementation that validated as it went.
    //
    // The bytes handed in are also unchanged BY CONSTRUCTION here — `apply`
    // parses a private copy — so this reads the input rather than an output
    // that does not exist. Stated because the assertion looks like it is
    // checking a rollback and is not: there is nothing to roll back.
    expect(await shownOn(original, 0)).toStrictEqual([]);
  });

  it('CONTROL: the fixture carries no watermark before the command runs', async () => {
    // Without this, every positive assertion above would pass for a fixture
    // that already said DRAFT, and every negative one would pass vacuously.
    const original = await richDocument();
    for (let page = 0; page < PAGE_COUNT; page += 1) {
      expect(await shownOn(original, page)).toStrictEqual([]);
    }
  });

  it('CONTROL: the decoder reads a string the fixture really shows', async () => {
    // `shownStringsOf` is a SEARCH, and every way of breaking it — a wrong
    // pattern, a hex form it does not recognise, a stream it never reached —
    // reports the same empty array that a page with no watermark reports. Every
    // negative assertion in this file rests on that difference, so the decoder
    // has to be shown finding something known to be there.
    const stamped = await applyWatermarkPages(await richDocument(), {
      ...DRAFT,
      text: 'CONTROL TEXT',
    });
    expect(await shownOn(stamped, 0)).toStrictEqual(['CONTROL TEXT']);
  });

  it('capture always refuses, and names why', async () => {
    const captured = await captureWatermarkPages(await richDocument(), DRAFT);

    // `CommandPrior['watermarkPages']` is `never`, so `{ captured: true }` is
    // not constructible — this cannot report success even if it were written
    // to. The assertion is on the REASON travelling, because that is what
    // reaches the log entry and tells a UI why undo costs a checkpoint.
    expect(captured.captured).toBe(false);
    // NARROWED BY A GUARD RATHER THAN BY A COMPARISON in the assertion itself:
    // `captured.captured === false && captured.reason` reads the reason and
    // compares a boolean to a boolean, which lint refuses. The guard says the
    // same thing and fails the case if the discriminant is ever the other way.
    if (captured.captured) throw new Error('capture reported success, which its type forbids');
    expect(captured.reason).toMatch(/content stream/u);
  });

  it('invert is unreachable and says so rather than corrupting a document', () => {
    // No caller can build the second argument: its type is `never`. The cast is
    // what a test needs to reach a branch the type forbids, and reaching it is
    // the point — a body that silently returned the image would make an
    // impossible undo look like a successful one.
    expect(() =>
      invertWatermarkPages(new Uint8Array(), undefined as never),
    ).toThrow(/no inverse/u);
  });
});
