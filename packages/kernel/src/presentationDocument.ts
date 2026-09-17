import { type OoxmlPart, XML_DECLARATION } from './ooxmlPackage.js';
import type { PageSize } from './pageGeometry.js';

/**
 * A PDF as a PowerPoint presentation — D10's *PowerPoint*, written by this build
 * ([ADR-0072](../../../docs/DECISIONS/0072-office-open-xml-exports-are-written-by-this-build-over-fflate.md)).
 *
 * ## One slide per page, and each slide IS the page
 *
 * A slide carries the page rendered by MuPDF's export rasteriser — the same one
 * the page-image export uses — scaled to fit the slide and centred. So what a
 * person sees in PowerPoint is what the page looked like, drawings, images and
 * annotations included.
 *
 * **The text is part of the picture and is not editable**, and the row says so.
 * Laying editable text over the picture draws every word twice, and laying it
 * out instead of the picture loses everything that is not text; a presentation
 * made from a PDF is most often shown, and this keeps it looking right.
 *
 * ## Sizes
 *
 * A presentation has ONE slide size, taken from the first page and clamped into
 * the range PowerPoint accepts (1 to 56 inches a side). Every page's picture is
 * fitted inside it with its own aspect kept, so a landscape page in a portrait
 * deck is letterboxed rather than stretched. EMU is PowerPoint's unit: 12,700 to
 * a point.
 */

/** One slide's content: the page as a PNG, and the page's displayed size. */
export interface PresentationPage {
  readonly png: Uint8Array;
  readonly size: PageSize;
}

const EMU_PER_POINT = 12_700;
/** PowerPoint's slide size bounds: 1 inch and 56 inches, in points. */
const MIN_SIDE = 72;
const MAX_SIDE = 4032;

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** A slide picture's resolution: 150 dots per inch, as a page-image scale. */
const PICTURE_DPI = 150;
/**
 * A slide picture's pixel budget: sixteen megapixels.
 *
 * A slide is shown on a screen, where more pixels than a 4K display's two
 * copies buy nothing, and every picture is a page's worth of bytes in the file.
 * Half the engine's own snapshot bound, which still refuses anything past its
 * own — so this is the export's choice, not a second copy of that limit.
 */
const PICTURE_PIXELS = 16_000_000;

/**
 * The page-image scale for a slide picture of a page `size` points: 150 dpi, or
 * less where that would pass the pixel budget. Never below 1, the engine's
 * floor; a page too large for that is refused by the engine by name.
 */
export function pictureScale(size: PageSize): number {
  const wanted = PICTURE_DPI / 72;
  const area = Math.max(size.width * size.height, 1);
  return Math.max(1, Math.min(wanted, Math.sqrt(PICTURE_PIXELS / area)));
}

/** The slide size for a deck whose first page is `size`, in points, inside PowerPoint's bounds. */
export function slideSize(size: PageSize): PageSize {
  const largest = Math.max(size.width, size.height, 1);
  const shrink = largest > MAX_SIDE ? MAX_SIDE / largest : 1;
  return {
    width: Math.min(MAX_SIDE, Math.max(MIN_SIDE, size.width * shrink)),
    height: Math.min(MAX_SIDE, Math.max(MIN_SIDE, size.height * shrink)),
  };
}

/** The picture's box on the slide: `page` fitted inside `slide`, aspect kept, centred. In EMU. */
export function fittedPicture(
  page: PageSize,
  slide: PageSize,
): { readonly x: number; readonly y: number; readonly cx: number; readonly cy: number } {
  const scale = Math.min(slide.width / Math.max(page.width, 1), slide.height / Math.max(page.height, 1));
  const width = page.width * scale;
  const height = page.height * scale;
  return {
    x: Math.round(((slide.width - width) / 2) * EMU_PER_POINT),
    y: Math.round(((slide.height - height) / 2) * EMU_PER_POINT),
    cx: Math.round(width * EMU_PER_POINT),
    cy: Math.round(height * EMU_PER_POINT),
  };
}

function emu(points: number): string {
  return String(Math.round(points * EMU_PER_POINT));
}

function contentTypes(slides: number): string {
  let overrides = '';
  for (let index = 1; index <= slides; index += 1) {
    overrides += `<Override PartName="/ppt/slides/slide${String(index)}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
  }
  return (
    `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    `${overrides}</Types>`
  );
}

function relationships(entries: readonly (readonly [id: string, type: string, target: string])[]): string {
  return (
    `${XML_DECLARATION}<Relationships xmlns="${RELS_NS}">` +
    entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('') +
    '</Relationships>'
  );
}

function presentation(slides: number, size: PageSize): string {
  let list = '';
  for (let index = 1; index <= slides; index += 1) {
    list += `<p:sldId id="${String(255 + index)}" r:id="rId${String(index + 1)}"/>`;
  }
  return (
    `${XML_DECLARATION}<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">` +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    (slides > 0 ? `<p:sldIdLst>${list}</p:sldIdLst>` : '') +
    `<p:sldSz cx="${emu(size.width)}" cy="${emu(size.height)}"/>` +
    '<p:notesSz cx="6858000" cy="9144000"/>' +
    '</p:presentation>'
  );
}

