import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFString, degrees } from '@cantoo/pdf-lib';
import type { AnnotationDataFormat } from '@monstera/contract';
import { ColorSpace, Matrix, type PDFPage } from 'mupdf';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  AnnotationPageMissingError,
  type InterchangeAnnotation,
  NoImportableAnnotationsError,
  UnreadableAnnotationDataError,
  applyImportAnnotations,
  parseAnnotationData,
  readInterchangeAnnotations,
  readInterchangeRecordsAt,
  serialiseAnnotationData,
} from './annotationInterchange.js';
import type { MupdfSession } from './engineSeam.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { XfdfDoctypeError } from './xfdfReader.js';

/**
 * Annotations exported and imported through all three formats (ADR-0077).
 *
 * The source document's annotations are written by pdf-lib as raw dictionaries — a writer that is
 * not the one under test — so the reader is checked against entries it did not produce, and the
 * import is checked by reading the target back with that same reader.
 */

/** What the fixture's annotations are, as records. The reader must answer exactly these. */
const EXPECTED: readonly InterchangeAnnotation[] = [
  {
    page: 0,
    subtype: 'Square',
    rect: [100, 100, 300, 200],
    colour: [1, 0, 0],
    interiorColour: [0, 0, 1],
    opacity: 0.5,
    borderWidth: 2,
    contents: 'Check the total (net)',
    author: 'Ada Lovelace',
    subject: 'Review',
    modified: 'D:20260917120000Z',
  },
  {
    page: 0,
    subtype: 'Highlight',
    rect: [72, 700, 272, 720],
    colour: [1, 1, 0],
    quadPoints: [72, 720, 272, 720, 72, 700, 272, 700],
    contents: 'Größe — 大きさ',
  },
  {
    page: 0,
    subtype: 'Ink',
    rect: [300, 300, 500, 400],
    colour: [0, 0, 1],
    borderWidth: 3,
    inkList: [
      [300, 300, 400, 400, 500, 300],
      [310, 310, 490, 310],
    ],
  },
  {
    page: 1,
    subtype: 'Line',
    rect: [50, 50, 250, 150],
    colour: [0, 0.2, 0],
    line: [50, 50, 250, 150],
    lineEndings: ['None', 'OpenArrow'],
  },
  { page: 1, subtype: 'Text', rect: [400, 600, 420, 620], contents: 'A note', icon: 'Comment' },
  {
    page: 1,
    subtype: 'FreeText',
    rect: [100, 400, 300, 450],
    contents: 'Typed words',
    defaultAppearance: '/Helv 12 Tf 0 0 0 rg',
  },
  {
    page: 1,
    subtype: 'Polygon',
    rect: [200, 200, 400, 400],
    colour: [1, 0, 1],
    vertices: [200, 200, 400, 200, 300, 400],
  },
];

let source: Uint8Array;
let blank: Uint8Array;

beforeAll(async () => {
  const document = await PDFDocument.create();
  const upright = document.addPage([612, 792]);
  const rotated = document.addPage([612, 792]);
  rotated.setRotation(degrees(90));
  const { context } = document;
  const add = (page: typeof upright, entries: Record<string, unknown>): void => {
    const ref = context.register(context.obj({ Type: 'Annot', ...entries } as never));
    const existing = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (existing === undefined) page.node.set(PDFName.of('Annots'), context.obj([ref]));
    else existing.push(ref);
  };
  add(upright, {
    Subtype: 'Square',
    Rect: [100, 100, 300, 200],
    C: [1, 0, 0],
    IC: [0, 0, 1],
    CA: 0.5,
    BS: { W: 2 },
    Contents: PDFString.of('Check the total \\(net\\)'),
    T: PDFHexString.fromText('Ada Lovelace'),
    Subj: PDFString.of('Review'),
    M: PDFString.of('D:20260917120000Z'),
    // AN ACTION, which is not an entry of the record and must not travel.
    A: { S: 'JavaScript', JS: PDFString.of('app.alert(1)') },
  });
  add(upright, {
    Subtype: 'Highlight',
    Rect: [72, 700, 272, 720],
    C: [1, 1, 0],
    QuadPoints: [72, 720, 272, 720, 72, 700, 272, 700],
    Contents: PDFHexString.fromText('Größe — 大きさ'),
  });
  add(upright, {
    Subtype: 'Ink',
    Rect: [300, 300, 500, 400],
    C: [0, 0, 1],
    BS: { W: 3 },
    InkList: [
      [300, 300, 400, 400, 500, 300],
      [310, 310, 490, 310],
    ],
  });
  // NOT EXCHANGED: a link is navigation, not a comment.
  add(upright, { Subtype: 'Link', Rect: [10, 10, 60, 30], Border: [0, 0, 0] });
  add(rotated, {
    Subtype: 'Line',
    Rect: [50, 50, 250, 150],
    C: [0, 0.2, 0],
    L: [50, 50, 250, 150],
    LE: ['None', 'OpenArrow'],
  });
  add(rotated, { Subtype: 'Text', Rect: [400, 600, 420, 620], Contents: PDFString.of('A note'), Name: 'Comment' });
  add(rotated, {
    Subtype: 'FreeText',
    Rect: [100, 400, 300, 450],
    Contents: PDFString.of('Typed words'),
    DA: PDFString.of('/Helv 12 Tf 0 0 0 rg'),
  });
  add(rotated, {
    Subtype: 'Polygon',
    Rect: [200, 200, 400, 400],
    C: [1, 0, 1],
    Vertices: [200, 200, 400, 200, 300, 400],
  });
  source = await document.save();

  const empty = await PDFDocument.create();
  empty.addPage([612, 792]);
  empty.addPage([612, 792]).setRotation(degrees(90));
  blank = await empty.save();
});

