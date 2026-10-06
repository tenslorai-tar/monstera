import type { WordMode } from '@monstera/contract/host';

import { type OoxmlPart, XML_DECLARATION, xmlText } from './ooxmlPackage.js';
import type { PageSize } from './pageGeometry.js';
import { withoutSubsetTag } from './subsetName.js';
import type { PagePicture, PageText, TextLine } from './textStructure.js';

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
 *   reflows it; a page break between pages. Nothing but the words — no pictures.
 * - **layout**: each page its own section at its displayed size with no margins,
 *   each line a frame anchored to the page at the line's own box, and each picture
 *   anchored to the page at its box behind the text, so the page looks as it did
 *   and nothing reflows.
 * - **rich**: text mode's flow, with each line a run carrying its font — the
 *   base family name, size, bold and italic as MuPDF classified them — and each
 *   picture inline, as its own paragraph, where the reading order puts it.
 *
 * ## Pictures: placed in one pass, drawn in a second
 *
 * The page's reading supplies each picture's place and box and nothing of its
 * pixels (ADR-0072's amendment of 2026-10-01). So `document.xml` is written first,
 * holding one page, and records every picture it placed; the pictures are drawn
 * afterwards, one page at a time, and each is its own part of the package. Zip
 * order means nothing to Word, and this order means no picture is held while the
 * text is written.
 *
 * ## Units
 *
 * PDF points in, Word's units out: twentieths of a point (twips) for positions
 * and page sizes, half-points for font sizes, English Metric Units (12,700 to the
 * point) for pictures. The substrate's boxes are in displayed space, y down from
 * the page top, which is Word's page frame — so no flip is made, and none is
 * needed.
 */
export type { WordMode };

/** One page as the export reads it: its structured text, displayed size and pictures' places. */
export interface WordPage {
  /** Its zero-based index, which the second pass hands back to the drawer. */
  readonly index: number;
  readonly text: PageText;
  readonly size: PageSize;
  readonly pictures: readonly PagePicture[];
}

/**
 * Draws one page's pictures as PNG, one per place and in the order given.
 *
 * An answer of a different length is refused where it is used: a package that
 * names a picture with nothing behind it is a file Word reports as damaged.
 */
export type WordPictureDrawer = (page: number, pictures: readonly PagePicture[]) => Promise<readonly Uint8Array[]>;

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const IMAGE_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

const CONTENT_TYPES =
  `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Default Extension="png" ContentType="image/png"/>' +
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

/** Points to English Metric Units, at least 1: DrawingML's extents are positive integers. */
function emu(points: number): number {
  return Math.max(1, Math.round(points * 12_700));
}

/** A rich page's margin, in points: 1,440 twips, Word's ordinary inch. */
const FLOW_MARGIN = 72;

/**
 * A font's base family name: the subset tag and the style suffix dropped.
 *
 * `ABCDEF+Helvetica-BoldOblique` is a subset of Helvetica, and Word has no font
 * by that name; bold and italic arrive separately from MuPDF's classification,
 * so the suffix would only prevent the substitution Word makes for a family.
 */
export function baseFontName(name: string): string {
  const unsubset = withoutSubsetTag(name);
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
  const margin = margins ? twips(FLOW_MARGIN) : 0;
  return (
    `<w:sectPr><w:pgSz w:w="${String(twips(size.width))}" w:h="${String(twips(size.height))}"/>` +
    `<w:pgMar w:top="${String(margin)}" w:right="${String(margin)}" w:bottom="${String(margin)}" w:left="${String(margin)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`
  );
}

const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/** A picture the document names: its number in the package, and the size it is shown at. */
interface Placed {
  readonly number: number;
  readonly width: number;
  readonly height: number;
}

