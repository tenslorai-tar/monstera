import { strFromU8, unzipSync } from 'fflate';
import { type Document, Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';

import { ooxmlPackage } from './ooxmlPackage.js';
import type { ContentPath, ContentRun, PageContent } from './presentationContent.js';
import { type PresentationPage, presentationParts, slideSize } from './presentationDocument.js';
import type { ResolvedSlide } from './editableSlide.js';
import { logicalWordOrder } from './readingOrder.js';
import { type EditableSlide, type SlideBuild, buildSlide, isRightToLeft, typefaceOf } from './slideModel.js';

/**
 * The editable PowerPoint export, read back by a SECOND READER: the package is written, unzipped and parsed as XML by a
 * different parser from anything that wrote it, and every assertion is about what that parse says a PowerPoint user
 * would see: which text box says what, where, in which face and size, and which picture and shape sit where
 * ([ADR-0210](../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)).
 * PowerPoint's own layout of the file is the owner's to open; nothing here claims it.
 */

const BLACK = { r: 0, g: 0, b: 0 };

function style(over: Partial<ContentRun['style']> = {}): ContentRun['style'] {
  return { size: 11, colour: BLACK, font: 'Times-Roman', serif: true, mono: false, italic: false, bold: false, orientation: 'upright', ...over };
}

function run(index: number, text: string, left: number, bottom: number, right: number, top: number, over: Partial<ContentRun['style']> = {}, invisible = false): ContentRun {
  return { index, last: index, text, left, right, bottom, top, invisible, turn: null, style: style(over) };
}

/**
 * A run set at `angle` degrees (counter-clockwise), `length` along its baseline and `height` across, with its first
 * baseline corner at (`x`, `y`). Its four corners are what PDFium's rotated bounds answer, and its axis box is the box of
 * those corners, as the host states both.
 */
function turned(index: number, text: string, x: number, y: number, length: number, height: number, angle: number): ContentRun {
  const cos = Math.cos((angle * Math.PI) / 180);
  const sin = Math.sin((angle * Math.PI) / 180);
  const at = (u: number, v: number): [number, number] => [x + u * cos - v * sin, y + u * sin + v * cos];
  const quad: NonNullable<ContentRun['turn']>['quad'] = [...at(0, 0), ...at(length, 0), ...at(length, height), ...at(0, height)];
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  return {
    ...run(index, text, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), { orientation: 'slanted' }),
    turn: { angle, quad },
  };
}

const FRAME: PageContent['frame'] = { crop: { x0: 0, y0: 0, x1: 612, y1: 792 }, rotation: 0 };

function page(over: Partial<PageContent>): PageContent {
  return { frame: FRAME, runs: [], images: [], paths: [], opaque: [], unaddressable: 0, truncated: false, ...over };
}

const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3);

const RECTANGLE: ContentPath = {
  index: 5,
  bounds: { left: 300, bottom: 400, right: 500, top: 520 },
  segments: [
    { kind: 'move', x: 300, y: 400 },
    { kind: 'line', x: 500, y: 400 },
    { kind: 'line', x: 500, y: 520 },
    { kind: 'line', x: 300, y: 520 },
    { kind: 'close' },
  ],
  fill: { r: 0, g: 0, b: 255, a: 255 },
  stroke: null,
};

const RULE: ContentPath = {
  index: 6,
  bounds: { left: 72, bottom: 380, right: 540, top: 380 },
  segments: [
    { kind: 'move', x: 72, y: 380 },
    { kind: 'line', x: 540, y: 380 },
  ],
  fill: null,
  stroke: { r: 0, g: 0, b: 0, a: 255, width: 2, cap: 'butt', join: 'miter' },
};

/** The fixture the brief names: text in two fonts, an image, a rectangle and a line. */
const FIXTURE = page({
  runs: [
    run(0, 'Quarterly Report', 72, 700, 300, 724, { size: 24, font: 'ABCDEF+Helvetica-Bold', serif: false, bold: true, colour: { r: 200, g: 16, b: 32 } }),
    run(1, 'The first line of the paragraph', 72, 650, 300, 661),
    run(2, 'carries on to a second line here', 72, 636, 300, 647),
    run(3, 'and ends on a third.', 72, 622, 200, 633),
  ],
  images: [
    { index: 4, matrix: [200, 0, 0, 120, 72, 400], bounds: { left: 72, bottom: 400, right: 272, top: 520 }, width: 20, height: 12, format: 'jpeg', bytes: JPEG },
  ],
  paths: [RECTANGLE, RULE],
});