const EMPTY_TREE =
  '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
  '</p:spTree></p:cSld>';

const SLIDE_MASTER =
  `${XML_DECLARATION}<p:sldMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">${EMPTY_TREE}` +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
  '</p:sldMaster>';

const SLIDE_LAYOUT =
  `${XML_DECLARATION}<p:sldLayout xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" type="blank" preserve="1">` +
  `${EMPTY_TREE}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

/** The smallest theme PowerPoint accepts: the four required sections, plain. */
function theme(): string {
  const colour = (name: string, hex: string): string => `<a:${name}><a:srgbClr val="${hex}"/></a:${name}>`;
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = `<a:ln w="9525">${solid}</a:ln>`;
  const effect = '<a:effectStyle><a:effectLst/></a:effectStyle>';
  return (
    `${XML_DECLARATION}<a:theme xmlns:a="${A}" name="Monstera"><a:themeElements>` +
    '<a:clrScheme name="Monstera">' +
    '<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
    colour('dk2', '1F1F1F') + colour('lt2', 'EEEEEE') + colour('accent1', '1E6B52') + colour('accent2', '3A7CA5') +
    colour('accent3', '8A6D3B') + colour('accent4', '6B4E9B') + colour('accent5', 'A33A3A') + colour('accent6', '4B7F2A') +
    colour('hlink', '0563C1') + colour('folHlink', '954F72') +
    '</a:clrScheme>' +
    '<a:fontScheme name="Monstera"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
    '<a:fmtScheme name="Monstera">' +
    `<a:fillStyleLst>${solid}${solid}${solid}</a:fillStyleLst>` +
    `<a:lnStyleLst>${line}${line}${line}</a:lnStyleLst>` +
    `<a:effectStyleLst>${effect}${effect}${effect}</a:effectStyleLst>` +
    `<a:bgFillStyleLst>${solid}${solid}${solid}</a:bgFillStyleLst>` +
    '</a:fmtScheme></a:themeElements></a:theme>'
  );
}

function slide(index: number, page: PageSize, deck: PageSize): string {
  const box = fittedPicture(page, deck);
  return (
    `${XML_DECLARATION}<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree>` +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    `<p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ${String(index)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
    `<p:spPr><a:xfrm><a:off x="${String(box.x)}" y="${String(box.y)}"/><a:ext cx="${String(box.cx)}" cy="${String(box.cy)}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>' +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
  );
}

/**
 * The package's parts, the slides produced lazily.
 *
 * `pageCount` and the first page's size are needed before any slide, because the
 * content types and the presentation list every slide and fix the deck's size;
 * the pictures themselves are pulled one page at a time.
 */
export async function* presentationParts(
  pages: AsyncIterable<PresentationPage>,
  firstPage: PageSize,
  pageCount: number,
): AsyncIterable<OoxmlPart> {
  const deck = slideSize(firstPage);
  const slideRels: [string, string, string][] = [['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml']];
  for (let index = 1; index <= pageCount; index += 1) {
    slideRels.push([`rId${String(index + 1)}`, 'slide', `slides/slide${String(index)}.xml`]);
  }

  yield { name: '[Content_Types].xml', chunks: [contentTypes(pageCount)] };
  yield { name: '_rels/.rels', chunks: [relationships([['rId1', 'officeDocument', 'ppt/presentation.xml']])] };
  yield { name: 'ppt/presentation.xml', chunks: [presentation(pageCount, deck)] };
  yield { name: 'ppt/_rels/presentation.xml.rels', chunks: [relationships(slideRels)] };
  yield { name: 'ppt/slideMasters/slideMaster1.xml', chunks: [SLIDE_MASTER] };
  yield {
    name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    chunks: [relationships([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']])],
  };
  yield { name: 'ppt/slideLayouts/slideLayout1.xml', chunks: [SLIDE_LAYOUT] };
  yield {
    name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    chunks: [relationships([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']])],
  };
  yield { name: 'ppt/theme/theme1.xml', chunks: [theme()] };

  let index = 0;
  for await (const page of pages) {
    index += 1;
    if (index > pageCount) {
      throw new Error(`the deck declared ${String(pageCount)} slide(s) and a page past them arrived`);
    }
    yield { name: `ppt/slides/slide${String(index)}.xml`, chunks: [slide(index, page.size, deck)] };
    yield {
      name: `ppt/slides/_rels/slide${String(index)}.xml.rels`,
      chunks: [relationships([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'image', `../media/image${String(index)}.png`]])],
    };
    yield { name: `ppt/media/image${String(index)}.png`, chunks: [page.png] };
  }
  if (index !== pageCount) {
    throw new Error(`the deck declared ${String(pageCount)} slide(s) and ${String(index)} arrived`);
  }
}