/** The DrawingML picture both placements share. `number` names the part, the relationship and the shape. */
function graphic(placed: Placed): string {
  const name = `image${String(placed.number)}.png`;
  return (
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}">` +
    `<pic:nvPicPr><pic:cNvPr id="${String(placed.number)}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relationshipId(placed.number)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${String(emu(placed.width))}" cy="${String(emu(placed.height))}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic>'
  );
}

function relationshipId(number: number): string {
  return `rIdImage${String(number)}`;
}

function docPr(number: number): string {
  return `<wp:docPr id="${String(number)}" name="Picture ${String(number)}"/>`;
}

/** A rich page's picture: its own paragraph, inline, at its size or shrunk to fit the text area. */
function inlinePicture(placed: Placed): string {
  return (
    '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${String(emu(placed.width))}" cy="${String(emu(placed.height))}"/>` +
    docPr(placed.number) +
    graphic(placed) +
    '</wp:inline></w:drawing></w:r></w:p>'
  );
}

/**
 * A layout page's picture: anchored to the page at its box, behind the text.
 *
 * **A run, not a paragraph**: every anchor on a page goes into the paragraph that
 * already ends the page's section, so a page of forty pictures adds no line to the
 * flow — forty paragraphs would push the section onto a second page.
 */
function anchoredPicture(placed: Placed, picture: PagePicture): string {
  return (
    '<w:r><w:drawing>' +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${String(placed.number)}" ` +
    'behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${String(Math.round(picture.printed.x * 12_700))}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${String(Math.round(picture.printed.y * 12_700))}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${String(emu(placed.width))}" cy="${String(emu(placed.height))}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    docPr(placed.number) +
    graphic(placed) +
    '</wp:anchor></w:drawing></w:r>'
  );
}

/**
 * A picture's size in a rich page's text area: its own, or shrunk to fit, keeping its proportions.
 *
 * Word does not shrink an inline picture that is wider than the column; it runs off
 * the page.
 */
function fitted(picture: PagePicture, area: PageSize): { readonly width: number; readonly height: number } {
  const width = Math.max(1, picture.printed.w);
  const height = Math.max(1, picture.printed.h);
  const scale = Math.min(1, area.width / width, area.height / height);
  return { width: width * scale, height: height * scale };
}

/** What the first pass records for the second: which page, which pictures, and the first one's number. */
interface PlacedPage {
  readonly index: number;
  readonly pictures: readonly PagePicture[];
  readonly first: number;
}

/** Numbers pictures across the document and records each page's for the drawing pass. */
class Pictures {
  readonly pages: PlacedPage[] = [];
  #next = 1;

  /** Numbers `page`'s pictures and returns the first number. */
  take(page: WordPage): number {
    const first = this.#next;
    if (page.pictures.length > 0) {
      this.pages.push({ index: page.index, pictures: page.pictures, first });
      this.#next += page.pictures.length;
    }
    return first;
  }
}

