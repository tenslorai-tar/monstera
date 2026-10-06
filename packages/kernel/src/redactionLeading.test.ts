import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from './mupdfRaw.js';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ByteImage, MupdfSession } from './engineSeam.js';
import { applyAddAnnotation } from './pageAnnotations.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyApplyRedactions, applyMarkMatchesForRedaction } from './pageRedact.js';

/**
 * A redaction of ONE line of ordinarily spaced text, and the lines beside it (2a, F-R1).
 *
 * ## Why this fixture and not `pageRedact.test.ts`' own
 *
 * That file's two lines sit 60 points apart, where no box of one line reaches the other, so it cannot see the defect:
 * MuPDF removes a glyph when its box (the font's ascender to descender, shrunk by a tenth) touches the mark at all,
 * and a font's box reaches above and below its ink. Lines set close together have boxes that overlap, and a mark over
 * one line's full box then touches the next line's. Here three lines of 11 pt Helvetica sit 12 pt apart.
 *
 * ## Every case reads the words back
 *
 * A burn-in that removed too much and one that removed too little both leave a mark-free page, so the observable is
 * what MuPDF's own text extraction still finds, word by word, on every line.
 */
let written: ByteImage;

const SIZE = 11;
const LEADING = 12;
const TOP = 700;
const LINES = [
  'Alpha bravo charlie delta echo foxtrot',
  'Secret salary figure of ninety thousand',
  'Golf hotel india juliet kilo lima mike',
] as const;

/** The baseline of line `at`, in PDF space. */
const baseline = (at: number): number => TOP - at * LEADING;

beforeAll(async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  LINES.forEach((line, at) => {
    page.drawText(line, { font, size: SIZE, x: 72, y: baseline(at) });
  });
  written = await document.save();
});

/** Every word MuPDF's extraction finds on page 0 after the burn-in, line by line. */
async function wordsAfter(session: MupdfSession): Promise<string[]> {
  const bytes = await mupdfWriter.serialise(session);
  const reopened = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  try {
    const structured = JSON.parse(reopened.loadPage(0).toStructuredText().asJSON()) as {
      blocks?: readonly { lines?: readonly { text?: string }[] }[];
    };
    return (structured.blocks ?? [])
      .flatMap((block) => block.lines ?? [])
      .flatMap((line) => (line.text ?? '').split(/\s+/u))
      .filter((word) => word !== '');
  } finally {
    reopened.destroy();
  }
}

/** The words of fixture line `at`. */
const wordsOf = (at: number): string[] => (LINES[at] ?? '').split(' ');

async function burnIn(session: MupdfSession): Promise<void> {
  await applyApplyRedactions(session, { kind: 'applyRedactions', pages: [0], cover: 'solid', images: 'pixels', keepTitle: false });
}

