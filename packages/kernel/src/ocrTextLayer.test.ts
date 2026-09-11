import {
  PDFDict,
  PDFDocument,
  PDFName,
  StandardFonts,
  TextRenderingMode,
  degrees,
} from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';

import type { RecognisedLine } from './ocrRecognise.js';
import {
  GLYPHLESS_FONT_NAME,
  applyOcrPage,
  captureOcrPage,
  glyphlessFont,
  writeRecognisedText,
} from './ocrTextLayer.js';
import { type TextLayer, textLayerOf } from './textLayer.js';
import { findInPages, lineOf } from './textSearch.js';
import { STEXT_OPTION_STRING, parsePageText } from './textStructure.js';

/**
 * The invisible text layer, read back through the reader this build ships.
 *
 * ## Every case reads through `textLayerOf`, never through pdf-lib
 *
 * Asking pdf-lib what it wrote is asking the writer. What decides whether this
 * feature works is what **MuPDF** gets back, because `document.pageTextLayer` is
 * the one answer to *what does this page say* and OCR'd text has to reach that
 * same substrate — so these cases parse with `parsePageText` and flatten with
 * `textLayerOf`, which is the production path with the channel's own bounds left
 * out of the question.
 *
 * ## The control is a STANDARD FONT, because that is the defect
 *
 * `scripts/research/textLayerFont.mjs` measured it: a standard font writes
 * `U+003F` for every script the corpus needs and throws nothing. A case
 * asserting *this module's layer reads back verbatim* would pass against a
 * broken writer the day the fixture is Latin-only, so the non-Latin cases each
 * have a sibling drawing the same string through `StandardFonts.Helvetica` and
 * asserting it comes back as question marks. That is B2's control: it reproduces
 * the original defect with the fix removed.
 */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

/** Bounds a channel would impose, chosen well above every fixture here. */
const LINE_LIMIT = 64;
const LINE_CHARS = 256;

type Box = readonly [number, number, number, number];

/** One recognised line from words, with the confidence a reading carries. */
function recognised(box: Box, words: readonly { text: string; box: Box }[]): RecognisedLine {
  return {
    text: words.map((word) => word.text).join(' '),
    box,
    words: words.map((word) => ({ ...word, confidence: 90 })),
  };
}

/** The page's text as the application reads it. */
function layerOf(bytes: Uint8Array, index = 0): TextLayer {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  // NARROWED RATHER THAN CAST: `openDocument` is typed as returning the base
  // document, and a fixture that did not parse must fail here rather than at a
  // missing page later.
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the fixture did not parse');
  const stext = document.loadPage(index).toStructuredText(STEXT_OPTION_STRING);
  try {
    return textLayerOf(parsePageText(stext.asJSON()), LINE_LIMIT, LINE_CHARS);
  } finally {
    stext.destroy();
  }
}

/**
 * How many pixels MuPDF paints for a page.
 *
 * `formFields.test.ts` carries the same three lines for a different question —
 * whether a flatten drew anything — and they are kept separate deliberately:
 * that one counts ink to prove something WAS drawn, this one to prove nothing
 * was, and a shared helper would need a name that means both.
 */
function inked(bytes: Uint8Array): number {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the fixture did not parse');
  const pixmap = document
    .loadPage(0)
    .toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray, false, true);
  try {
    let marked = 0;
    for (const sample of pixmap.getPixels()) if (sample < 250) marked += 1;
    return marked;
  } finally {
    pixmap.destroy();
  }
}

/** A document carrying one page of recognised text, saved. */
async function written(lines: readonly RecognisedLine[], rotation = 0): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  if (rotation !== 0) page.setRotation(degrees(rotation));
  writeRecognisedText(page, glyphlessFont(document), lines);
  return document.save();
}

