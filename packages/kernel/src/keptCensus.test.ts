import { PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { keptCensusOf, lostBetween } from './keptCensus.js';
import * as mupdf from './mupdfRaw.js';
import { wholeFile } from './pdfLibSession.js';

/**
 * The census *Convert text to curves* reads before and after (ADR-0282 Decision 4), over documents written by pdf-lib —
 * a writer that is not the reader — each holding a known number of every kind.
 */

interface Holds {
  readonly text?: boolean;
  readonly form?: boolean;
  readonly marks?: number;
  readonly links?: number;
  readonly bookmarks?: number;
  readonly attachments?: number;
  readonly layers?: number;
  readonly tags?: number;
  readonly title?: string;
  /** An outline item that is its own `/Next`, and a structure element that is its own kid. */
  readonly cycles?: boolean;
  /** A font written inline in an annotation appearance's resources, not as a numbered object. */
  readonly inlineFont?: boolean;
}

async function documentHolding(holds: Holds): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([612, 792]);
  const { context } = document;
  if (holds.text === true) {
    page.drawText('Kept', { x: 72, y: 700, size: 24, font: await document.embedFont(StandardFonts.Helvetica) });
  }
  if (holds.form === true) {
    const form = document.getForm();
    form.createTextField('name').addToPage(page, { x: 72, y: 600, width: 200, height: 20 });
    form.createCheckBox('agree').addToPage(page, { x: 72, y: 560, width: 12, height: 12 });
  }
  const annots = [];
  for (let at = 0; at < (holds.marks ?? 0); at += 1) {
    const appearance = context.stream('', {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 10, 10],
      ...(holds.inlineFont === true ? { Resources: { Font: { F1: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' } } } } : {}),
    });
    annots.push(context.register(context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 20, 20], AP: { N: context.register(appearance) } })));
  }
  for (let at = 0; at < (holds.links ?? 0); at += 1) {
    annots.push(
      context.register(
        context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [30, 30, 40, 40], A: { S: 'URI', URI: PDFString.of('https://example.org/') } }),
      ),
    );
  }
  if (annots.length > 0) page.node.set(PDFName.of('Annots'), context.obj(annots));

  if ((holds.bookmarks ?? 0) > 0) {
    const outlines = context.nextRef();
    const items = Array.from({ length: holds.bookmarks ?? 0 }, () => context.nextRef());
    items.forEach((ref, at) => {
      const next = holds.cycles === true && at === items.length - 1 ? ref : items[at + 1];
      context.assign(ref, context.obj({ Title: PDFString.of(`B${String(at)}`), Parent: outlines, ...(next === undefined ? {} : { Next: next }) }));
    });
    context.assign(outlines, context.obj({ Type: 'Outlines', First: items[0] ?? null }));
    document.catalog.set(PDFName.of('Outlines'), outlines);
  }
  for (let at = 0; at < (holds.attachments ?? 0); at += 1) {
    await document.attach(new Uint8Array([65 + at]), `file${String(at)}.txt`, { mimeType: 'text/plain' });
  }
  if ((holds.layers ?? 0) > 0) {
    const groups = Array.from({ length: holds.layers ?? 0 }, (_, at) => context.register(context.obj({ Type: 'OCG', Name: PDFString.of(`L${String(at)}`) })));
    document.catalog.set(PDFName.of('OCProperties'), context.obj({ OCGs: groups, D: { Order: groups } }));
  }
  if ((holds.tags ?? 0) > 0) {
    const elements = Array.from({ length: holds.tags ?? 0 }, () => context.nextRef());
    elements.forEach((ref, at) => {
      const kid = holds.cycles === true && at === 0 ? ref : 0;
      context.assign(ref, context.obj({ Type: 'StructElem', S: 'P', Pg: page.ref, K: kid }));
    });
    document.catalog.set(PDFName.of('StructTreeRoot'), context.obj({ Type: 'StructTreeRoot', K: elements }));
  }
  if (holds.title !== undefined) document.setTitle(holds.title);
  return wholeFile(document, { useObjectStreams: false });
}

function censusOf(bytes: Uint8Array): ReturnType<typeof keptCensusOf> {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  try {
    if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
    return keptCensusOf(document);
  } finally {
    document.destroy();
  }
}

const NOTHING = { pages: 1, marks: 0, links: 0, 'link-targets': 0, bookmarks: 0, attachments: 0, layers: 0, fields: 0, tags: 0, title: 0 };

describe('keptCensusOf — what a person would miss, counted', () => {
  it('counts every kind a document holds, each exactly', async () => {
    const census = censusOf(
      await documentHolding({ text: true, form: true, marks: 2, links: 3, bookmarks: 2, attachments: 2, layers: 2, tags: 4, title: 'Report' }),
    );
    expect(census.kept).toEqual({ pages: 1, marks: 2, links: 3, 'link-targets': 3, bookmarks: 2, attachments: 2, layers: 2, fields: 2, tags: 4, title: 1 });
    expect(census.fonts).toBeGreaterThan(0);
  });

  it('CONTROL: a page holding nothing counts nothing, and no font where nothing is written in one', async () => {
    const census = censusOf(await documentHolding({}));
    expect(census.kept).toEqual(NOTHING);
    expect(census.fonts).toBe(0);
  });

  it('finds a font written inline in an appearance, where no numbered object is a font', async () => {
    expect(censusOf(await documentHolding({ marks: 1, inlineFont: true })).fonts).toBe(1);
    // CONTROL: the same mark, its appearance drawing with no font.
    expect(censusOf(await documentHolding({ marks: 1 })).fonts).toBe(0);
  });

  it('ends on a cyclic outline and a cyclic structure tree, each counted once', async () => {
    const census = censusOf(await documentHolding({ bookmarks: 3, tags: 2, cycles: true }));
    expect(census.kept.bookmarks).toBe(3);
    expect(census.kept.tags).toBe(2);
  });
});

describe('lostBetween — what fell is named, and only that', () => {
  it('names a form’s fields, its tags and a link that lost its address, with both counts', () => {
    const before = { ...NOTHING, fields: 3, tags: 5, links: 2, 'link-targets': 2, title: 1 };
    const after = { ...NOTHING, fields: 0, tags: 0, links: 2, 'link-targets': 1, title: 1 };
    expect(lostBetween(before, after)).toEqual([
      { kind: 'link-targets', before: 2, after: 1 },
      { kind: 'fields', before: 3, after: 0 },
      { kind: 'tags', before: 5, after: 0 },
    ]);
  });

  it('CONTROL: nothing lost reports nothing, and a count that rose is not a loss', () => {
    expect(lostBetween({ ...NOTHING, marks: 2 }, { ...NOTHING, marks: 2 })).toEqual([]);
    expect(lostBetween(NOTHING, { ...NOTHING, marks: 1 })).toEqual([]);
  });
});