function embedded(build: SlideBuild): ResolvedSlide {
  if (build.kind !== 'editable') throw new Error(`expected an editable slide, got a fallback: ${build.reason}`);
  const slide: EditableSlide = build.slide;
  return {
    objects: slide.objects.map((object) => {
      if (object.kind !== 'picture') return object;
      if (object.source.kind !== 'embedded') throw new Error('this fixture embeds its pictures');
      return { ...object, source: object.source };
    }),
  };
}

async function written(pages: PresentationPage[]): Promise<Record<string, Uint8Array>> {
  async function* source(): AsyncIterable<PresentationPage> {
    for (const entry of pages) yield await Promise.resolve(entry);
  }
  const chunks: Uint8Array[] = [];
  const first = pages[0]?.size ?? { width: 612, height: 792 };
  for await (const chunk of ooxmlPackage(presentationParts(source(), first, pages.length, { editable: true }))) chunks.push(chunk);
  const total = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    total.set(chunk, at);
    at += chunk.length;
  }
  return unzipSync(total);
}

/** The second reader: the slide's XML parsed by a parser that is not the one that wrote it, refusing malformed input. */
function parsed(files: Record<string, Uint8Array>, slide: number): Document {
  const xml = strFromU8(files[`ppt/slides/slide${String(slide)}.xml`] ?? new Uint8Array());
  const window = new Window();
  const document = new window.DOMParser().parseFromString(xml, 'text/xml');
  if (document.getElementsByTagName('parsererror').length > 0) throw new Error('the slide is not well formed XML');
  return document;
}

const POINT = 12_700;

interface ReadBox {
  readonly text: string;
  readonly paragraphs: number;
  readonly breaks: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly typeface: string;
  readonly size: number;
  readonly colour: string;
  readonly bold: boolean;
  readonly algn: string;
  readonly wrap: string | null;
  readonly noAutofit: boolean;
  /** The box's turn in degrees clockwise, as PowerPoint reads `rot`. */
  readonly rot: number;
}

function boxes(document: Document): ReadBox[] {
  return [...document.getElementsByTagName('p:sp')].flatMap((shape) => {
    if (shape.getElementsByTagName('p:txBody').length === 0) return [];
    const off = shape.getElementsByTagName('a:off')[0];
    const ext = shape.getElementsByTagName('a:ext')[0];
    const runProps = shape.getElementsByTagName('a:rPr')[0];
    const body = shape.getElementsByTagName('a:bodyPr')[0];
    return [
      {
        text: [...shape.getElementsByTagName('a:t')].map((t) => t.textContent).join('\n'),
        paragraphs: shape.getElementsByTagName('a:p').length,
        breaks: shape.getElementsByTagName('a:br').length,
        x: Number(off?.getAttribute('x')) / POINT,
        y: Number(off?.getAttribute('y')) / POINT,
        width: Number(ext?.getAttribute('cx')) / POINT,
        height: Number(ext?.getAttribute('cy')) / POINT,
        typeface: runProps?.getElementsByTagName('a:latin')[0]?.getAttribute('typeface') ?? '',
        size: Number(runProps?.getAttribute('sz')) / 100,
        colour: runProps?.getElementsByTagName('a:srgbClr')[0]?.getAttribute('val') ?? '',
        bold: runProps?.getAttribute('b') === '1',
        algn: shape.getElementsByTagName('a:pPr')[0]?.getAttribute('algn') ?? '',
        wrap: body?.getAttribute('wrap') ?? null,
        noAutofit: shape.getElementsByTagName('a:noAutofit').length > 0,
        rot: Number(shape.getElementsByTagName('a:xfrm')[0]?.getAttribute('rot') ?? 0) / 60_000,
      },
    ];
  });
}