/**
 * The same word, at the same place ON SCREEN, for each legal `/Rotate`.
 *
 * A recognition's boxes are in **user** space and what Tesseract read is upright
 * in **display** space, so these four user-space rectangles are one display
 * rectangle — `{x: 72, y: 76, w: 80, h: 16}` — run back through each page's own
 * transform. The arithmetic is this file's rather than a run's: at 90 the page's
 * matrix is `[0 1 1 0 0 0]`, so display x is user y and display y is user x; at
 * 180 it is `[-1 0 0 1 612 0]`; at 270 `[0 -1 -1 0 792 612]`.
 *
 * That is what makes the rotation cases assert **one** number rather than four: a
 * word sits where it was read whatever the page's rotation, and a table entry with
 * the wrong corner or the wrong sign puts the run outside its box, which the box
 * assertion sees.
 */
const SAME_PLACE: Readonly<Record<number, Box>> = {
  0: [72, 700, 152, 716],
  90: [76, 72, 92, 152],
  180: [460, 76, 540, 92],
  270: [520, 640, 536, 720],
};

/** Where all four of {@link SAME_PLACE} must read back. */
const ON_SCREEN = { x0: 72, y0: 76, x1: 152, y1: 92 };

/** The same string drawn through a standard font, which is the defect. */
async function throughStandardFont(text: string): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawText(text, {
    x: 72,
    y: 700,
    size: 16,
    font: await document.embedFont(StandardFonts.Helvetica),
    renderMode: TextRenderingMode.Invisible,
  });
  return document.save();
}

