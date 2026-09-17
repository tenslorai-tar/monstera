import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { ooxmlPackage } from './ooxmlPackage.js';
import {
  type PresentationPage,
  fittedPicture,
  pictureScale,
  presentationParts,
  slideSize,
} from './presentationDocument.js';

/**
 * The PowerPoint writer's parts, unzipped. Whether PowerPoint opens the deck and
 * shows the page is measured against PowerPoint — this row's journal entry
 * records a slide's render differing from the page's raster by a mean 0.04 of
 * 255, against 36.57 for the next page as the control.
 */

const PNG_A = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1);
const PNG_B = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 2);

async function unzipped(pages: PresentationPage[], declared = pages.length): Promise<Record<string, Uint8Array>> {
  async function* source(): AsyncIterable<PresentationPage> {
    for (const page of pages) yield await Promise.resolve(page);
  }
  const chunks: Uint8Array[] = [];
  const first = pages[0]?.size ?? { width: 612, height: 792 };
  for await (const chunk of ooxmlPackage(presentationParts(source(), first, declared))) chunks.push(chunk);
  const total = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    total.set(chunk, at);
    at += chunk.length;
  }
  return unzipSync(total);
}

describe('presentationParts', () => {
  it('a slide per page, each carrying ITS page’s picture byte for byte', async () => {
    const files = await unzipped([
      { png: PNG_A, size: { width: 612, height: 792 } },
      { png: PNG_B, size: { width: 612, height: 792 } },
    ]);

    // The two pictures differ in one byte, so a writer that attached one picture
    // to every slide, or swapped them, fails here.
    expect(files['ppt/media/image1.png']).toStrictEqual(PNG_A);
    expect(files['ppt/media/image2.png']).toStrictEqual(PNG_B);
    expect(strFromU8(files['ppt/slides/_rels/slide2.xml.rels'] ?? new Uint8Array())).toContain('../media/image2.png');
    const presentation = strFromU8(files['ppt/presentation.xml'] ?? new Uint8Array());
    expect(presentation.match(/<p:sldId /gu)).toHaveLength(2);
    // 612 × 12,700 EMU.
    expect(presentation).toContain('<p:sldSz cx="7772400" cy="10058400"/>');
    expect(strFromU8(files['[Content_Types].xml'] ?? new Uint8Array()).match(/slide\d\.xml/gu)).toHaveLength(2);
  });

  it('REFUSES a page count that disagrees with the pages that arrived, in both directions', async () => {
    // The content types and the slide list are written before any picture, so a
    // wrong count is a deck that names slides it lacks — refused, not written.
    const one = [{ png: PNG_A, size: { width: 612, height: 792 } }];
    await expect(unzipped(one, 2)).rejects.toThrow(/declared 2 slide\(s\) and 1 arrived/u);
    await expect(unzipped([...one, ...one], 1)).rejects.toThrow(/a page past them arrived/u);
  });
});

describe('slide sizing', () => {
  it('fits a landscape page into a portrait deck, aspect kept and centred', () => {
    const box = fittedPicture({ width: 792, height: 612 }, { width: 612, height: 792 });
    // Width fills (612 pt), height scales to 472.7 pt, centred vertically.
    expect(box.cx).toBe(612 * 12_700);
    expect(box.cy).toBe(Math.round(612 * (612 / 792) * 12_700));
    expect(box.x).toBe(0);
    expect(box.y).toBe(Math.round(((792 - 612 * (612 / 792)) / 2) * 12_700));
  });

  it('clamps a slide into PowerPoint’s 1–56 inch bounds, shrinking a huge page proportionally', () => {
    expect(slideSize({ width: 8064, height: 4032 })).toStrictEqual({ width: 4032, height: 2016 });
    expect(slideSize({ width: 10, height: 20 })).toStrictEqual({ width: 72, height: 72 });
  });

  it('pictures at 150 dpi, lowered only past the sixteen-megapixel budget, and never below the engine floor', () => {
    expect(pictureScale({ width: 612, height: 792 })).toBeCloseTo(150 / 72);
    const large = pictureScale({ width: 4000, height: 4000 });
    expect(4000 * 4000 * large * large).toBeLessThanOrEqual(16_000_001);
    expect(pictureScale({ width: 20_000, height: 20_000 })).toBe(1);
  });
});