describe('the editable slide, read back from the written package', () => {
  const build = buildSlide(FIXTURE, slideSize({ width: 612, height: 792 }));

  it('writes each text box with its words, face, size and colour, and the position the page states', async () => {
    const files = await written([{ size: { width: 612, height: 792 }, slide: embedded(build) }]);
    const read = boxes(parsed(files, 1));

    const heading = read.find((box) => box.text === 'Quarterly Report');
    expect(heading).toBeDefined();
    // A subset prefix is not part of a family, and PowerPoint knows Helvetica as Arial.
    expect(heading?.typeface).toBe('Arial');
    expect(heading?.size).toBe(24);
    expect(heading?.colour).toBe('C81020');
    expect(heading?.bold).toBe(true);
    // The page's ink top is 792 - 724 = 68 pt from the slide's top; the box sits within half a size of it.
    expect(Math.abs((heading?.y ?? 0) - 68)).toBeLessThan(24 * 0.5);
    expect(heading?.x).toBeCloseTo(72, 0);

    // A SECOND FACE: the paragraph is Times, regular, 11 pt, so a writer that set every box in one face fails here.
    const paragraph = read.find((box) => box.text.startsWith('The first line'));
    expect(paragraph?.typeface).toBe('Times New Roman');
    expect(paragraph?.size).toBe(11);
    expect(paragraph?.bold).toBe(false);
    expect(paragraph?.x).toBeCloseTo(72, 0);
  });

  it('CONTROL: the same page as Exact look has no text box at all, so the assertions above can fail', async () => {
    const files = await written([{ png: Uint8Array.of(0x89, 0x50, 0x4e, 0x47), size: { width: 612, height: 792 } }]);
    expect(strFromU8(files['ppt/slides/slide1.xml'] ?? new Uint8Array())).not.toContain('<a:t>');
    expect(boxes(parsed(files, 1))).toHaveLength(0);
  });

  it('Exact look is unchanged: one picture per slide, no jpeg type declared, and an editable deck sits beside it page by page', async () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);
    async function* mixed(): AsyncIterable<PresentationPage> {
      yield await Promise.resolve({ png, size: { width: 612, height: 792 } });
      yield await Promise.resolve({ size: { width: 612, height: 792 }, slide: embedded(build) });
    }
    const chunks: Uint8Array[] = [];
    for await (const chunk of ooxmlPackage(presentationParts(mixed(), { width: 612, height: 792 }, 2, { editable: true }))) chunks.push(chunk);
    const total = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let at = 0;
    for (const chunk of chunks) {
      total.set(chunk, at);
      at += chunk.length;
    }
    const files = unzipSync(total);
    expect(files['ppt/media/image1.png']).toStrictEqual(png);
    expect(strFromU8(files['ppt/slides/slide1.xml'] ?? new Uint8Array())).toContain('<p:pic>');
    expect(boxes(parsed(files, 1))).toHaveLength(0);
    expect(boxes(parsed(files, 2)).length).toBeGreaterThan(0);

    // Without the option, the content types are exactly what they were before this build.
    const exact = await written([{ png, size: { width: 612, height: 792 } }]);
    expect(strFromU8(exact['[Content_Types].xml'] ?? new Uint8Array())).toContain('Extension="jpeg"');
    async function* plain(): AsyncIterable<PresentationPage> {
      yield await Promise.resolve({ png, size: { width: 612, height: 792 } });
    }
    const bare: Uint8Array[] = [];
    for await (const chunk of ooxmlPackage(presentationParts(plain(), { width: 612, height: 792 }, 1))) bare.push(chunk);
    const bareTotal = new Uint8Array(bare.reduce((sum, chunk) => sum + chunk.length, 0));
    let bareAt = 0;
    for (const chunk of bare) {
      bareTotal.set(chunk, bareAt);
      bareAt += chunk.length;
    }
    expect(strFromU8(unzipSync(bareTotal)['[Content_Types].xml'] ?? new Uint8Array())).not.toContain('jpeg');
  });

  it('CONTROL: a placement that skipped the page transform lands the heading far from the page’s own place', async () => {
    // A bare reading of PDF y as slide y puts the heading at 724 pt from the top of a 792 pt slide. The asserted place is 68,
    // so the position assertion above is one that a missing transform fails.
    const files = await written([{ size: { width: 612, height: 792 }, slide: embedded(build) }]);
    const heading = boxes(parsed(files, 1)).find((box) => box.text === 'Quarterly Report');
    expect(Math.abs(724 - (heading?.y ?? 0))).toBeGreaterThan(600);
  });

  it('keeps a paragraph as ONE box, its original line breaks as explicit breaks, wrap and autofit off', async () => {
    const files = await written([{ size: { width: 612, height: 792 }, slide: embedded(build) }]);
    const paragraph = boxes(parsed(files, 1)).find((box) => box.text.includes('first line'));
    expect(paragraph?.paragraphs).toBe(1);
    expect(paragraph?.breaks).toBe(2);
    expect(paragraph?.text).toBe('The first line of the paragraph\ncarries on to a second line here\nand ends on a third.');
    expect(paragraph?.wrap).toBe('none');
    expect(paragraph?.noAutofit).toBe(true);
    expect(paragraph?.algn).toBe('l');
  });

  it('places the picture at its place and size, embedding a plain JPEG as its own bytes', async () => {
    const files = await written([{ size: { width: 612, height: 792 }, slide: embedded(build) }]);
    const document = parsed(files, 1);
    const picture = document.getElementsByTagName('p:pic')[0];
    const off = picture?.getElementsByTagName('a:off')[0];
    const ext = picture?.getElementsByTagName('a:ext')[0];
    expect(Number(off?.getAttribute('x')) / POINT).toBeCloseTo(72, 1);
    // 792 - 520 = 272 from the top.
    expect(Number(off?.getAttribute('y')) / POINT).toBeCloseTo(272, 1);
    expect(Number(ext?.getAttribute('cx')) / POINT).toBeCloseTo(200, 1);
    expect(Number(ext?.getAttribute('cy')) / POINT).toBeCloseTo(120, 1);
    const media = Object.keys(files).filter((name) => name.startsWith('ppt/media/'));
    expect(media).toHaveLength(1);
    expect(files[media[0] ?? '']).toStrictEqual(JPEG);
    expect(strFromU8(files['[Content_Types].xml'] ?? new Uint8Array())).toContain('Extension="jpeg"');
  });

  it('writes the rectangle as a rectangle with its fill, and the line as a line with its stroke', async () => {
    const files = await written([{ size: { width: 612, height: 792 }, slide: embedded(build) }]);
    const shapes = [...parsed(files, 1).getElementsByTagName('p:sp')].filter((shape) => shape.getElementsByTagName('p:txBody').length === 0);
    expect(shapes).toHaveLength(2);
    const [rect, line] = shapes;
    expect(rect?.getElementsByTagName('a:prstGeom')[0]?.getAttribute('prst')).toBe('rect');
    expect(rect?.getElementsByTagName('a:srgbClr')[0]?.getAttribute('val')).toBe('0000FF');
    expect(Number(rect?.getElementsByTagName('a:off')[0]?.getAttribute('x')) / POINT).toBeCloseTo(300, 1);
    expect(Number(rect?.getElementsByTagName('a:ext')[0]?.getAttribute('cx')) / POINT).toBeCloseTo(200, 1);
    expect(line?.getElementsByTagName('a:prstGeom')[0]?.getAttribute('prst')).toBe('line');
    expect(line?.getElementsByTagName('a:ln')[0]?.getAttribute('w')).toBe(String(2 * POINT));
    expect(Number(line?.getElementsByTagName('a:off')[0]?.getAttribute('y')) / POINT).toBeCloseTo(412, 1);
  });

  it('draws in the page’s order: the picture, then the rectangle, then the line, after the text', async () => {
    const files = await written([{ size: { width: 612, height: 792 }, slide: embedded(build) }]);
    const order = [...parsed(files, 1).getElementsByTagName('p:spTree')[0]?.children ?? []].map((child) => child.tagName).filter((tag) => tag !== 'p:nvGrpSpPr' && tag !== 'p:grpSpPr');
    expect(order).toStrictEqual(['p:sp', 'p:sp', 'p:pic', 'p:sp', 'p:sp']);
  });
});

