import { type OoxmlPart, XML_DECLARATION, xmlText } from './ooxmlPackage.js';
import type { PageSize } from './pageGeometry.js';
import type { PageText, TextLine } from './textStructure.js';

/**
 * A PDF as a Word document — D10's *Word (rich / layout / text)*, written by this
 * build ([ADR-0072](../../../docs/DECISIONS/0072-office-open-xml-exports-are-written-by-this-build-over-fflate.md)).
 *
 * ## Three modes, one reading
 *
 * Every mode reads the same thing — MuPDF's structured text through the one
 * substrate, a page at a time — and differs only in what it writes:
 *
 * - **text**: one paragraph per MuPDF block, its lines joined by a space, so Word
 *   reflows it; a page break between pages. Nothing but the words.
 * - **layout**: each page its own section at its displayed size with no margins,
 *   and each line a frame anchored to the page at the line's own box, so the page
 *   looks as it did and nothing reflows.
 * - **rich**: text mode's flow, with each line a run carrying its font — the
 *   base family name, size, bold and italic as MuPDF classified them.
 *
 * **Images are not carried in any mode**, and the row says so: the substrate
 * reports how many a page has and not their pixels (ADR-0035's argument, applied
 * to rasters), and placing them is a read this build does not make yet.
 *
 * ## Units
 *
 * PDF points in, Word's units out: twentieths of a point (twips) for positions
 * and page sizes, half-points for font sizes. The substrate's boxes are in
 * displayed space, y down from the page top, which is Word's page frame — so no
 * flip is made, and none is needed.
 */
export type WordMode = 'text' | 'layout' | 'rich';

export const WORD_MODES: readonly WordMode[] = ['text', 'layout', 'rich'];

/** One page as the export reads it: its structured text and displayed size. */
export interface WordPage {
  readonly text: PageText;
  readonly size: PageSize;
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const CONTENT_TYPES =
  `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const PACKAGE_RELATIONSHIPS =
  `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

/** Points to twips, rounded: Word's measures are integers. */
function twips(points: number): number {
  return Math.max(0, Math.round(points * 20));
}

/** Points to Word's half-points, at least 1, since `w:sz` of 0 is not a size. */
function halfPoints(points: number): number {
  return Math.max(1, Math.round(points * 2));
}

/**
 * A font's base family name: the subset tag and the style suffix dropped.
 *
 * `ABCDEF+Helvetica-BoldOblique` is a subset of Helvetica, and Word has no font
 * by that name; bold and italic arrive separately from MuPDF's classification,
 * so the suffix would only prevent the substitution Word makes for a family.
 */
export function baseFontName(name: string): string {
  const unsubset = name.replace(/^[A-Z]{6}\+/u, '');
  const hyphen = unsubset.indexOf('-');
  const base = hyphen > 0 ? unsubset.slice(0, hyphen) : unsubset;
  return base.length > 0 ? base : 'Calibri';
}

function run(text: string, line: TextLine | null): string {
  const properties =
    line === null
      ? ''
      : '<w:rPr>' +
        `<w:rFonts w:ascii="${xmlText(baseFontName(line.font.name))}" w:hAnsi="${xmlText(baseFontName(line.font.name))}" w:cs="${xmlText(baseFontName(line.font.name))}"/>` +
        (line.font.bold ? '<w:b/>' : '') +
        (line.font.italic ? '<w:i/>' : '') +
        `<w:sz w:val="${String(halfPoints(line.size))}"/>` +
        '</w:rPr>';
  return `<w:r>${properties}<w:t xml:space="preserve">${xmlText(text)}</w:t></w:r>`;
}

function sectionProperties(size: PageSize, margins: boolean): string {
  const margin = margins ? 1440 : 0;
  return (
    `<w:sectPr><w:pgSz w:w="${String(twips(size.width))}" w:h="${String(twips(size.height))}"/>` +
    `<w:pgMar w:top="${String(margin)}" w:right="${String(margin)}" w:bottom="${String(margin)}" w:left="${String(margin)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`
  );
}

const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

function flowPage(page: WordPage, rich: boolean): string {
  return page.text.blocks
    .map((block) => {
      const runs = block.lines
        .map((line, index) => run(index === 0 ? line.text : ` ${line.text}`, rich ? line : null))
        .join('');
      return `<w:p>${runs}</w:p>`;
    })
    .join('');
}

/**
 * One line as a frame on its page, at its own box.
 *
 * **The frame is wider than the box**, by a quarter of the line's height at each
 * end: Word lays the run out with its own font metrics, and a frame exactly the
 * PDF's width wraps the last word onto a second line whenever the substitute
 * font is a hair wider — which moves every line below it.
 */
function framedLine(line: TextLine): string {
  const width = line.box.bottomRight.x - line.box.topLeft.x;
  const height = Math.max(1, line.box.bottomRight.y - line.box.topLeft.y);
  const slack = height / 2;
  return (
    '<w:p><w:pPr>' +
    `<w:framePr w:w="${String(twips(width + slack))}" w:h="${String(twips(height))}" w:hRule="atLeast" ` +
    `w:x="${String(twips(line.box.topLeft.x))}" w:y="${String(twips(line.box.topLeft.y))}" ` +
    'w:hAnchor="page" w:vAnchor="page" w:wrap="notBeside"/>' +
    '<w:spacing w:before="0" w:after="0"/>' +
    `</w:pPr>${run(line.text, line)}</w:p>`
  );
}

function layoutPage(page: WordPage, last: boolean): string {
  const lines = page.text.blocks.flatMap((block) => block.lines).map(framedLine).join('');
  // A NON-FINAL SECTION ENDS in a paragraph carrying its properties; the last
  // section's properties are the body's own, written after the loop.
  return last ? lines : `${lines}<w:p><w:pPr>${sectionProperties(page.size, false)}</w:pPr></w:p>`;
}

/**
 * The package's parts for `pages`, `document.xml` streamed a page at a time.
 *
 * `pages` is consumed exactly once, in order, as the zip pulls — so a caller
 * reading each page from the engine as it is asked for holds one page at a time.
 */
export function wordDocumentParts(mode: WordMode, pages: AsyncIterable<WordPage>): readonly OoxmlPart[] {
  return [
    { name: '[Content_Types].xml', chunks: [CONTENT_TYPES] },
    { name: '_rels/.rels', chunks: [PACKAGE_RELATIONSHIPS] },
    { name: 'word/document.xml', chunks: documentXml(mode, pages) },
  ];
}

async function* documentXml(mode: WordMode, pages: AsyncIterable<WordPage>): AsyncIterable<string> {
  yield `${XML_DECLARATION}<w:document xmlns:w="${W}"><w:body>`;
  let previous: WordPage | null = null;
  let first: PageSize | null = null;
  for await (const page of pages) {
    first ??= page.size;
    if (previous !== null) {
      // The page before this one is now known not to be the last.
      yield mode === 'layout' ? layoutPage(previous, false) : `${flowPage(previous, mode === 'rich')}${PAGE_BREAK}`;
    }
    previous = page;
  }
  if (previous !== null) {
    yield mode === 'layout' ? layoutPage(previous, true) : flowPage(previous, mode === 'rich');
  }
  // THE BODY'S SECTION: the last page's size in layout mode, where every section is
  // one page; the first page's in the flow modes, with ordinary margins, and Letter
  // for an empty document so the package is still one Word opens.
  const size = mode === 'layout' ? (previous?.size ?? LETTER) : (first ?? LETTER);
  yield `${sectionProperties(size, mode !== 'layout')}</w:body></w:document>`;
}

const LETTER: PageSize = { width: 612, height: 792 };
