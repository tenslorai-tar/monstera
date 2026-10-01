import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { ooxmlPackage, xmlText } from './ooxmlPackage.js';
import type { PagePicture, TextLine } from './textStructure.js';
import { type WordMode, type WordPage, type WordPictureDrawer, baseFontName, wordDocumentParts } from './wordDocument.js';
import { viewportPoint } from '@monstera/shared';

/**
 * The Word writer's parts, unzipped and read as XML text.
 *
 * What these cases can say is what the package CONTAINS. Whether Word opens it
 * and puts a line where the PDF had it is measured against Word itself — the
 * journal entry for this row records 328 of 383 lines within 1 pt in layout
 * mode, and 8 in the reflowed control — and the pictures are read back by a
 * reader that is not this module's in `proof:wordpictures`.
 */

function line(text: string, x: number, y: number, font: Partial<TextLine['font']> = {}): TextLine {
  return {
    text,
    box: { topLeft: viewportPoint(x, y), bottomRight: viewportPoint(x + 100, y + 12) },
    origin: viewportPoint(x, y + 10),
    size: 11,
    font: { name: 'ABCDEF+Helvetica-Bold', family: 'sans-serif', bold: false, italic: false, ...font },
  };
}

function page(
  index: number,
  lines: TextLine[][],
  { width = 612, height = 792, pictures = [] }: { width?: number; height?: number; pictures?: PagePicture[] } = {},
): WordPage {
  return {
    index,
    text: {
      blocks: lines.map((blockLines) => ({ lines: blockLines, box: blockLines[0]?.box ?? line('', 0, 0).box })),
      images: pictures.length,
    },
    size: { width, height },
    pictures,
  };
}

function picture(after: number, x: number, y: number, w: number, h: number): PagePicture {
  return { after, printed: { x, y, w, h } };
}

/** A drawer that records each call and answers one distinct fake PNG per place: `png<page>.<n>`. */
function recordingDrawer(): { draw: WordPictureDrawer; calls: { page: number; count: number }[] } {
  const calls: { page: number; count: number }[] = [];
  const draw: WordPictureDrawer = (pageIndex, pictures) => {
    calls.push({ page: pageIndex, count: pictures.length });
    return Promise.resolve(pictures.map((_, n) => new TextEncoder().encode(`png${String(pageIndex)}.${String(n)}`)));
  };
  return { draw, calls };
}

async function unpacked(
  mode: WordMode,
  pages: WordPage[],
  draw: WordPictureDrawer = recordingDrawer().draw,
): Promise<{ xml: string; names: string[]; files: Record<string, Uint8Array> }> {
  async function* source(): AsyncIterable<WordPage> {
    for (const each of pages) yield await Promise.resolve(each);
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of ooxmlPackage(wordDocumentParts(mode, source(), draw))) chunks.push(chunk);
  const total = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    total.set(chunk, at);
    at += chunk.length;
  }
  const files = unzipSync(total);
  const xml = files['word/document.xml'];
  if (xml === undefined) throw new Error('the package has no word/document.xml');
  return { xml: strFromU8(xml), names: Object.keys(files).sort(), files };
}

const TWO_PAGES = [
  page(0, [[line('Heading', 72, 72, { bold: true })], [line('first half of', 72, 100), line('a wrapped sentence', 72, 114, { italic: true })]]),
  page(1, [[line('Page two', 300, 400)]], { width: 792, height: 612 }),
];

/** Page one: a picture between its two blocks and one after the last; page two: one before its only block. */
const PICTURED = [
  page(0, [[line('Above', 72, 72)], [line('Below', 72, 300)]], {
    pictures: [picture(1, 50, 132, 200, 100), picture(2, 300, 400, 20, 10)],
  }),
  page(1, [[line('Second page', 72, 300)]], { pictures: [picture(0, 72, 72, 100, 50)] }),
];