async function withSession<T>(bytes: Uint8Array, use: (session: MupdfSession) => Promise<T>): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await use(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Dark pixels on a page, so an imported annotation that draws nothing is caught. */
function inkOn(page: PDFPage): number {
  const pixmap = page.toPixmap(Matrix.identity, ColorSpace.DeviceRGB, false, true);
  const pixels = pixmap.getPixels();
  let ink = 0;
  for (let at = 0; at + 2 < pixels.length; at += 3) {
    if ((pixels[at] ?? 255) + (pixels[at + 1] ?? 255) + (pixels[at + 2] ?? 255) < 600) ink += 1;
  }
  pixmap.destroy();
  return ink;
}

/**
 * A record as it must come back: MuPDF recomputes the box of an annotation drawn from points, so
 * those are compared by their points, and every entry the original carried must be there.
 */
function comparable(record: InterchangeAnnotation): Partial<InterchangeAnnotation> {
  const drawnFromPoints = ['Highlight', 'Ink', 'Line', 'Polygon'].includes(record.subtype);
  const { rect, ...rest } = record;
  return drawnFromPoints ? rest : { ...rest, rect };
}

describe('annotation interchange — exported and imported through all three formats', () => {
  it('reads a document’s annotations as records: every exchanged subtype, no link, no action', async () => {
    const records = await withSession(source, readInterchangeAnnotations);
    expect(records).toStrictEqual(EXPECTED);
    expect(JSON.stringify(records)).not.toContain('JavaScript');
  });

  for (const format of ['json', 'xfdf', 'fdf'] as const satisfies readonly AnnotationDataFormat[]) {
    it(`${format}: what is exported imports into another document as the same annotations, drawn`, async () => {
      const exported = serialiseAnnotationData(await withSession(source, readInterchangeAnnotations), format);
      expect(parseAnnotationData(exported, format)).toHaveLength(EXPECTED.length);

      await withSession(blank, async (session) => {
        const before = await withDocument(session, (document) => [0, 1].map((page) => inkOn(document.loadPage(page))));
        await applyImportAnnotations(session, { kind: 'importAnnotations', format, bytes: exported });
        const records = await readInterchangeAnnotations(session);
        expect(records).toHaveLength(EXPECTED.length);
        for (const [index, expected] of EXPECTED.entries()) {
          expect(records[index]).toMatchObject(comparable(expected));
        }
        const after = await withDocument(session, (document) => [0, 1].map((page) => inkOn(document.loadPage(page))));
        expect(after[0]).toBeGreaterThan(before[0] ?? 0);
        expect(after[1]).toBeGreaterThan(before[1] ?? 0);
        // SURVIVES THE SAVE: the bytes reopen with the same annotations.
        const saved = await mupdfWriter.serialise(session);
        expect(await withSession(saved, readInterchangeAnnotations)).toHaveLength(EXPECTED.length);
        // AND EACH CARRIES A STORED APPEARANCE, read by a second library. MuPDF draws a missing one
        // when it renders, so its own raster cannot see this; PDF.js, which draws the page, needs it.
        const reread = await PDFDocument.load(saved, { updateMetadata: false });
        const appearances = reread.getPages().flatMap((page) => {
          const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
          return (annots?.asArray() ?? []).map((ref) => {
            const dictionary = reread.context.lookup(ref);
            return dictionary !== undefined && 'get' in dictionary && (dictionary as { get: (key: PDFName) => unknown }).get(PDFName.of('AP')) !== undefined;
          });
        });
        expect(appearances.filter(Boolean).length).toBeGreaterThanOrEqual(EXPECTED.length);
      });
    });
  }

  it('is reproducible: one file applied twice to the same bytes gives the same bytes', async () => {
    const exported = serialiseAnnotationData(EXPECTED, 'json');
    const once = async (): Promise<Uint8Array> =>
      withSession(blank, async (session) => {
        await applyImportAnnotations(session, { kind: 'importAnnotations', format: 'json', bytes: exported });
        return mupdfWriter.serialise(session);
      });
    expect(Buffer.from(await once()).equals(Buffer.from(await once()))).toBe(true);
  });

  describe('refuses, and adds nothing', () => {
    async function annotationCountAfter(bytes: Uint8Array, format: AnnotationDataFormat): Promise<{ error: unknown; count: number }> {
      return withSession(blank, async (session) => {
        let error: unknown;
        try {
          await applyImportAnnotations(session, { kind: 'importAnnotations', format, bytes });
        } catch (caught) {
          error = caught;
        }
        return { error, count: (await readInterchangeAnnotations(session)).length };
      });
    }

    it('a file placing one annotation past the last page — the valid ones are not added either', async () => {
      const onMissingPage = [...EXPECTED, { ...EXPECTED[0], page: 5 }] as InterchangeAnnotation[];
      const result = await annotationCountAfter(serialiseAnnotationData(onMissingPage, 'json'), 'json');
      expect(result.error).toBeInstanceOf(AnnotationPageMissingError);
      expect(result.count).toBe(0);
    });

    it('CONTROL: the same file without that annotation imports', async () => {
      const result = await annotationCountAfter(serialiseAnnotationData(EXPECTED, 'json'), 'json');
      expect(result.error).toBeUndefined();
      expect(result.count).toBe(EXPECTED.length);
    });

    it('a highlight with no quadrilaterals, which would draw nothing', () => {
      const text = new TextEncoder().encode(
        '<?xml version="1.0"?><xfdf><annots><highlight page="0" rect="1,1,2,2"/></annots></xfdf>',
      );
      expect(() => parseAnnotationData(text, 'xfdf')).toThrow(UnreadableAnnotationDataError);
    });

    it('an XFDF carrying a DOCTYPE, before anything is read from it', () => {
      const text = new TextEncoder().encode(
        '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///c:/windows/win.ini">]><xfdf><annots><text page="0" rect="1,1,2,2"><contents>&e;</contents></text></annots></xfdf>',
      );
      expect(() => parseAnnotationData(text, 'xfdf')).toThrow(XfdfDoctypeError);
    });

    it('a default appearance that is more than a font, a size and a colour', () => {
      const record = { ...EXPECTED[5], defaultAppearance: '/Helv 12 Tf 0 0 0 rg q 1 0 0 1 0 0 cm Q' };
      const bytes = new TextEncoder().encode(JSON.stringify({ format: 'monstera-annotations', version: 1, annotations: [record] }));
      expect(() => parseAnnotationData(bytes, 'json')).toThrow(UnreadableAnnotationDataError);
    });

    it('a file with nothing this build exchanges — the wrong file, most likely', async () => {
      const text = new TextEncoder().encode(
        '<?xml version="1.0"?><xfdf><annots><fileattachment page="0" rect="1,1,2,2"/></annots></xfdf>',
      );
      const result = await annotationCountAfter(text, 'xfdf');
      expect(result.error).toBeInstanceOf(NoImportableAnnotationsError);
      expect(result.count).toBe(0);
    });

    it('an FDF whose annotation names no page', () => {
      const fdf = new TextEncoder().encode(
        '%FDF-1.2\n1 0 obj\n<< /FDF << /Annots [2 0 R] >> >>\nendobj\n2 0 obj\n<< /Type /Annot /Subtype /Square /Rect [1 1 2 2] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
      );
      expect(() => parseAnnotationData(fdf, 'fdf')).toThrow(UnreadableAnnotationDataError);
    });
  });
});

describe('the annotation clipboard — records by walk handle, and a paste onto one page', () => {
  /**
   * A STAMP AHEAD OF A SQUARE, which is the whole reason the read is keyed by handle. A stamp is
   * not an exchanged subtype, so the interchange read leaves it out and answers the square at
   * position 0 — while the walk puts the square at index 1. A copy keyed by position would copy
   * the square for a person who selected the stamp.
   */
  async function stampThenSquare(): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    const page = document.addPage([612, 792]);
    const { context } = document;
    const refs = [
      context.register(context.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [50, 50, 150, 100], Name: 'Draft' } as never)),
      context.register(context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [200, 200, 300, 260], C: [0, 0, 1] } as never)),
    ];
    page.node.set(PDFName.of('Annots'), context.obj(refs));
    return document.save();
  }

  it('reads the mark AT each handle, with null in the place of one that makes no record', async () => {
    const records = await withSession(await stampThenSquare(), (session) =>
      readInterchangeRecordsAt(session, 0, [0, 1]),
    );
    expect(records[0]).toBeNull();
    expect(records[1]?.subtype).toBe('Square');
    expect(records[1]?.rect).toStrictEqual([200, 200, 300, 260]);
  });

  it('CONTROL: the whole-document read answers the square at position 0, which is why handles are used', async () => {
    // Without this, the case above cannot separate a handle-keyed read from a positional one that
    // happened to agree — and on a page with nothing left out, they always agree.
    const all = await withSession(await stampThenSquare(), readInterchangeAnnotations);
    expect(all.map((record) => record.subtype)).toStrictEqual(['Square']);
  });

  it('refuses a handle past the walk rather than answering for a mark that is not there', async () => {
    await expect(
      withSession(await stampThenSquare(), (session) => readInterchangeRecordsAt(session, 0, [2])),
    ).rejects.toThrow(RangeError);
  });

  /** Imports one record as a paste, and answers what the target document then holds. */
  async function pasted(
    record: InterchangeAnnotation,
    page: number,
    nudge: boolean,
  ): Promise<readonly InterchangeAnnotation[]> {
    return withSession(blank, async (session) => {
      await applyImportAnnotations(session, {
        kind: 'importAnnotations',
        format: 'json',
        bytes: serialiseAnnotationData([record], 'json'),
        paste: { page, nudge },
      });
      return readInterchangeAnnotations(session);
    });
  }

  it('lands on the page the paste names, exactly where it was, when that is another page', async () => {
    const square = EXPECTED[0];
    if (square === undefined) throw new Error('no fixture record');
    const after = await pasted(square, 1, false);
    expect(after.map((record) => record.page)).toStrictEqual([1]);
    expect(after[0]?.rect).toStrictEqual(square.rect);
  });

  it('is NUDGED 12 points right and down onto its own page — box AND geometry together', async () => {
    // The highlight, because its quadrilaterals are geometry the box does not carry: moving the
    // box alone would leave the ink where the original is, clipped to a rectangle somewhere else.
    const highlight = EXPECTED[1];
    if (highlight?.quadPoints === undefined) throw new Error('the fixture highlight carries no quadrilaterals');
    const [after] = await pasted(highlight, highlight.page, true);
    expect(after?.quadPoints).toStrictEqual(
      highlight.quadPoints.map((value, at) => (at % 2 === 0 ? value + 12 : value - 12)),
    );
    // THE BOX IS MuPDF'S, NOT THE RECORD'S. Measured 2026-09-21: `update()` re-derives a
    // highlight's `/Rect` from its quadrilaterals with its own padding, so the record's
    // [72, 700, 272, 720] reads back as [79.29, 686.75, 288.71, 709.25] after the nudge. The
    // assertion that survives that is relative: the same record pasted UN-nudged onto another
    // page gives MuPDF's box for the original quads, and the derivation is translation-invariant,
    // so the nudged box must be exactly that box moved by (12, −12).
    const [elsewhere] = await pasted(highlight, 1, false);
    if (elsewhere === undefined || after === undefined) throw new Error('a paste read back nothing');
    const [ex0, ey0, ex1, ey1] = elsewhere.rect;
    const moved = [ex0 + 12, ey0 - 12, ex1 + 12, ey1 - 12];
    after.rect.forEach((value, at) => {
      expect(value).toBeCloseTo(moved[at] ?? Number.NaN, 3);
    });
  });

  it('CONTROL: the SAME PAGE NUMBER is not nudged unless the paste says so — another document', async () => {
    // The case the first version of this rule failed. It inferred *its own page* from
    // `record.page === page`, and a record names a page, not a document — so a mark copied from
    // page 0 of one file and pasted onto page 0 of another moved twelve points for no reason.
    const square = EXPECTED[0];
    if (square === undefined) throw new Error('no fixture record');
    const [after] = await pasted(square, square.page, false);
    expect(after?.rect).toStrictEqual(square.rect);
  });

  it('CONTROL: a file import, with no page named, lands where each record says and is not nudged', async () => {
    // The nudge must belong to a PASTE ONTO ITS OWN PAGE and to nothing else. A file whose records
    // already name page 0 is not a copy of anything on page 0, and moving it would shift every
    // imported comment by twelve points.
    const square = EXPECTED[0];
    if (square === undefined) throw new Error('no fixture record');
    const after = await withSession(blank, async (session) => {
      await applyImportAnnotations(session, {
        kind: 'importAnnotations',
        format: 'json',
        bytes: serialiseAnnotationData([square], 'json'),
      });
      return readInterchangeAnnotations(session);
    });
    expect(after[0]?.rect).toStrictEqual(square.rect);
  });
});
