import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { type CommandOfKind, type EditedBlock, blockEditOf } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { runsOfContent as runsOf } from './contentRunsFixture.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { pageContentStreams } from './pageContent.js';
import { rasterisePageRgba } from './pageImages.js';
import { applyEditTextOperators } from './textOperatorEdit.js';
import { joinedContent } from './textOperators.js';

/**
 * A scan's recognised words edited through the operator writer (ADR-0181 Decision 9, ADR-0187, and ADR-0271's correction
 * of 2026-10-26, the fourth writer change): the line the edit sets is drawn visible WHOLE, over a cover of the paper
 * that is there under that line's old ink; the picture is not changed, and a line the edit did not reach stays invisible
 * over its own ink. Until this change the operator writer wrote the new words in the recognised layer's render mode 3,
 * so they drew nothing and the picture went on showing the old ones: the first two cases are red on that code.
 *
 * The page is a grey picture with a dark bar wherever a recognised word's box is (`runsOfContent`'s box, which the
 * writer is handed as PDFium's ink), and the two lines of recognised words over it, invisible.
 */

const PAPER = 225;
const INK = 40;
const WIDTH = 300;
const HEIGHT = 200;
const LINES = [
  { text: 'Minutes of the meeting', baseline: 150 },
  { text: 'held in the church hall', baseline: 130 },
] as const;
const SIZE = 12;
const LEFT = 40;

/** A line's box as `runsOfContent` gives it, which the picture's ink bar is painted at. */
function boxOf(line: (typeof LINES)[number]): { left: number; right: number; bottom: number; top: number } {
  return { left: LEFT, right: LEFT + 0.5 * SIZE * line.text.length, bottom: line.baseline - 0.2 * SIZE, top: line.baseline + 0.8 * SIZE };
}

const TEXT = LINES.map((line) => `BT 3 Tr /F1 ${String(SIZE)} Tf 1 0 0 1 ${String(LEFT)} ${String(line.baseline)} Tm (${line.text}) Tj ET`).join('\n');
/** The scan: the picture first, the recognised words after it. */
const SCANNED = `q ${String(WIDTH)} 0 0 ${String(HEIGHT)} 0 0 cm /Im1 Do Q\n${TEXT}`;

async function fixture(content: string): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([WIDTH, HEIGHT]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const context = document.context;
  // ONE PIXEL A POINT, row 0 at the top: paper, with the ink of each line's words where its box is.
  const pixels = new Uint8Array(WIDTH * HEIGHT).fill(PAPER);
  for (const line of LINES) {
    const box = boxOf(line);
    for (let y = Math.round(HEIGHT - box.top + 2); y < Math.round(HEIGHT - box.bottom - 1); y += 1) {
      for (let x = Math.round(box.left); x < Math.round(box.right); x += 1) pixels[y * WIDTH + x] = INK;
    }
  }
  const picture = context.register(
    context.stream(pixels, { Type: 'XObject', Subtype: 'Image', Width: WIDTH, Height: HEIGHT, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }),
  );
  page.node.set(PDFName.of('Resources'), context.obj({ Font: { F1: font.ref }, XObject: { Im1: picture } }));
  page.node.set(PDFName.of('Contents'), context.register(context.stream(content)));
  return document.save({ useObjectStreams: false });
}

/** The second line edited to `text`, through the writer's apply; the page's content after, and its drawing at a pixel a point. */
async function edited(content: string, text: string): Promise<{ readonly written: string; readonly grey: (x: number, y: number) => number }> {
  const session = await mupdfWriter.open(await fixture(content));
  try {
    const before = await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0))));
    const block: EditedBlock = { lines: [[1]], soft: [false], text };
    const command: CommandOfKind<'editTextOperators'> = { kind: 'editTextOperators', page: 0, ...blockEditOf([block]), fit: 'reflow', version: asDocVersion(1) };
    await applyEditTextOperators(session, command, runsOf(before));
    const written = await withDocument(session, (document) => new TextDecoder('latin1').decode(joinedContent(pageContentStreams(document.findPage(0)))));
    const image = await rasterisePageRgba(session, 0, 1);
    // THE GREEN CHANNEL at a point of the page, y up: the page is grey, so one channel is its shade.
    const grey = (x: number, y: number): number => image.rgba[(Math.round(HEIGHT - y) * image.width + Math.round(x)) * 4 + 1] ?? -1;
    return { written, grey };
  } finally {
    await mupdfWriter.close(session);
  }
}

/** The shades drawn across a box of the page, each once. */
function shades(grey: (x: number, y: number) => number, box: { left: number; right: number; bottom: number; top: number }): number[] {
  const found = new Set<number>();
  for (let y = Math.ceil(box.bottom); y <= Math.floor(box.top); y += 1) for (let x = Math.ceil(box.left); x <= Math.floor(box.right); x += 1) found.add(grey(x, y));
  return [...found];
}

describe('a scan’s recognised line, edited through the operator writer (ADR-0271’s correction of 2026-10-26)', () => {
  const [first, second] = LINES;
  const oldLine = boxOf(second);
  // THE OLD LINE'S INK PAST WHERE THE SHORTER NEW LINE ENDS: only the cover can change it. Its middle band, clear of the
  // ink bar's soft edge.
  const pastTheWords = { left: oldLine.left + 0.5 * SIZE * 'held in the hall'.length + 8, right: oldLine.right - 2, bottom: second.baseline + 1, top: second.baseline + 6 };

  it('covers the old line’s ink with the paper there, where no new word is drawn', async () => {
    const { grey } = await edited(SCANNED, 'held in the hall');
    // THE PAPER, to the grain of a cover's rounding, and no ink left under it.
    expect(Math.max(...shades(grey, pastTheWords).map((shade) => Math.abs(shade - PAPER)))).toBeLessThanOrEqual(2);
  });

  it('draws the edited line VISIBLE, the words it kept as well as the new one, over the cover', async () => {
    const { written, grey } = await edited(SCANNED, 'held in the hall');
    expect(written).toMatch(/\b0 Tr\b/u);
    // UNDER THE NEW WORDS both are there: the paper the cover laid, and the words' own black on it.
    const under = shades(grey, { left: oldLine.left + 1, right: oldLine.left + 40, bottom: second.baseline + 1, top: second.baseline + 6 });
    expect(under.some((shade) => Math.abs(shade - PAPER) <= 2)).toBe(true);
    expect(under.some((shade) => shade < 100)).toBe(true);
  });

  it('leaves the line it did not reach invisible over its own ink, and the picture itself unchanged', async () => {
    const { written, grey } = await edited(SCANNED, 'held in the hall');
    const kept = boxOf(first);
    // THE INK BAR, every pixel of its middle as the scan drew it: no cover and no drawn word over it.
    expect(shades(grey, { left: kept.left + 2, right: kept.right - 2, bottom: first.baseline + 1, top: first.baseline + 6 })).toStrictEqual([INK]);
    expect(written).toContain(`BT 3 Tr /F1 12 Tf 1 0 0 1 40 150 Tm (${first.text}) Tj ET`);
    expect(written).toContain('/Im1 Do');
  });

  it('CONTROL: invisible words over NO picture are not a scan, and stay invisible with nothing covered (ADR-0179)', async () => {
    const { written } = await edited(TEXT, 'held in the hall');
    expect(written).not.toMatch(/\b0 Tr\b/u);
    expect(written).not.toMatch(/\bre f\b/u);
  });
});