describe('wordDocumentParts', () => {
  it('writes the parts Word needs, and nothing it does not', async () => {
    const { names } = await unpacked('text', TWO_PAGES);
    expect(names).toStrictEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/document.xml',
    ]);
  });

  it('TEXT mode: a paragraph per block, lines joined by a space, a page break between pages, no formatting', async () => {
    const { xml } = await unpacked('text', TWO_PAGES);

    expect(xml).toContain('<w:t xml:space="preserve">first half of</w:t></w:r><w:r><w:t xml:space="preserve"> a wrapped sentence</w:t>');
    expect(xml.match(/<w:br w:type="page"\/>/gu)).toHaveLength(1);
    // Plain words: no run properties at all.
    expect(xml).not.toContain('<w:rPr>');
    expect(xml).not.toContain('<w:framePr');
  });

  it('RICH mode: the same flow, each run carrying its base font, size, bold and italic', async () => {
    const { xml } = await unpacked('rich', TWO_PAGES);

    // The subset tag and the style suffix are gone; bold and italic come from
    // MuPDF's classification, on the lines that carry them and only those.
    expect(xml).toContain('w:ascii="Helvetica"');
    expect(xml.match(/<w:b\/>/gu)).toHaveLength(1);
    expect(xml.match(/<w:i\/>/gu)).toHaveLength(1);
    expect(xml).toContain('<w:sz w:val="22"/>');
    expect(xml).not.toContain('<w:framePr');
  });

  it('LAYOUT mode: every line a frame at its own box in twips, and every page its own section at its size', async () => {
    const { xml } = await unpacked('layout', TWO_PAGES);

    expect(xml.match(/<w:framePr /gu)).toHaveLength(4);
    // 72 pt is 1440 twips, and 400 pt is 8000 — the box, unflipped: the substrate
    // is y-down from the page top, which is Word's page frame.
    expect(xml).toContain('w:x="1440" w:y="1440"');
    expect(xml).toContain('w:x="6000" w:y="8000"');
    // One section per page, the second at its own (turned) size.
    expect(xml.match(/<w:sectPr>/gu)).toHaveLength(2);
    expect(xml).toContain('<w:pgSz w:w="12240" w:h="15840"/>');
    expect(xml).toContain('<w:pgSz w:w="15840" w:h="12240"/>');
    expect(xml).not.toContain('<w:br w:type="page"/>');
  });

  it('an EMPTY document is still a package with a body and a section', async () => {
    const { xml } = await unpacked('text', []);
    expect(xml).toContain('<w:body><w:sectPr>');
    expect(xml.endsWith('</w:body></w:document>')).toBe(true);
  });
});