describe('writeRecognisedText', () => {
  it('reads back the words it wrote, as one line, verbatim', async () => {
    const bytes = await written([
      recognised([72, 700, 235, 716], [
        { text: 'Monstera', box: [72, 700, 152, 716] },
        { text: 'deliciosa', box: [158, 700, 235, 716] },
      ]),
    ]);

    const layer = layerOf(bytes);
    expect(layer.lines).toHaveLength(1);
    // THE SPACE IS MuPDF's, synthesised from the gap between the two boxes. That
    // is what makes writing per WORD free: the words carry their own geometry and
    // the reader still answers a line.
    expect(layer.lines[0]?.text).toBe('Monstera deliciosa');
    expect(layer.kind).toBe('text');
  });

  it('places the line where the words were placed, in display space', async () => {
    const bytes = await written([
      recognised([72, 700, 235, 716], [{ text: 'Monstera', box: [72, 700, 152, 716] }]),
    ]);

    // DISPLAY SPACE IS Y-DOWN FROM THE TOP, so a box written at y 700..716 on a
    // 792-point page reads back at 76..92 — and those numbers are this file's
    // arithmetic rather than a run's: 792 − 716 and 792 − 700. A layer written
    // with the flip the wrong way round lands at 700..716 and this case is the
    // one that separates them.
    expect(layerOf(bytes).lines[0]?.box).toEqual(ON_SCREEN);
  });

  it('PLACES IT THERE ON A ROTATED PAGE TOO, which it did not until 2026-09-11', async () => {
    // Finding FFFFFF-1. The recognition's boxes are in user space and the words
    // are upright in DISPLAY space, so a run written horizontally in user space on
    // a quarter-turned page runs across the visible text. `ROTATED_RUN` is the
    // four-entry table that turns it, and this is what holds each entry: the wrong
    // corner or the wrong sign puts the run outside the box it was fitted to, and
    // the box read back stops being the one every rotation shares.
    for (const rotation of [90, 180, 270]) {
      const box = SAME_PLACE[rotation] ?? [0, 0, 0, 0];
      const bytes = await written([recognised(box, [{ text: 'Monstera', box }])], rotation);
      expect(layerOf(bytes).lines[0]?.box, `/Rotate ${String(rotation)}`).toEqual(ON_SCREEN);
    }
  });

  it('KEEPS THE SPACE BETWEEN TWO WORDS on a rotated page, which is what separates the turn', async () => {
    // THE OBSERVABLE THAT SEPARATES A ROTATED RUN FROM AN UNROTATED ONE, and it
    // took measuring to find: for a SINGLE word MuPDF reports the identical line,
    // text and bounding box either way, because both fill the same box. Two words
    // do not — the space between them is MuPDF's, synthesised from a gap along the
    // baseline, and runs that do not share a baseline direction have no gap to
    // synthesise from.
    //
    // So an unrotated run on a rotated page loses the space, and a phrase search
    // across it stops matching. A case asserting only the box would be a fixture
    // the defect also handles correctly.
    const first: Box = [76, 72, 92, 152];
    const second: Box = [76, 158, 92, 235];
    const bytes = await written(
      [
        recognised([76, 72, 92, 235], [
          { text: 'Monstera', box: first },
          { text: 'deliciosa', box: second },
        ]),
      ],
      90,
    );

    const text = layerOf(bytes)
      .lines.map((line) => line.text)
      .join('');
    expect(text).toContain('Monstera deliciosa');
  });

  it('carries the scripts a standard font cannot encode', async () => {
    const samples = ['Монстера', '龍脈', 'मोन्स'];
    for (const [index, text] of samples.entries()) {
      const bytes = await written([
        recognised([72, 700 - index * 24, 200, 716 - index * 24], [
          { text, box: [72, 700 - index * 24, 200, 716 - index * 24] },
        ]),
      ]);
      expect(layerOf(bytes).lines[0]?.text).toBe(text);
    }
  });

  it('CONTROL: the same scripts through a standard font come back as question marks', async () => {
    for (const text of ['Монстера', '龍脈', 'मोन्स']) {
      const layer = layerOf(await throughStandardFont(text));
      // NOT A THROW AND NOT AN ABSENCE — `U+003F` per character, which is why the
      // defect this module exists for is silent.
      expect(layer.lines[0]?.text).toBe('?'.repeat(text.length));
    }
  });

  it('keeps every right-to-left codepoint, in the reading order MuPDF answers', async () => {
    const text = 'מונסטרה';
    const bytes = await written([
      recognised([72, 700, 200, 716], [{ text, box: [72, 700, 200, 716] }]),
    ]);

    const read = layerOf(bytes).lines[0]?.text ?? '';
    // EXACTLY REVERSED, asserted as a string rather than as a set: MuPDF applies
    // bidi reordering to an RTL run and answers it in visual order. Stating it as
    // the reverse is what separates *reordered* from *some characters lost*,
    // which a set comparison could not.
    // `Array.from` RATHER THAN A SPREAD, which the lint rule bans for a reason
    // that does not apply and would be wrong to disable: it warns that codepoints
    // are not graphemes. Here the unit genuinely is the codepoint — it is what
    // MuPDF reorders and what the content stream carries — and this sample has no
    // combining marks, so the two units coincide for it.
    expect(read).toBe(Array.from(text).reverse().join(''));
    expect(Array.from(read).sort()).toEqual(Array.from(text).sort());
  });

  it('paints nothing', async () => {
    const bytes = await written([
      recognised([72, 700, 235, 716], [{ text: 'Monstera', box: [72, 700, 152, 716] }]),
    ]);

    expect(inked(bytes)).toBe(0);
  });

  it('CONTROL: the ink count can see ink', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawText('Monstera', {
      x: 72,
      y: 700,
      size: 16,
      font: await document.embedFont(StandardFonts.Helvetica),
    });

    // Without this the case above is satisfied by a page nothing was written to
    // at all, which is the reading an absent layer produces.
    expect(inked(await document.save())).toBeGreaterThan(0);
  });

  it('draws a line that carries no words from the line’s own box', async () => {
    const bytes = await written([{ text: 'unsegmented', box: [72, 700, 200, 716], words: [] }]);

    expect(layerOf(bytes).lines[0]?.text).toBe('unsegmented');
  });

  it('skips a run with no area or no text, and says how many it drew', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const drawn = writeRecognisedText(page, glyphlessFont(document), [
      recognised([72, 700, 200, 716], [
        { text: 'kept', box: [72, 700, 120, 716] },
        { text: 'flat', box: [130, 700, 180, 700] },
        { text: '', box: [190, 700, 240, 716] },
      ]),
    ]);

    // A SQUEEZE COMPUTED FROM A ZERO-HEIGHT BOX IS A DIVISION BY ZERO, and a run
    // at a degenerate box is text nothing can select. Both are skipped and the
    // count is what a caller reads to know it happened.
    expect(drawn).toBe(1);
    expect(layerOf(await document.save()).lines[0]?.text).toBe('kept');
  });

  it('writes nothing, and says so, for a recognition with no lines', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    expect(writeRecognisedText(page, glyphlessFont(document), [])).toBe(0);
    expect(layerOf(await document.save()).kind).toBe('empty');
  });

  it('one registered font serves every page', async () => {
    const document = await PDFDocument.create();
    const font = glyphlessFont(document);
    for (const index of [0, 1]) {
      const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      writeRecognisedText(page, font, [
        recognised([72, 700, 200, 716], [{ text: `page${String(index)}`, box: [72, 700, 200, 716] }]),
      ]);
    }

    const bytes = await document.save();
    expect(layerOf(bytes, 0).lines[0]?.text).toBe('page0');
    expect(layerOf(bytes, 1).lines[0]?.text).toBe('page1');
    // ONE FONT OBJECT FOR BOTH PAGES. Registering per page would grow a
    // recognised document by a font per page, which is invisible in every text
    // assertion above — and counting the NAME in the saved bytes cannot see it
    // either, because pdf-lib writes object streams by default and the name is
    // inside one. This counts the registered objects instead, which is a claim
    // about what this module wrote rather than about what a reader gets back.
    const fonts = document.context
      .enumerateIndirectObjects()
      .filter(
        ([, object]) =>
          object instanceof PDFDict && object.get(PDFName.of('Subtype')) === PDFName.of('Type0'),
      );
    expect(fonts).toHaveLength(1);
    expect(fonts[0]?.[1] instanceof PDFDict && fonts[0][1].get(PDFName.of('BaseFont'))).toBe(
      PDFName.of(GLYPHLESS_FONT_NAME),
    );
  });

  it('writes to the page the command names, and to no other', async () => {
    const blank = await PDFDocument.create();
    for (const _page of [0, 1, 2]) blank.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    const written = await applyOcrPage(
      await blank.save(),
      { kind: 'ocrPage', page: 1, language: 'eng' },
      {
        lines: [
          recognised([72, 700, 152, 716], [{ text: 'Monstera', box: [72, 700, 152, 716] }]),
        ],
        confidence: 90,
        language: 'eng',
      },
    );

    // ONE PAGE, NAMED. A writer that ignored the index and took page 0 passes
    // every single-page case above — which is why the fixture has three.
    expect(layerOf(written, 0).kind).toBe('empty');
    expect(layerOf(written, 1).lines[0]?.text).toBe('Monstera');
    expect(layerOf(written, 2).kind).toBe('empty');
  });

  it('refuses a page the document does not have, with the count in the message', async () => {
    const blank = await PDFDocument.create();
    blank.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    await expect(
      applyOcrPage(
        await blank.save(),
        { kind: 'ocrPage', page: 4, language: 'eng' },
        { lines: [], confidence: 0, language: 'eng' },
      ),
    ).rejects.toThrow(/Page 4 is outside this document, which has 1 page/u);
  });

  it('writes nothing for a recognition that found no lines, and does not refuse', async () => {
    const blank = await PDFDocument.create();
    blank.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    // A PAGE TESSERACT READ AS EMPTY IS A PAGE WITH NO TEXT TO ADD, which is an
    // outcome rather than a failure — and the bus has taken its checkpoint either
    // way, so a refusal here would be an undo entry for nothing.
    const written = await applyOcrPage(
      await blank.save(),
      { kind: 'ocrPage', page: 0, language: 'eng' },
      { lines: [], confidence: 0, language: 'eng' },
    );

    expect(layerOf(written).kind).toBe('empty');
  });

  it('captures nothing, and says why undo will cost a checkpoint', async () => {
    const blank = await PDFDocument.create();
    blank.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    const captured = await captureOcrPage(await blank.save(), {
      kind: 'ocrPage',
      page: 0,
      language: 'eng',
    });

    expect(captured.captured).toBe(false);
    // THE REASON TRAVELS INTO THE LOG ENTRY, where a surface can say why. Asserted
    // because a capture answering `{captured: false, reason: ''}` satisfies the
    // line above and explains nothing. `!captured.captured` rather than
    // `=== false` because the lint rule is right about the comparison and the
    // narrowing is what the assertion needs either way.
    expect(!captured.captured && captured.reason).toMatch(/checkpoint for OCR by name/u);
  });

  it('THE APPLICATION’S SEARCH FINDS IT, through the one search there is', async () => {
    const bytes = await written([
      recognised([72, 700, 235, 716], [
        { text: 'Monstera', box: [72, 700, 152, 716] },
        { text: 'deliciosa', box: [158, 700, 235, 716] },
      ]),
    ]);

    // PARSED AND SEARCHED THE WAY `document.searchPage` DOES IT — `parsePageText`
    // then `findInPages` — rather than by looking for the string in the layer this
    // file just wrote. D6 row 4 is *search integration*, and what it asks is
    // whether recognised text reaches the substrate search already reads: a second
    // index over OCR'd words would be the second answer to *what does this page
    // say* that row 3's reader exists to prevent.
    const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
    if (!(document instanceof mupdf.PDFDocument)) throw new Error('the fixture did not parse');
    const stext = document.loadPage(0).toStructuredText(STEXT_OPTION_STRING);
    const page = parsePageText(stext.asJSON());
    stext.destroy();

    const found = findInPages([page], 'deliciosa');
    expect(found.ok).toBe(true);
    const matches = found.ok ? found.value : [];
    expect(matches).toHaveLength(1);
    const match = matches[0];
    if (match === undefined) throw new Error('the length assertion above should have failed first');
    // THE MATCH RESOLVES TO A LINE, which is what the find bar highlights with:
    // `searchHighlight.ts` recomputes its ranges from the text layer's own lines,
    // so a hit that resolves to no line is a search that found a page rather than a
    // place on it.
    expect(match.page).toBe(0);
    expect(lineOf([page], match)?.text).toBe('Monstera deliciosa');
  });

  it('CONTROL: and it does not find a word the page does not carry', async () => {
    const bytes = await written([
      recognised([72, 700, 152, 716], [{ text: 'Monstera', box: [72, 700, 152, 716] }]),
    ]);

    const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
    if (!(document instanceof mupdf.PDFDocument)) throw new Error('the fixture did not parse');
    const stext = document.loadPage(0).toStructuredText(STEXT_OPTION_STRING);
    const page = parsePageText(stext.asJSON());
    stext.destroy();

    // Without this the case above is satisfied by a search that matches anything,
    // which is the direction a layer full of question marks would also pass in.
    const found = findInPages([page], 'deliciosa');
    expect(found.ok && found.value).toStrictEqual([]);
  });

  it('appends to a page that already carries content, leaving its text readable', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawText('printed', {
      x: 72,
      y: 600,
      size: 16,
      font: await document.embedFont(StandardFonts.Helvetica),
    });
    writeRecognisedText(page, glyphlessFont(document), [
      recognised([72, 700, 200, 716], [{ text: 'recognised', box: [72, 700, 200, 716] }]),
    ]);

    const texts = layerOf(await document.save()).lines.map((line) => line.text);
    expect(texts).toContain('printed');
    expect(texts).toContain('recognised');
  });
});