describe('a recognised scan (the owner’s answer 2: the picture stays under the words, the boxes have no fill)', () => {
  const deck = slideSize({ width: 612, height: 792 });
  // What recognition writes over a scan: invisible text (render mode 3), two lines, over a page that holds one image.
  const scan = page({
    runs: [run(0, 'Invoice 4411', 72, 700, 220, 712, {}, true), run(1, 'Total due 80.00', 72, 686, 240, 698, {}, true)],
    images: [
      { index: 2, matrix: [612, 0, 0, 792, 0, 0], bounds: { left: 0, bottom: 0, right: 612, top: 792 }, width: 1, height: 1, format: 'jpeg', bytes: JPEG },
    ],
  });

  it('is the page picture at the back and the recognised words as boxes with NO FILL over it, and the scan’s own image is not drawn twice', async () => {
    const build = buildSlide(scan, deck);
    if (build.kind !== 'editable') throw new Error('expected editable');
    expect(build.scan).toBe(true);
    // The model asks for the page as drawn, once; the image object under it is not a second picture.
    expect(build.slide.objects.flatMap((object) => (object.kind === 'picture' ? [object.source.kind] : []))).toStrictEqual(['page']);
    const resolved: ResolvedSlide = {
      objects: build.slide.objects.map((object) =>
        object.kind === 'picture' ? { ...object, source: { kind: 'embedded', extension: 'png', bytes: Uint8Array.of(1, 2, 3) } } : object,
      ),
    };
    const files = await written([{ size: { width: 612, height: 792 }, slide: resolved }]);
    const document = parsed(files, 1);
    const order = [...(document.getElementsByTagName('p:spTree')[0]?.children ?? [])].map((child) => child.tagName).filter((tag) => tag !== 'p:nvGrpSpPr' && tag !== 'p:grpSpPr');
    // THE PICTURE FIRST, so it is at the back; one paragraph of two lines after it, and no second picture.
    expect(order).toStrictEqual(['p:pic', 'p:sp']);
    const [box] = boxes(document);
    expect(box?.text).toBe('Invoice 4411\nTotal due 80.00');
    const shape = document.getElementsByTagName('p:sp')[0];
    expect(shape?.getElementsByTagName('p:spPr')[0]?.getElementsByTagName('a:noFill')).toHaveLength(1);
  });

  it('CONTROL: the same words drawn VISIBLY on a page that holds an image are an ordinary page, whose image is its own picture', () => {
    const typed = page({ runs: scan.runs.map((entry) => ({ ...entry, invisible: false })), images: scan.images });
    const build = buildSlide(typed, deck);
    if (build.kind !== 'editable') throw new Error('expected editable');
    expect(build.scan).toBe(false);
    expect(build.slide.objects.flatMap((object) => (object.kind === 'picture' ? [object.source.kind] : []))).toStrictEqual(['embedded']);
  });
});