function flowPage(page: WordPage, rich: boolean, area: PageSize, pictures: Pictures): string {
  const first = rich ? pictures.take(page) : 0;
  const placedBefore = (at: number): string =>
    rich
      ? page.pictures
          .map((picture, index) => ({ picture, index }))
          .filter(({ picture }) => picture.after === at)
          .map(({ picture, index }) => inlinePicture({ number: first + index, ...fitted(picture, area) }))
          .join('')
      : '';

  const blocks = page.text.blocks.map((block, at) => {
    const runs = block.lines
      .map((line, index) => run(index === 0 ? line.text : ` ${line.text}`, rich ? line : null))
      .join('');
    return `${placedBefore(at)}<w:p>${runs}</w:p>`;
  });
  // A PICTURE AFTER THE LAST BLOCK has `after` equal to the block count, which no
  // block's index reaches.
  return `${blocks.join('')}${placedBefore(page.text.blocks.length)}`;
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

function layoutPage(page: WordPage, last: boolean, pictures: Pictures): string {
  const lines = page.text.blocks.flatMap((block) => block.lines).map(framedLine).join('');
  const first = pictures.take(page);
  const anchors = page.pictures
    .map((picture, index) =>
      anchoredPicture({ number: first + index, width: picture.printed.w, height: picture.printed.h }, picture),
    )
    .join('');
  // A NON-FINAL SECTION ENDS in a paragraph carrying its properties; the last
  // section's properties are the body's own, written after the loop — so the last
  // page's anchors need a paragraph of their own, and only when there are any.
  if (!last) return `${lines}<w:p><w:pPr>${sectionProperties(page.size, false)}</w:pPr>${anchors}</w:p>`;
  return anchors.length > 0 ? `${lines}<w:p>${anchors}</w:p>` : lines;
}

/**
 * The package's parts: `document.xml` streamed a page at a time, then its
 * relationships, then each picture — drawn a page at a time, after the text.
 *
 * `pages` is consumed exactly once, in order, as the zip pulls — so a caller
 * reading each page from the engine as it is asked for holds one page at a time.
 * The parts are yielded as the zip asks for them, which is what lets the
 * relationships and the pictures follow a `document.xml` that has finished.
 *
 * @param draw the second pass. Never called in text mode, which places no picture.
 */
export async function* wordDocumentParts(
  mode: WordMode,
  pages: AsyncIterable<WordPage>,
  draw: WordPictureDrawer,
): AsyncIterable<OoxmlPart> {
  const pictures = new Pictures();
  yield { name: '[Content_Types].xml', chunks: [CONTENT_TYPES] };
  yield { name: '_rels/.rels', chunks: [PACKAGE_RELATIONSHIPS] };
  yield { name: 'word/document.xml', chunks: documentXml(mode, pages, pictures) };
  yield { name: 'word/_rels/document.xml.rels', chunks: documentRelationships(pictures) };
  for (const placed of pictures.pages) {
    const drawn = await draw(placed.index, placed.pictures);
    if (drawn.length !== placed.pictures.length) {
      throw new Error(
        `page ${String(placed.index + 1)} placed ${String(placed.pictures.length)} picture(s) and ` +
          `${String(drawn.length)} were drawn. The document names every one it placed, and a name with no ` +
          'picture behind it is a file Word reports as damaged.',
      );
    }
    for (const [offset, png] of drawn.entries()) {
      yield { name: `word/media/image${String(placed.first + offset)}.png`, chunks: [png] };
    }
  }
}

/**
 * Read when the zip reaches it, which is after `document.xml` — so every picture is numbered by then. A
 * generator's body runs when it is first pulled, not when it is created, which is the whole mechanism.
 */
function* documentRelationships(pictures: Pictures): Iterable<string> {
  yield `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;
  for (const placed of pictures.pages) {
    for (let offset = 0; offset < placed.pictures.length; offset += 1) {
      const number = placed.first + offset;
      yield `<Relationship Id="${relationshipId(number)}" Type="${IMAGE_RELATIONSHIP}" Target="media/image${String(number)}.png"/>`;
    }
  }
  yield '</Relationships>';
}

async function* documentXml(mode: WordMode, pages: AsyncIterable<WordPage>, pictures: Pictures): AsyncIterable<string> {
  yield `${XML_DECLARATION}<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}"><w:body>`;
  let previous: WordPage | null = null;
  let first: PageSize | null = null;
  // THE FLOW MODES' TEXT AREA is the body section's page less its margins: the
  // first page's size, which is the section every flowed page is set in.
  let area: PageSize = textArea(LETTER);
  for await (const page of pages) {
    if (first === null) {
      first = page.size;
      area = textArea(page.size);
    }
    if (previous !== null) {
      // The page before this one is now known not to be the last.
      yield mode === 'layout'
        ? layoutPage(previous, false, pictures)
        : `${flowPage(previous, mode === 'rich', area, pictures)}${PAGE_BREAK}`;
    }
    previous = page;
  }
  if (previous !== null) {
    yield mode === 'layout' ? layoutPage(previous, true, pictures) : flowPage(previous, mode === 'rich', area, pictures);
  }
  // THE BODY'S SECTION: the last page's size in layout mode, where every section is
  // one page; the first page's in the flow modes, with ordinary margins, and Letter
  // for an empty document so the package is still one Word opens.
  const size = mode === 'layout' ? (previous?.size ?? LETTER) : (first ?? LETTER);
  yield `${sectionProperties(size, mode !== 'layout')}</w:body></w:document>`;
}

function textArea(size: PageSize): PageSize {
  return { width: Math.max(1, size.width - 2 * FLOW_MARGIN), height: Math.max(1, size.height - 2 * FLOW_MARGIN) };
}

const LETTER: PageSize = { width: 612, height: 792 };
