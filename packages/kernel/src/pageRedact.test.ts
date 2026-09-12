import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ByteImage, MupdfSession } from './engineSeam.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import {
  applyApplyRedactions,
  applyMarkMatchesForRedaction,
  captureApplyRedactions,
} from './pageRedact.js';

/**
 * Burning redact marks in — D3 row 131's other half.
 *
 * ## Every case reads the TEXT back, never the annotation count
 *
 * A redaction that consumed the mark and left the words is exactly the defect
 * this command exists to prevent, and it answers `0 annotations` as
 * convincingly as a correct one. So the observable is what
 * `toStructuredText` can still find.
 */
let written: ByteImage;

/** The words the fixture puts on each of its two pages. */
const SECRET = 'Salary 91000 GBP';
const KEPT = 'Ordinary paragraph text';

beforeAll(async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage([612, 792]);
  first.drawText(SECRET, { font, size: 18, x: 72, y: 700 });
  first.drawText(KEPT, { font, size: 18, x: 72, y: 640 });
  const second = document.addPage([612, 792]);
  second.drawText(SECRET, { font, size: 18, x: 72, y: 700 });
  written = await document.save();
});

/** Every line `toStructuredText` finds on a page, joined. */
function textOn(document: mupdf.PDFDocument, page: number): string {
  const structured = JSON.parse(document.loadPage(page).toStructuredText().asJSON()) as {
    blocks?: readonly { lines?: readonly { text?: string }[] }[];
  };
  return (structured.blocks ?? [])
    .flatMap((block) => block.lines ?? [])
    .map((line) => line.text ?? '')
    .join('\n');
}

/** Puts a `/Redact` over the first line of `page`, in that page's own space. */
function markFirstLine(session: MupdfSession, page: number): Promise<void> {
  return withDocument(session, (document) => {
    const loaded = document.loadPage(page);
    const structured = JSON.parse(loaded.toStructuredText().asJSON()) as {
      blocks: readonly { lines: readonly { bbox: { x: number; y: number; w: number; h: number } }[] }[];
    };
    const box = structured.blocks[0]?.lines[0]?.bbox;
    if (box === undefined) throw new Error('the fixture has no text to mark');
    const annotation = loaded.createAnnotation('Redact');
    annotation.setRect([box.x, box.y, box.x + box.w, box.y + box.h]);
    annotation.update();
  });
}

/** What a session's serialised bytes say, read back through a fresh open. */
async function readBack(session: MupdfSession): Promise<readonly string[]> {
  const bytes = await mupdfWriter.serialise(session);
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the output is not a PDF');
  try {
    return [textOn(document, 0), textOn(document, 1)];
  } finally {
    document.destroy();
  }
}