describe('wordDocumentParts — pictures', () => {
  it('RICH: each picture inline, as its own paragraph, WHERE THE READING ORDER PUTS IT', async () => {
    const { xml } = await unpacked('rich', PICTURED);

    const above = xml.indexOf('>Above<');
    const first = xml.indexOf('r:embed="rIdImage1"');
    const below = xml.indexOf('>Below<');
    const second = xml.indexOf('r:embed="rIdImage2"');
    const third = xml.indexOf('r:embed="rIdImage3"');
    const secondPage = xml.indexOf('>Second page<');
    // Page one: Above, picture 1, Below, picture 2 (after the last block). Page two: picture 3, then its text.
    expect([above, first, below, second, third, secondPage].every((at) => at >= 0)).toBe(true);
    expect(above < first && first < below && below < second && second < third && third < secondPage).toBe(true);
    // Inline, at its own size: 200 × 100 pt is 2,540,000 × 1,270,000 EMU.
    expect(xml).toContain('<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="2540000" cy="1270000"/>');
    expect(xml).not.toContain('<wp:anchor');
  });

  it('RICH: a picture WIDER THAN THE TEXT AREA is shrunk to it, keeping its proportions', async () => {
    // Letter less two inches is 468 pt wide; a 936 × 100 picture fits at 468 × 50.
    const wide = [page(0, [[line('Text', 72, 72)]], { pictures: [picture(1, 0, 100, 936, 100)] })];
    const { xml } = await unpacked('rich', wide);
    expect(xml).toContain(`<wp:extent cx="${String(468 * 12_700)}" cy="${String(50 * 12_700)}"/>`);
  });

  it('LAYOUT: each picture anchored to the page AT ITS BOX, behind the text, in the paragraph that ends the section', async () => {
    const { xml } = await unpacked('layout', PICTURED);

    expect(xml.match(/<wp:anchor /gu)).toHaveLength(3);
    expect(xml).not.toContain('<wp:inline');
    // 50 pt across and 132 down: 635,000 and 1,676,400 EMU from the page's corner.
    expect(xml).toContain(
      '<wp:positionH relativeFrom="page"><wp:posOffset>635000</wp:posOffset></wp:positionH>' +
        '<wp:positionV relativeFrom="page"><wp:posOffset>1676400</wp:posOffset></wp:positionV>' +
        '<wp:extent cx="2540000" cy="1270000"/>',
    );
    expect(xml).toContain('behindDoc="1"');
    // Page one's two anchors sit in the paragraph carrying its section, so they add no line to the page.
    expect(xml).toMatch(/<w:p><w:pPr><w:sectPr>(?:(?!<\/w:p>).)*<\/w:sectPr><\/w:pPr><w:r><w:drawing><wp:anchor /u);
    expect(xml.match(/<w:sectPr>/gu)).toHaveLength(2);
  });

  it('the package carries each drawn picture as its own part, named by the relationship that points at it', async () => {
    const { names, files } = await unpacked('rich', PICTURED);

    expect(names.filter((name) => name.startsWith('word/media/'))).toStrictEqual([
      'word/media/image1.png',
      'word/media/image2.png',
      'word/media/image3.png',
    ]);
    // The drawer's bytes, in order across pages: page 0's two, then page 1's one.
    expect(strFromU8(files['word/media/image1.png'] ?? new Uint8Array())).toBe('png0.0');
    expect(strFromU8(files['word/media/image2.png'] ?? new Uint8Array())).toBe('png0.1');
    expect(strFromU8(files['word/media/image3.png'] ?? new Uint8Array())).toBe('png1.0');
    const relationships = strFromU8(files['word/_rels/document.xml.rels'] ?? new Uint8Array());
    expect(relationships).toContain('Id="rIdImage3"');
    expect(relationships).toContain('Target="media/image3.png"');
    expect(strFromU8(files['[Content_Types].xml'] ?? new Uint8Array())).toContain('<Default Extension="png" ContentType="image/png"/>');
  });

  it('each page is drawn ONCE, with its own index and its own places, after the text', async () => {
    const recording = recordingDrawer();
    await unpacked('layout', PICTURED, recording.draw);
    expect(recording.calls).toStrictEqual([
      { page: 0, count: 2 },
      { page: 1, count: 1 },
    ]);
  });

  it('TEXT mode carries NO picture — and never asks for one to be drawn', async () => {
    const recording = recordingDrawer();
    const { xml, names } = await unpacked('text', PICTURED, recording.draw);

    // The call not made is the decision; a package with no picture in it is also what a drawer that failed silently
    // would leave behind.
    expect(recording.calls).toStrictEqual([]);
    expect(xml).not.toContain('<w:drawing>');
    expect(names.some((name) => name.startsWith('word/media/'))).toBe(false);
  });

  it('CONTROL for the case above: the same pages in rich mode DO ask, so the text mode is what declined', async () => {
    const recording = recordingDrawer();
    await unpacked('rich', PICTURED, recording.draw);
    expect(recording.calls.length).toBe(2);
  });

  it('a drawer that answers FEWER pictures than were placed is refused, never a package naming a missing picture', async () => {
    const short: WordPictureDrawer = (_page, pictures) => Promise.resolve(pictures.slice(1).map(() => new Uint8Array([1])));
    await expect(unpacked('rich', PICTURED, short)).rejects.toThrow(/placed 2 picture\(s\) and 1 were drawn/u);
  });
});

describe('xmlText', () => {
  it('escapes markup and REPLACES what XML 1.0 cannot carry, keeping tab and newline', () => {
    const bell = String.fromCodePoint(7);
    const nul = String.fromCodePoint(0);
    expect(xmlText(`a & <b> "c"\td\n${bell}${nul}é日`)).toBe(
      `a &amp; &lt;b&gt; &quot;c&quot;\td\n${String.fromCodePoint(0xfffd)}${String.fromCodePoint(0xfffd)}é日`,
    );
  });
});

describe('baseFontName', () => {
  it('drops a subset tag and a style suffix, and falls back when nothing is left', () => {
    expect(baseFontName('ABCDEF+Times-BoldItalic')).toBe('Times');
    expect(baseFontName('Arial')).toBe('Arial');
    expect(baseFontName('')).toBe('Calibri');
  });
});