describe('text boxes: paragraphs and columns', () => {
  const deck = slideSize({ width: 612, height: 792 });

  it('a two-column page comes out with NO box spanning the columns', () => {
    // Two columns share baselines: each row is one PDFium line 400 pt wide across a 40 pt gutter.
    const rows = [700, 686, 672];
    const left = rows.map((y, n) => run(n * 2, `left column row ${String(n)}`, 72, y, 280, y + 11));
    const right = rows.map((y, n) => run(n * 2 + 1, `right column row ${String(n)}`, 320, y, 530, y + 11));
    const build = buildSlide(page({ runs: [...left, ...right].sort((a, b) => a.index - b.index) }), deck);
    if (build.kind !== 'editable') throw new Error('expected editable');
    const texts = build.slide.objects.flatMap((object) => (object.kind === 'text' ? [object] : []));
    expect(texts).toHaveLength(2);
    for (const box of texts) {
      // Each box lies wholly on one side of the gutter, 280 to 320 pt.
      const right = box.x + box.width;
      expect(box.x >= 320 - 1 || right <= 280 + 1).toBe(true);
    }
    expect(texts.map((box) => box.lines.length)).toStrictEqual([3, 3]);
  });

  it('CONTROL: grouping the same runs as ONE line per row would span the gutter, which is what the columns assertion catches', () => {
    const row = run(0, 'left column row 0 right column row 0', 72, 700, 530, 711);
    const build = buildSlide(page({ runs: [row] }), deck);
    if (build.kind !== 'editable') throw new Error('expected editable');
    const [box] = build.slide.objects;
    const spans = box?.kind === 'text' && box.x < 280 && box.x + box.width > 320;
    expect(spans).toBe(true);
  });

  it('lines that agree on no alignment are boxes of their own, one per line', () => {
    const ragged = [run(0, 'one', 72, 700, 140, 711), run(1, 'two', 160, 686, 250, 697), run(2, 'three', 100, 672, 300, 683)];
    const build = buildSlide(page({ runs: ragged }), deck);
    if (build.kind !== 'editable') throw new Error('expected editable');
    expect(build.slide.objects.filter((object) => object.kind === 'text')).toHaveLength(3);
  });

  it('a right-to-left line is written right to left, and a block mixing directions is one box per line', () => {
    expect(isRightToLeft('שלום עולם')).toBe(true);
    expect(isRightToLeft('Hello שלום')).toBe(false);
    const hebrew = buildSlide(page({ runs: [run(0, 'שלום עולם', 400, 700, 540, 711)] }), deck);
    if (hebrew.kind !== 'editable') throw new Error('expected editable');
    const [box] = hebrew.slide.objects;
    expect(box?.kind === 'text' && box.rtl).toBe(true);

    const mixed = buildSlide(page({ runs: [run(0, 'שלום עולם', 400, 700, 540, 711), run(1, 'hello world', 400, 686, 540, 697)] }), deck);
    if (mixed.kind !== 'editable') throw new Error('expected editable');
    expect(mixed.slide.objects.filter((object) => object.kind === 'text')).toHaveLength(2);
  });

  const words = (text: string): { text: string }[] => text.split(' ').map((word) => ({ text: word }));
  const read = (list: readonly { text: string }[]): string => list.map((word) => word.text).join(' ');

  it('puts the words of a right-to-left line in the order they are read, from the order PDFium answers them', () => {
    // PDFium answers the words as they sit on the page, left to right: the line's LAST word first.
    expect(read(logicalWordOrder(words('בעברית משפט זה עולם שלום')))).toBe('שלום עולם זה משפט בעברית');
    // A phrase that reads left to right inside it keeps its own order and moves as one, so `3 figure see` is the defect.
    expect(read(logicalWordOrder(words('עולם see figure 3 שלום')))).toBe('שלום see figure 3 עולם');
    // CONTROL: a left-to-right line is not touched by anything but the caller's choice to reorder, and two words of one
    // direction in the wrong order are exactly what the function turns round, so the assertion above can fail.
    expect(read(logicalWordOrder(words('שלום עולם')))).toBe('עולם שלום');
  });

  it('a run whose words are already in reading order is written as it is, and a left-to-right one is left as drawn', async () => {
    // The page-content read puts a right-to-left run's words in reading order (`readingOrder.ts`), so the model must not
    // reverse them again: one run, one box, the same words.
    const build = buildSlide(
      page({
        runs: [
          run(0, 'שלום עולם זה משפט בעברית', 72, 650, 296, 663),
          run(1, 'one two three words here', 72, 600, 296, 613),
        ],
      }),
      deck,
    );
    if (build.kind !== 'editable') throw new Error('expected editable');
    const files = await written([{ size: { width: 612, height: 792 }, slide: embedded(build) }]);
    const read = boxes(parsed(files, 1));
    expect(read.find((box) => box.text.startsWith('ש'))?.text).toBe('שלום עולם זה משפט בעברית');
    expect(read.find((box) => box.text.startsWith('one'))?.text).toBe('one two three words here');
  });

  it('Arabic drawn in its presentation forms is written as the letters, so PowerPoint can shape and search it', async () => {
    // The word of the page: final alef, medial beh, initial hah, final reh, initial meem, as joined shapes in logical order.
    const shaped = String.fromCodePoint(0xfee3, 0xfeae, 0xfea3, 0xfe92, 0xfe8e);
    const letters = String.fromCodePoint(0x0645, 0x0631, 0x062d, 0x0628, 0x0627);
    const build = buildSlide(page({ runs: [run(0, shaped, 400, 650, 440, 663), run(1, 'plain text', 72, 600, 140, 611)] }), deck);
    if (build.kind !== 'editable') throw new Error('expected editable');
    const read = boxes(parsed(await written([{ size: { width: 612, height: 792 }, slide: embedded(build) }]), 1));
    expect(read.map((box) => box.text)).toContain(letters);
    // CONTROL: the shaped word really was other characters, so the assertion above is the normalisation and not the input.
    expect(shaped).not.toBe(letters);
    expect(read.map((box) => box.text)).toContain('plain text');
  });

  it('a line drawn word by word reads the same whichever way the producer drew it: by where the words sit', async () => {
    const sitting = [
      { text: 'שלום', left: 360, right: 400 },
      { text: 'עולם', left: 316, right: 354 },
      { text: 'זה', left: 292, right: 308 },
    ];
    const textOf = async (drawn: typeof sitting): Promise<string | undefined> => {
      const build = buildSlide(page({ runs: drawn.map((word, at) => run(at, `${word.text} `, word.left, 650, word.right, 663)) }), deck);
      if (build.kind !== 'editable') throw new Error('expected editable');
      const files = await written([{ size: { width: 612, height: 792 }, slide: embedded(build) }]);
      return boxes(parsed(files, 1))[0]?.text;
    };
    // Drawn in reading order (the rightmost first) and drawn left to right: one line, one answer.
    expect(await textOf(sitting)).toBe('שלום עולם זה');
    expect(await textOf([...sitting].reverse())).toBe('שלום עולם זה');
  });
});

