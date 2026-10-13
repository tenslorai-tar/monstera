import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, type PDFRef, PDFString } from '@cantoo/pdf-lib';
import { MAX_PDFA_LEFT_OUT } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import * as mupdf from './mupdfRaw.js';
import { prepareForPdfa } from './pdfaPreparation.js';

/**
 * The PDF/A preparation, written by pdf-lib and read back by pdf-lib — a reader that is not the writer.
 *
 * Each fixture is a mark in a state Ghostscript was measured to drop (ADR-0075's 2026-10-13 correction) or one PDF/A
 * forbids, beside the controls a preparation must leave alone: a printed mark, a link.
 */

interface Mark {
  readonly subtype: string;
  readonly flags?: number;
  /** Gives the mark a closed comment pop-up, as the app's own writer does. */
  readonly popup?: boolean;
  /** Gives the mark an empty appearance stream. */
  readonly appearance?: boolean;
}

/** One page per entry of `pages`, each holding its marks, saved. */
async function documentWith(pages: readonly (readonly Mark[])[]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const marks of pages) {
    const page = document.addPage([612, 792]);
    const refs: PDFRef[] = [];
    for (const mark of marks) {
      const annotation = document.context.obj({ Type: 'Annot', Subtype: mark.subtype, Rect: [100, 100, 200, 200], Contents: PDFString.of('x') });
      if (mark.flags !== undefined) annotation.set(PDFName.of('F'), PDFNumber.of(mark.flags));
      if (mark.subtype === 'Link') annotation.set(PDFName.of('Border'), document.context.obj([0, 0, 0]));
      if (mark.subtype === 'Square') annotation.set(PDFName.of('C'), document.context.obj([1, 0, 0]));
      if (mark.appearance === true) {
        const stream = document.context.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 100] });
        annotation.set(PDFName.of('AP'), document.context.obj({ N: document.context.register(stream) }));
      }
      const ref = document.context.register(annotation);
      refs.push(ref);
      if (mark.popup === true) {
        const popup = document.context.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [200, 200, 300, 300], Parent: ref });
        const popupRef = document.context.register(popup);
        annotation.set(PDFName.of('Popup'), popupRef);
        refs.push(popupRef);
      }
    }
    page.node.set(PDFName.of('Annots'), document.context.obj(refs));
  }
  return document.save({ useObjectStreams: false });
}

/** Prepares `bytes` as the compose host does, answering the preparation and the written copy. */
function prepared(bytes: Uint8Array): { readonly answer: ReturnType<typeof prepareForPdfa>; readonly copy: Uint8Array } {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  try {
    if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
    const answer = prepareForPdfa(document);
    const buffer = document.saveToBuffer('garbage,encrypt=none');
    try {
      return { answer, copy: buffer.asUint8Array().slice() };
    } finally {
      buffer.destroy();
    }
  } finally {
    document.destroy();
  }
}

/** Each page's marks in the copy: subtype, flags, whether it has an appearance and a pop-up. */
async function marksIn(copy: Uint8Array) {
  const document = await PDFDocument.load(copy, { updateMetadata: false });
  return document.getPages().map((page) =>
    (page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray() ?? [])
      .map((entry) => document.context.lookup(entry))
      .filter((entry): entry is PDFDict => entry instanceof PDFDict)
      .map((entry) => {
        const flags = entry.get(PDFName.of('F'));
        return {
          subtype: String(entry.get(PDFName.of('Subtype'))),
          flags: flags instanceof PDFNumber ? flags.asNumber() : undefined,
          appearance: entry.get(PDFName.of('AP')) !== undefined,
          popup: entry.get(PDFName.of('Popup')) !== undefined,
        };
      }),
  );
}

describe('a PDF/A copy is prepared so the converter keeps what it can, and names what it cannot (the owner’s N7)', () => {
  it('THE OWNER’S CASE: a note keeps its text and Print flag, and its pop-up is removed and named on its page', async () => {
    const { answer, copy } = prepared(await documentWith([[], [{ subtype: 'Text', flags: 28, popup: true, appearance: true }]]));

    expect(answer.leftOut).toStrictEqual([{ page: 1, kind: 'comment-popup', count: 1 }]);
    expect(await marksIn(copy)).toStrictEqual([[], [{ subtype: '/Text', flags: 28, appearance: true, popup: false }]]);
  });

  it('a mark shown but not printed is given the Print flag, and ToggleNoView is cleared', async () => {
    const { answer, copy } = prepared(
      await documentWith([[{ subtype: 'Square', appearance: true }, { subtype: 'Square', flags: 4 | 256, appearance: true }]]),
    );

    expect(answer.printed).toBe(2);
    expect(answer.leftOut).toStrictEqual([]);
    expect((await marksIn(copy))[0]?.map((mark) => mark.flags)).toStrictEqual([4, 4]);
  });

  it('a hidden mark and the forbidden kinds are removed and named, counted per page and kind', async () => {
    const { answer, copy } = prepared(
      await documentWith([
        [{ subtype: 'Square', flags: 4 | 2, appearance: true }, { subtype: 'Square', flags: 32, appearance: true }],
        [{ subtype: 'Sound', flags: 4 }, { subtype: 'Screen', flags: 4 }, { subtype: '3D', flags: 4 }],
      ]),
    );

    expect(answer.leftOut).toStrictEqual([
      { page: 0, kind: 'hidden-mark', count: 2 },
      { page: 1, kind: '3d', count: 1 },
      { page: 1, kind: 'movie', count: 1 },
      { page: 1, kind: 'sound', count: 1 },
    ]);
    expect(await marksIn(copy)).toStrictEqual([[], []]);
  });

  it('names at most the bound’s entries and COUNTS the items past it, so nothing removed goes unsaid', async () => {
    // ONE PAGE PAST THE BOUND, each with two pop-ups: the last page's two are counted rather than dropped.
    const pages = Array.from({ length: MAX_PDFA_LEFT_OUT + 1 }, () => [{ subtype: 'Text', flags: 4, popup: true, appearance: true }, { subtype: 'Text', flags: 4, popup: true, appearance: true }]);
    const { answer } = prepared(await documentWith(pages));

    expect(answer.leftOut).toHaveLength(MAX_PDFA_LEFT_OUT);
    expect(answer.leftOut.at(-1)).toStrictEqual({ page: MAX_PDFA_LEFT_OUT - 1, kind: 'comment-popup', count: 2 });
    expect(answer.leftOutMore).toBe(2);
  });

  it('a mark with no appearance is given MuPDF’s', async () => {
    const { answer, copy } = prepared(await documentWith([[{ subtype: 'Square', flags: 4 }]]));

    expect(answer.drawn).toBe(1);
    expect((await marksIn(copy))[0]?.[0]?.appearance).toBe(true);
  });

  it('CONTROL: a printed mark with an appearance and a link are left exactly as they were, and nothing is named', async () => {
    const { answer, copy } = prepared(
      await documentWith([[{ subtype: 'Square', flags: 4, appearance: true }, { subtype: 'Link' }]]),
    );

    expect(answer).toStrictEqual({ printed: 0, drawn: 0, leftOut: [], leftOutMore: 0 });
    expect(await marksIn(copy)).toStrictEqual([
      [
        { subtype: '/Square', flags: 4, appearance: true, popup: false },
        { subtype: '/Link', flags: undefined, appearance: false, popup: false },
      ],
    ]);
  });
});