describe('applyRedactions', () => {
  it('CONTROL: the fixture carries the secret on both pages before anything runs', async () => {
    // Without this, every assertion below is satisfied by a fixture that never
    // had the words in it — and a redaction that did nothing would pass.
    const session = await mupdfWriter.open(written);
    try {
      const [first, second] = await readBack(session);
      expect(first).toContain(SECRET);
      expect(first).toContain(KEPT);
      expect(second).toContain(SECRET);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('REMOVES the marked text and leaves the rest of the page', async () => {
    const session = await mupdfWriter.open(written);
    try {
      await markFirstLine(session, 0);
      await applyApplyRedactions(session, {
        kind: 'applyRedactions',
        pages: [0],
        cover: 'solid',
        images: 'pixels',
      });

      const [first] = await readBack(session);
      expect(first).not.toContain(SECRET);
      // THE OTHER LINE IS THE POINT of this assertion: a command that rewrote
      // the page's content stream to nothing would pass the line above and take
      // the whole page with it.
      expect(first).toContain(KEPT);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a page the scope did not name is untouched', async () => {
    // The scope is the one thing this payload carries that the engine does not
    // decide, and a loop over `countPages()` that ignored it would pass every
    // assertion above.
    const session = await mupdfWriter.open(written);
    try {
      await markFirstLine(session, 0);
      await markFirstLine(session, 1);
      await applyApplyRedactions(session, {
        kind: 'applyRedactions',
        pages: [0],
        cover: 'solid',
        images: 'pixels',
      });

      const [first, second] = await readBack(session);
      expect(first).not.toContain(SECRET);
      expect(second).toContain(SECRET);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('`all` reaches every page, in one pass', async () => {
    const session = await mupdfWriter.open(written);
    try {
      await markFirstLine(session, 0);
      await markFirstLine(session, 1);
      await applyApplyRedactions(session, {
        kind: 'applyRedactions',
        pages: 'all',
        cover: 'solid',
        images: 'pixels',
      });

      const [first, second] = await readBack(session);
      expect(first).not.toContain(SECRET);
      expect(second).not.toContain(SECRET);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('refuses a page the document does not have, rather than skipping it', async () => {
    // Clamping would burn in some marks and report that it burned in all of
    // them, which is the shape of every silent redaction failure.
    const session = await mupdfWriter.open(written);
    try {
      await expect(
        applyApplyRedactions(session, {
          kind: 'applyRedactions',
          pages: [0, 7],
          cover: 'solid',
          images: 'pixels',
        }),
      ).rejects.toThrow(/page 7 of a document with 2 pages/u);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('marks the session as a REMOVAL, so the next serialise collects', async () => {
    // §4 puts redaction on the removal row and ADR-0008 rule 1 says why: an
    // incremental save leaves the covered content readable by walking the xref
    // chain. The observable is the option string's effect — a collecting save
    // renumbers, so the unlinked mark's object is gone rather than orphaned.
    const session = await mupdfWriter.open(written);
    try {
      await markFirstLine(session, 0);
      await applyApplyRedactions(session, {
        kind: 'applyRedactions',
        pages: [0],
        cover: 'solid',
        images: 'pixels',
      });
      const bytes = await mupdfWriter.serialise(session);
      const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
      if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
      try {
        // NO REDACT ANNOTATION SURVIVES, and no orphan of one: the mark was
        // consumed by the burn-in and the collecting save dropped its object.
        expect(document.loadPage(0).getAnnotations()).toStrictEqual([]);
      } finally {
        document.destroy();
      }
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('MARKS BY SEARCH, and the marks then burn in like any other', async () => {
    const session = await mupdfWriter.open(written);
    try {
      await applyMarkMatchesForRedaction(session, {
        kind: 'markMatchesForRedaction',
        query: '91000',
        pages: 'all',
      });
      // NOTHING IS REMOVED YET, which is the two-step shape asserted rather
      // than described: a command that redacted on the spot would pass every
      // assertion below and take away the review the design exists for.
      const [beforeFirst, beforeSecond] = await readBack(session);
      expect(beforeFirst).toContain(SECRET);
      expect(beforeSecond).toContain(SECRET);

      await applyApplyRedactions(session, {
        kind: 'applyRedactions',
        pages: 'all',
        cover: 'solid',
        images: 'pixels',
      });
      const [first, second] = await readBack(session);
      expect(first).not.toContain('91000');
      expect(second).not.toContain('91000');
      // AND THE REST OF THE LINE SURVIVES, which is what a line-scoped mark
      // would have taken: the application's own search answers a line and an
      // offset, and the substrate reports no per-character geometry — so a
      // mark built from it would have covered `Salary … GBP` too.
      expect(first).toContain('Salary');
      expect(first).toContain(KEPT);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a term the document does not carry marks nothing', async () => {
    // Without this, a command that marked the whole page whatever it was given
    // would pass the case above — and burn the document.
    const session = await mupdfWriter.open(written);
    try {
      await applyMarkMatchesForRedaction(session, {
        kind: 'markMatchesForRedaction',
        query: 'zzqq-not-in-this-document',
        pages: 'all',
      });
      await applyApplyRedactions(session, {
        kind: 'applyRedactions',
        pages: 'all',
        cover: 'solid',
        images: 'pixels',
      });
      const [first, second] = await readBack(session);
      expect(first).toContain(SECRET);
      expect(first).toContain(KEPT);
      expect(second).toContain(SECRET);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: the search IGNORES capitalisation, which is why no control offers it', async () => {
    // Measured 2026-09-12 and asserted here, because the absent *match case*
    // control is a decision: a dialog offering one would render and do nothing.
    const session = await mupdfWriter.open(written);
    try {
      await applyMarkMatchesForRedaction(session, {
        kind: 'markMatchesForRedaction',
        query: 'salary',
        pages: [0],
      });
      await applyApplyRedactions(session, {
        kind: 'applyRedactions',
        pages: [0],
        cover: 'solid',
        images: 'pixels',
      });
      const [first] = await readBack(session);
      expect(first).not.toContain('Salary');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('refuses to record prior state, because the prior state is what was removed', async () => {
    const session = await mupdfWriter.open(written);
    try {
      const captured = await captureApplyRedactions(session);
      expect(captured.captured).toBe(false);
      // THE REASON IS ASSERTED. A refusal for a different reason — an engine
      // that would not answer — reads identically and means something else.
      expect(captured.captured ? '' : captured.reason).toContain('command log');
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