describe('text turned by the page is written as a box turned the same way', () => {
  const deck = slideSize({ width: 612, height: 792 });

  /** Where the first character's baseline corner lands on the slide: the box's left-centre, turned about its centre. */
  function startOf(box: ReadBox): { x: number; y: number } {
    const phi = (box.rot * Math.PI) / 180;
    const dx = -box.width / 2;
    return {
      x: box.x + box.width / 2 + dx * Math.cos(phi),
      y: box.y + box.height / 2 + dx * Math.sin(phi),
    };
  }

  async function boxesOf(runs: ContentRun[]): Promise<ReadBox[]> {
    const build = buildSlide(page({ runs }), deck);
    if (build.kind !== 'editable') throw new Error(`expected editable, got ${build.reason}`);
    return boxes(parsed(await written([{ size: { width: 612, height: 792 }, slide: embedded(build) }]), 1));
  }

  it('a label that reads upward (90 degrees) is one box turned 270 clockwise, starting where the text starts', async () => {
    // The run starts at (40, 300) and reads upward for 100 pt.
    const [box, ...others] = await boxesOf([turned(0, 'Side label', 40, 300, 100, 11, 90)]);
    expect(others).toHaveLength(0);
    expect(box?.text).toBe('Side label');
    expect(box?.rot).toBeCloseTo(270, 3);
    // The baseline corner (40, 300) is (40, 792 - 300) on the slide. The box's own height is not the run's, so only the
    // start of the text along its reading direction is compared: the text starts at the box's left edge, centred in its height.
    expect(box?.width).toBeCloseTo(100, 0);
    if (box === undefined) throw new Error('expected a box');
    const start = startOf(box);
    expect(start.x).toBeGreaterThan(20);
    expect(start.x).toBeLessThan(60);
    expect(start.y).toBeCloseTo(792 - 300, -1);
  });

  it('a heading at 30 degrees is a box turned 330 clockwise, and CONTROL: written level it would not be', async () => {
    const [box] = await boxesOf([turned(0, 'Draft copy', 100, 400, 200, 24, 30)]);
    expect(box?.rot).toBeCloseTo(330, 3);
    // The box's width is the run's length along its baseline, not the width of its axis box (which would be 200 cos 30 + 24 sin 30).
    expect(box?.width).toBeCloseTo(200, 0);
    // CONTROL: a build that ignored the turn writes rot 0 and the axis box's width, and fails both assertions above.
    const level = await boxesOf([run(0, 'Draft copy', 100, 400, 100 + 200 * Math.cos(Math.PI / 6) + 24 * 0.5, 400 + 200 * 0.5 + 24 * Math.cos(Math.PI / 6))]);
    expect(level[0]?.rot).toBe(0);
    expect(Math.abs((level[0]?.width ?? 0) - 200)).toBeGreaterThan(5);
  });

  it('level text and turned text that cross each other are boxes of their own, and the level box is not turned', async () => {
    const written = await boxesOf([
      run(0, 'A level line of words', 72, 500, 260, 511),
      turned(1, 'Crossing label', 150, 450, 120, 11, 90),
    ]);
    expect(written).toHaveLength(2);
    expect(written.find((box) => box.text === 'A level line of words')?.rot).toBe(0);
    expect(written.find((box) => box.text === 'Crossing label')?.rot).toBeCloseTo(270, 3);
  });

  it('two lines set at the same angle are ONE paragraph box with a break between them', async () => {
    const lines = await boxesOf([
      turned(0, 'First line of it', 60, 300, 120, 11, 90),
      turned(1, 'Second line of it', 74.5, 300, 120, 11, 90),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.breaks).toBe(1);
    expect(lines[0]?.rot).toBeCloseTo(270, 3);
  });

  it('a page displayed at a quarter turn adds it to the text’s own turn', () => {
    const framed = page({
      frame: { crop: { x0: 0, y0: 0, x1: 612, y1: 792 }, rotation: 90 },
      runs: [turned(0, 'Both turned', 100, 100, 100, 11, 90)],
    });
    const build = buildSlide(framed, { width: 792, height: 612 });
    if (build.kind !== 'editable') throw new Error('expected editable');
    const [box] = build.slide.objects;
    // Clockwise 90 from the page's display, counter-clockwise 90 from the text: they cancel.
    expect(box?.kind === 'text' && Math.round(box.rotation)).toBe(0);
  });
});

describe('where a page cannot be written editable, it says why instead of writing it wrong', () => {
  const deck = slideSize({ width: 612, height: 792 });

  it('names a run SHEARED or mirrored, uncounted text, a cut list and a picture with no words', () => {
    expect(buildSlide(page({ runs: [run(0, 'tilted', 72, 700, 140, 711, { orientation: 'slanted' })] }), deck)).toStrictEqual({ kind: 'fallback', reason: 'text-not-upright' });
    expect(buildSlide(page({ runs: [run(0, 'x', 72, 700, 80, 711)], unaddressable: 3 }), deck)).toStrictEqual({ kind: 'fallback', reason: 'text-not-addressable' });
    expect(buildSlide(page({ truncated: true }), deck)).toStrictEqual({ kind: 'fallback', reason: 'content-truncated' });
    const [image] = FIXTURE.images;
    if (image === undefined) throw new Error('fixture lost its image');
    expect(buildSlide(page({ images: [image] }), deck)).toStrictEqual({ kind: 'fallback', reason: 'picture-without-text' });
  });

  it('a page of paths and no words is editable shapes, and a blank page is an empty slide', () => {
    expect(buildSlide(page({ paths: [RECTANGLE] }), deck).kind).toBe('editable');
    const blank = buildSlide(page({}), deck);
    expect(blank.kind === 'editable' && blank.slide.objects.length).toBe(0);
  });
});

describe('the page is fitted to the deck, by one factor for every object', () => {
  it('a landscape page in a portrait deck: smaller, centred, and the font size scaled by the same factor', () => {
    const landscape = page({
      frame: { crop: { x0: 0, y0: 0, x1: 792, y1: 612 }, rotation: 0 },
      runs: [run(0, 'wide', 72, 500, 140, 524, { size: 24 })],
    });
    const build = buildSlide(landscape, { width: 612, height: 792 });
    if (build.kind !== 'editable') throw new Error('expected editable');
    const [box] = build.slide.objects;
    if (box?.kind !== 'text') throw new Error('expected text');
    const k = 612 / 792;
    expect(box.lines[0]?.[0]?.size).toBeCloseTo(24 * k, 5);
    expect(box.x).toBeCloseTo(72 * k, 3);
    // Centred vertically: the page is 612 * k = 472.8 pt tall in a 792 pt deck.
    expect(box.y).toBeGreaterThan((792 - 612 * k) / 2);
  });

  it('a CropBox whose origin is not zero places text where the visible page has it', () => {
    const offset = page({
      frame: { crop: { x0: 100, y0: 200, x1: 712, y1: 992 }, rotation: 0 },
      runs: [run(0, 'offset', 172, 900, 240, 924)],
    });
    const build = buildSlide(offset, { width: 612, height: 792 });
    if (build.kind !== 'editable') throw new Error('expected editable');
    const [box] = build.slide.objects;
    if (box?.kind !== 'text') throw new Error('expected text');
    // 72 pt from the visible left edge, and 992 - 924 = 68 pt from the visible top.
    expect(box.x).toBeCloseTo(72, 3);
    expect(Math.abs(box.y - 68)).toBeLessThan(12);
  });

  it('a page displayed at a quarter turn writes its boxes turned, in the unrotated frame', () => {
    const turned = page({
      frame: { crop: { x0: 0, y0: 0, x1: 612, y1: 792 }, rotation: 90 },
      runs: [run(0, 'turned', 72, 700, 140, 711)],
    });
    const build = buildSlide(turned, { width: 792, height: 612 });
    if (build.kind !== 'editable') throw new Error('expected editable');
    const [box] = build.slide.objects;
    expect(box?.kind === 'text' && box.rotation).toBe(90);
  });
});

describe('a document’s own numbers cannot make the file one PowerPoint refuses', () => {
  const deck = slideSize({ width: 612, height: 792 });

  it('writes integers inside PowerPoint’s bounds for a coordinate of 1e30, and CONTROL: an ordinary one is written exactly', async () => {
    const huge: ContentPath = {
      index: 1,
      bounds: { left: 0, bottom: 0, right: 1e30, top: 1e30 },
      segments: [
        { kind: 'move', x: 0, y: 0 },
        { kind: 'line', x: 1e30, y: 1e30 },
      ],
      fill: null,
      stroke: { r: 0, g: 0, b: 0, a: 255, width: 1e30, cap: 'butt', join: 'miter' },
    };
    const build = buildSlide(page({ paths: [huge, RULE] }), deck);
    const files = await written([{ size: { width: 612, height: 792 }, slide: embedded(build) }]);
    const xml = strFromU8(files['ppt/slides/slide1.xml'] ?? new Uint8Array());
    // No attribute is in exponent form, and none passes the clamp.
    expect(xml).not.toMatch(/="[-\d.]*e[+-]?\d+"/u);
    const numbers = [...xml.matchAll(/ (?:x|y|cx|cy|w)="(-?\d+)"/gu)].map((match) => Math.abs(Number(match[1])));
    expect(Math.max(...numbers)).toBe(2 * 4032 * 12_700);
    // The ordinary rule is untouched: 2 pt wide, 468 pt long.
    expect(xml).toContain(`<a:ln w="${String(2 * 12_700)}"`);
    expect(xml).toContain(`cx="${String(468 * 12_700)}"`);
  });
});

describe('names', () => {
  it('turns a PDF base font name into the family PowerPoint knows', () => {
    expect(typefaceOf('ABCDEF+Calibri-Bold')).toBe('Calibri');
    expect(typefaceOf('ArialMT')).toBe('Arial');
    expect(typefaceOf('TimesNewRomanPS-BoldMT')).toBe('Times New Roman');
    expect(typefaceOf('Helvetica-Oblique')).toBe('Arial');
    expect(typefaceOf('SegoeUI')).toBe('Segoe UI');
  });
});