describe('a redaction of one line of closely set text (2a, F-R1)', () => {
  it('a mark over SELECTED TEXT on the middle line removes that line, and every word above and below survives', async () => {
    const session = await mupdfWriter.open(written);
    try {
      // THE WHOLE MIDDLE LINE, as a person selects it: from before its first letter to past its last, at mid-height.
      const middle = baseline(1) + SIZE * 0.35;
      await applyAddAnnotation(session, {
        kind: 'addAnnotation',
        page: 0,
        stamp: { author: 'A. Tester', created: '2026-10-03T09:00:00.000Z' },
        annotation: {
          type: 'redact',
          over: 'text',
          from: { x: 71, y: middle },
          to: { x: 400, y: middle },
          colour: [0.85, 0.15, 0.15],
          opacity: 1,
        },
      });
      await burnIn(session);

      const left = await wordsAfter(session);
      // THE MARKED LINE IS GONE, every word of it.
      for (const word of wordsOf(1)) expect(left, `"${word}" was marked`).not.toContain(word);
      // AND THE LINES BESIDE IT ARE WHOLE.
      for (const word of [...wordsOf(0), ...wordsOf(2)]) expect(left, `"${word}" was not marked`).toContain(word);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('marks BY SEARCH on the middle line remove the match, and every word above and below survives', async () => {
    const session = await mupdfWriter.open(written);
    try {
      await applyMarkMatchesForRedaction(session, {
        kind: 'markMatchesForRedaction',
        query: 'salary figure',
        pages: 'all',
      });
      await burnIn(session);

      const left = await wordsAfter(session);
      expect(left).not.toContain('salary');
      expect(left).not.toContain('figure');
      // THE REST OF THE MARKED LINE stays: a search mark names the match, not its line.
      expect(left).toContain('Secret');
      for (const word of [...wordsOf(0), ...wordsOf(2)]) expect(left, `"${word}" was not marked`).toContain(word);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

describe('what a mark over TWO lines takes from beside the text', () => {
  /** A square annotation over `rect`, in PDF space. */
  async function square(session: MupdfSession, rect: { x0: number; y0: number; x1: number; y1: number }): Promise<void> {
    await applyAddAnnotation(session, {
      kind: 'addAnnotation',
      page: 0,
      stamp: { author: 'A. Tester', created: '2026-10-03T09:00:00.000Z' },
      annotation: { type: 'square', rect, colour: [0, 0, 1], opacity: 1, borderWidth: 1 },
    });
  }

  it('an annotation inside the mark’s BOX but under none of its quads survives — CONTROL: one under a quad goes', async () => {
    const session = await mupdfWriter.open(written);
    try {
      const firstLine = baseline(0) + SIZE * 0.35;
      // LEFT OF WHERE THE SELECTION STARTS on the first line: inside the box that holds both lines' quads, because the
      // second line's quad starts at the left margin, and under neither quad.
      await square(session, { x0: 74, y0: firstLine - 2, x1: 100, y1: firstLine + 2 });
      // UNDER THE FIRST LINE'S QUAD, right of where the selection starts.
      await square(session, { x0: 250, y0: firstLine - 2, x1: 270, y1: firstLine + 2 });
      await applyAddAnnotation(session, {
        kind: 'addAnnotation',
        page: 0,
        stamp: { author: 'A. Tester', created: '2026-10-03T09:00:00.000Z' },
        annotation: {
          type: 'redact',
          over: 'text',
          from: { x: 230, y: firstLine },
          to: { x: 150, y: baseline(1) + SIZE * 0.35 },
          colour: [0.85, 0.15, 0.15],
          opacity: 1,
        },
      });
      await burnIn(session);

      const bytes = await mupdfWriter.serialise(session);
      const reopened = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
      try {
        const page = reopened.loadPage(0);
        if (!(page instanceof mupdf.PDFPage)) throw new Error('a PDF opens as a PDF page');
        const squares = page
          .getAnnotations()
          .filter((annotation) => annotation.getType() === 'Square')
          .map((annotation) => Math.round(annotation.getRect()[0]));
        // THE ONE AT x 74 IS LEFT, the one at x 250 is gone. A sweep by the mark's union box takes both.
        expect(squares).toHaveLength(1);
        expect(squares[0]).toBeLessThan(100);
      } finally {
        reopened.destroy();
      }
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

describe('the fixture overlaps as the defect needs (a check on the case, not on the code)', () => {
  it('each line’s glyph box, shrunk by a tenth as MuPDF shrinks it, reaches into the next line’s box', async () => {
    // WITHOUT THIS the cases above could pass for a fixture whose lines simply do not touch — the 60-point file's
    // blind spot arriving in this one. Read from MuPDF's own structured text, the box its redaction filter uses.
    const session = await mupdfWriter.open(written);
    try {
      const lines = await withDocument(session, (document) => {
        const boxes: { y0: number; y1: number }[] = [];
        document
          .loadPage(0)
          .toStructuredText()
          .walk({
            beginLine: (bbox) => {
              boxes.push({ y0: bbox[1], y1: bbox[3] });
            },
          });
        return Promise.resolve(boxes);
      });
      expect(lines).toHaveLength(3);
      const [first, second] = lines;
      if (first === undefined || second === undefined) throw new Error('three lines');
      // y grows DOWN in MuPDF's frame: the first line's box bottom is below the second line's shrunk top.
      const shrunkTop = second.y0 + (second.y1 - second.y0) / 10;
      expect(first.y1).toBeGreaterThan(shrunkTop);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
