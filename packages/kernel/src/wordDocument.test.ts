import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { ooxmlPackage, xmlText } from './ooxmlPackage.js';
import type { TextLine } from './textStructure.js';
import { type WordMode, type WordPage, baseFontName, wordDocumentParts } from './wordDocument.js';
import { viewportPoint } from '@monstera/shared';

/**
 * The Word writer's parts, unzipped and read as XML text.
 *
 * What these cases can say is what the package CONTAINS. Whether Word opens it
 * and puts a line where the PDF had it is measured against Word itself — the
 * journal entry for this row records 328 of 383 lines within 1 pt in layout
 * mode, and 8 in the reflowed control.
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

function page(lines: TextLine[][], width = 612, height = 792): WordPage {
  return {
    text: { blocks: lines.map((blockLines) => ({ lines: blockLines, box: blockLines[0]?.box ?? line('', 0, 0).box })), images: 0 },
    size: { width, height },
  };
}

async function documentXml(mode: WordMode, pages: WordPage[]): Promise<{ xml: string; names: string[] }> {
  async function* source(): AsyncIterable<WordPage> {
    for (const each of pages) yield await Promise.resolve(each);
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of ooxmlPackage(wordDocumentParts(mode, source()))) chunks.push(chunk);
  const total = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    total.set(chunk, at);
    at += chunk.length;
  }
  const files = unzipSync(total);
  const xml = files['word/document.xml'];
  if (xml === undefined) throw new Error('the package has no word/document.xml');
  return { xml: strFromU8(xml), names: Object.keys(files).sort() };
}

const TWO_PAGES = [
  page([[line('Heading', 72, 72, { bold: true })], [line('first half of', 72, 100), line('a wrapped sentence', 72, 114, { italic: true })]]),
  page([[line('Page two', 300, 400)]], 792, 612),
];

describe('wordDocumentParts', () => {
  it('writes the three parts Word needs, and nothing it does not', async () => {
    const { names } = await documentXml('text', TWO_PAGES);
    expect(names).toStrictEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
  });

  it('TEXT mode: a paragraph per block, lines joined by a space, a page break between pages, no formatting', async () => {
    const { xml } = await documentXml('text', TWO_PAGES);

    expect(xml).toContain('<w:t xml:space="preserve">first half of</w:t></w:r><w:r><w:t xml:space="preserve"> a wrapped sentence</w:t>');
    expect(xml.match(/<w:br w:type="page"\/>/gu)).toHaveLength(1);
    // Plain words: no run properties at all.
    expect(xml).not.toContain('<w:rPr>');
    expect(xml).not.toContain('<w:framePr');
  });

  it('RICH mode: the same flow, each run carrying its base font, size, bold and italic', async () => {
    const { xml } = await documentXml('rich', TWO_PAGES);

    // The subset tag and the style suffix are gone; bold and italic come from
    // MuPDF's classification, on the lines that carry them and only those.
    expect(xml).toContain('w:ascii="Helvetica"');
    expect(xml.match(/<w:b\/>/gu)).toHaveLength(1);
    expect(xml.match(/<w:i\/>/gu)).toHaveLength(1);
    expect(xml).toContain('<w:sz w:val="22"/>');
    expect(xml).not.toContain('<w:framePr');
  });

  it('LAYOUT mode: every line a frame at its own box in twips, and every page its own section at its size', async () => {
    const { xml } = await documentXml('layout', TWO_PAGES);

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
    const { xml } = await documentXml('text', []);
    expect(xml).toContain('<w:body><w:sectPr>');
    expect(xml.endsWith('</w:body></w:document>')).toBe(true);
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
