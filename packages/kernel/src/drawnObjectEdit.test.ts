import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import type { CommandOfKind, DrawnEdit } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { applyEditDrawnObject, editDrawnContent, xobjectKinds } from './drawnObjectEdit.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { pageContentStreams } from './pageContent.js';
import { rasterisePageRgba } from './pageImages.js';
import { EditRefusedError } from './textEditRefusals.js';
import { drawnObjects, joinedContent, showOperators } from './textOperators.js';

/**
 * ADR-0264's drawn-object writer, read back by BOTH engines from saved bytes: MuPDF by its own pixels, PDF.js by its
 * own reading of the content (its operator list). Each case's control is the page as it was, read the same way, so a
 * reader that saw nothing would fail the case rather than pass it.
 */

/** A 200 by 200 page: a line of text, a red square, a green picture, a blue shape that also clips, and a group. */
const CONTENT = [
  'BT /F1 12 Tf 20 180 Td (Hello) Tj ET',
  // PATH 0: a red square, 20 to 60 on both axes.
  'q 1 0 0 rg 20 20 40 40 re f Q',
  // IMAGE 0: a green picture, 100 to 140 across, 20 to 60 up.
  'q 40 0 0 40 100 20 cm /Im1 Do Q',
  // PATH 1, a blue square from 20 to 60 across and 100 to 140 up that ALSO SETS THE CLIP; PATH 2, a yellow page-sized
  // fill drawn through it.
  'q 0 0 1 rg 20 100 40 40 re W f 1 1 0 rg 0 0 200 200 re f Q',
  // FORM 0, a magenta square 140 to 180 across and up.
  'q 1 0 0 1 140 140 cm /Fm1 Do Q',
].join('\n');

async function fixture(content = CONTENT): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([200, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const context = document.context;
  const picture = context.register(
    context.stream(Uint8Array.of(0, 200, 0), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }),
  );
  const group = context.register(context.stream('1 0 1 rg 0 0 40 40 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 40, 40] }));
  page.node.set(PDFName.of('Resources'), context.obj({ Font: { F1: font.ref }, XObject: { Im1: picture, Fm1: group } }));
  page.node.set(PDFName.of('Contents'), context.register(context.stream(content)));
  return document.save({ useObjectStreams: false });
}

type Session = Awaited<ReturnType<typeof mupdfWriter.open>>;

/** The command, with the version and index every case shares. */
function command(
  object: CommandOfKind<'editDrawnObject'>['object'],
  ordinal: number,
  box: CommandOfKind<'editDrawnObject'>['box'],
  edit: DrawnEdit,
): CommandOfKind<'editDrawnObject'> {
  return { kind: 'editDrawnObject', page: 0, index: 0, object, ordinal, box, edit, version: asDocVersion(1) };
}

const SQUARE = { left: 20, bottom: 20, right: 60, top: 60 };
const PICTURE = { left: 100, bottom: 20, right: 140, top: 60 };
const CLIPPER = { left: 20, bottom: 100, right: 60, top: 140 };

/** Applies `edit` to the fixture, saves, and reopens: every read below is of the SAVED bytes. */
async function edited(edit: CommandOfKind<'editDrawnObject'>, bytes?: Uint8Array): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes ?? (await fixture()));
  try {
    await applyEditDrawnObject(session, edit);
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** MuPDF's own pixels of the page at one point a pixel, as `[r, g, b]` at a point in PDF space. */
async function mupdfPixels(bytes: Uint8Array): Promise<(x: number, y: number) => readonly [number, number, number]> {
  const session: Session = await mupdfWriter.open(bytes);
  try {
    const image = await rasterisePageRgba(session, 0, 1);
    return (x, y) => {
      const at = ((image.height - 1 - Math.floor(y)) * image.width + Math.floor(x)) * 4;
      return [image.rgba[at] ?? -1, image.rgba[at + 1] ?? -1, image.rgba[at + 2] ?? -1];
    };
  } finally {
    await mupdfWriter.close(session);
  }
}

/** The page's content as MuPDF holds it, joined. */
async function savedContent(bytes: Uint8Array): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0))));
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * PDF.js's reading of the page: each image it paints, as the box of its unit square under the matrix it tracks, and
 * each path it fills or strokes, as the box PDF.js itself computed for it, in page space.
 */
async function pdfjsReading(bytes: Uint8Array): Promise<{ images: number[][]; paths: number[][]; fills: string[] }> {
  const entry = createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = (await import(/* @vite-ignore */ pathToFileURL(entry).href)) as typeof import('pdfjs-dist');
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  try {
    const document = await task.promise;
    const page = await document.getPage(1);
    const list = await page.getOperatorList({ intent: 'print' });
    type M = [number, number, number, number, number, number];
    let ctm: M = [1, 0, 0, 1, 0, 0];
    const stack: M[] = [];
    const times = (m: M, n: M): M => [
      m[0] * n[0] + m[1] * n[2],
      m[0] * n[1] + m[1] * n[3],
      m[2] * n[0] + m[3] * n[2],
      m[2] * n[1] + m[3] * n[3],
      m[4] * n[0] + m[5] * n[2] + n[4],
      m[4] * n[1] + m[5] * n[3] + n[5],
    ];
    const boxOf = (m: M, x0: number, y0: number, x1: number, y1: number): number[] => {
      const points = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x = 0, y = 0]) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]]);
      const round = (value: number): number => Math.round(value * 100) / 100;
      return [Math.min(...points.map((p) => p[0] ?? 0)), Math.min(...points.map((p) => p[1] ?? 0)), Math.max(...points.map((p) => p[0] ?? 0)), Math.max(...points.map((p) => p[1] ?? 0))].map(round);
    };
    const images: number[][] = [];
    const paths: number[][] = [];
    const fills: string[] = [];
    for (let at = 0; at < list.fnArray.length; at += 1) {
      const fn = list.fnArray[at];
      const args = list.argsArray[at] as unknown[];
      if (fn === pdfjs.OPS.save) stack.push(ctm);
      else if (fn === pdfjs.OPS.restore) ctm = stack.pop() ?? ctm;
      else if (fn === pdfjs.OPS.transform) ctm = times(args as unknown as M, ctm);
      else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) images.push(boxOf(ctm, 0, 0, 1, 1));
      else if (fn === pdfjs.OPS.paintFormXObjectBegin) {
        stack.push(ctm);
        const matrix = args[0] as M | null;
        if (matrix !== null) ctm = times(matrix, ctm);
      } else if (fn === pdfjs.OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
      else if (fn === pdfjs.OPS.setFillRGBColor) fills.push(String(args[0]));
      else if (fn === pdfjs.OPS.constructPath) {
        const minMax = args.at(-1) as ArrayLike<number> | null;
        if (minMax !== null && minMax.length === 4) paths.push(boxOf(ctm, minMax[0] ?? 0, minMax[1] ?? 0, minMax[2] ?? 0, minMax[3] ?? 0));
      }
    }
    return { images, paths, fills };
  } finally {
    await task.destroy();
  }
}

const RED = [255, 0, 0] as const;
const GREEN = [0, 200, 0] as const;
const WHITE = [255, 255, 255] as const;
const YELLOW = [255, 255, 0] as const;

describe('editDrawnObject — recolour (ADR-0264 Decision 3)', () => {
  const blue = { op: 'recolor', colour: { r: 0, g: 0, b: 255 } } as const;

  it('draws the red square blue: MuPDF’s pixels and PDF.js’s fill both read the new colour, after a save and a reopen', async () => {
    const bytes = await edited(command('path', 0, SQUARE, blue));
    const pixels = await mupdfPixels(bytes);
    expect(pixels(40, 40)).toStrictEqual([0, 0, 255]);
    // EVERY OTHER OBJECT in its own colour: the picture and the yellow.
    expect([pixels(120, 40), pixels(40, 120)]).toStrictEqual([GREEN, YELLOW]);
    const reading = await pdfjsReading(bytes);
    const control = await pdfjsReading(await fixture());
    // CONTROL: the fixture's square is filled red, so the reader sees the fill it is asked about.
    expect(control.fills).toContain('#ff0000');
    expect(reading.fills).toContain('#0000ff');
    expect(reading.paths).toStrictEqual(control.paths);
  });

  it('a shape that sets the clip keeps its clip: painted blue once, then said again as the clip, the yellow still through it', async () => {
    const bytes = await edited(command('path', 1, CLIPPER, { op: 'recolor', colour: { r: 0, g: 128, b: 0 } }));
    const text = new TextDecoder('latin1').decode(await savedContent(bytes));
    expect(text).toContain('q 0 0.5019607843 0 rg\n20 100 40 40 re f\nQ\n20 100 40 40 re W n');
    const pixels = await mupdfPixels(bytes);
    // THE CLIP IS THE ONE IT SET: the yellow drawn after it still shows inside it and nowhere else.
    expect([pixels(40, 120), pixels(100, 120)]).toStrictEqual([YELLOW, WHITE]);
  });

  it('a stroked shape is recoloured in its stroke; CONTROL: a filled one in its fill', () => {
    const kinds = (): undefined => undefined;
    const stroked = editDrawnContent(
      new TextEncoder().encode('q 1 0 0 RG 10 10 m 50 50 l S Q'),
      kinds,
      command('path', 0, { left: 10, bottom: 10, right: 50, top: 50 }, blue),
    );
    expect(new TextDecoder('latin1').decode(stroked.content)).toBe('q 1 0 0 RG q 0 0 1 RG\n10 10 m 50 50 l S\nQ Q');
    const filled = editDrawnContent(new TextEncoder().encode('10 10 40 40 re f'), kinds, command('path', 0, { left: 10, bottom: 10, right: 50, top: 50 }, blue));
    expect(new TextDecoder('latin1').decode(filled.content)).toBe('q 0 0 1 rg\n10 10 40 40 re f\nQ');
  });
});

describe('editDrawnObject — place (ADR-0264 Decision 3)', () => {
  it('moves the red square 30 points up: MuPDF draws it there and not where it was, after a save and a reopen', async () => {
    const before = await mupdfPixels(await fixture());
    // CONTROL: the reader sees the square where the fixture put it, and paper where it will go.
    expect([before(40, 40), before(40, 75)]).toStrictEqual([RED, WHITE]);
    const after = await mupdfPixels(await edited(command('path', 0, SQUARE, { op: 'place', moveBy: { x: 0, y: 30 }, scaleBy: { x: 1, y: 1 } })));
    expect([after(40, 75), after(40, 25)]).toStrictEqual([RED, WHITE]);
    // EVERY OTHER OBJECT where it was: the picture, the clipped yellow, the group.
    expect([after(120, 40), after(40, 120), after(160, 160)]).toStrictEqual([GREEN, YELLOW, [255, 0, 255]]);
  });

  it('PDF.js reads the moved and resized picture at its new box, and every other object where it was', async () => {
    const before = await pdfjsReading(await fixture());
    expect(before.images).toStrictEqual([[100, 20, 140, 60]]);
    const reading = await pdfjsReading(
      await edited(command('image', 0, PICTURE, { op: 'place', moveBy: { x: -10, y: 50 }, scaleBy: { x: 1.5, y: 0.5 } })),
    );
    // SCALED ABOUT ITS LOWER-LEFT CORNER, then moved: 60 wide and 20 tall from (90, 70).
    expect(reading.images).toStrictEqual([[90, 70, 150, 90]]);
    expect(reading.paths).toStrictEqual(before.paths);
  });

  it('a shape that ALSO SETS THE CLIP is moved in place, and its clip moves with it: no wrap, the same yellow through it', async () => {
    const bytes = await edited(command('path', 1, CLIPPER, { op: 'place', moveBy: { x: 100, y: 0 }, scaleBy: { x: 1, y: 1 } }));
    const content = new TextDecoder('latin1').decode(await savedContent(bytes));
    // NOT WRAPPED: no `q … cm` was added around it, which a `Q` would have ended the clip with.
    expect(content).not.toMatch(/q [-\d. ]+ cm\s+120 100 40 40 re/u);
    expect(content).toContain('120 100 40 40 re W f');
    const pixels = await mupdfPixels(bytes);
    // THE CLIP MOVED WITH IT: the yellow drawn after it shows through the new place and not the old one.
    expect([pixels(140, 120), pixels(40, 120)]).toStrictEqual([YELLOW, WHITE]);
    const reading = await pdfjsReading(bytes);
    expect(reading.paths).toContainEqual([120, 100, 160, 140]);
  });

  it('copies every byte outside the object, and the text and every object’s kind in order', () => {
    const content = new TextEncoder().encode(CONTENT);
    const kinds = (name: string): 'image' | 'form' | undefined => (name === 'Im1' ? 'image' : name === 'Fm1' ? 'form' : undefined);
    const { content: after } = editDrawnContent(content, kinds, command('image', 0, PICTURE, { op: 'place', moveBy: { x: 5, y: 5 }, scaleBy: { x: 1, y: 1 } }));
    const text = new TextDecoder('latin1').decode(after);
    // THE ONLY CHANGE IS THE WRAP: everything before and after it is the fixture's own text.
    const wrap = /q [-\d. ]+ cm\n/u.exec(text);
    expect(wrap).not.toBeNull();
    expect(text.replace(wrap?.[0] ?? '', '').replace('/Im1 Do\nQ', '/Im1 Do')).toBe(CONTENT);
    expect(showOperators(after).map((op) => op.object)).toStrictEqual(showOperators(content).map((op) => op.object));
    expect(drawnObjects(after, kinds).map((object) => object.kind)).toStrictEqual(drawnObjects(content, kinds).map((object) => object.kind));
  });

  it('refuses an object that is not where the listing put it, at the step `object`, and the page is unchanged', async () => {
    const bytes = await fixture();
    const session = await mupdfWriter.open(bytes);
    try {
      const elsewhere = command('path', 0, { left: 120, bottom: 120, right: 160, top: 160 }, { op: 'place', moveBy: { x: 1, y: 1 }, scaleBy: { x: 1, y: 1 } });
      const refusal = await applyEditDrawnObject(session, elsewhere).catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(EditRefusedError);
      expect(refusal).toMatchObject({ step: 'object' });
      // NOTHING WAS WRITTEN: the content is the fixture's, byte for byte.
      const kinds = await withDocument(session, (document) => xobjectKinds(document.findPage(0)));
      const content = await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0))));
      expect(new TextDecoder('latin1').decode(content).trim()).toBe(CONTENT);
      expect(kinds('Im1')).toBe('image');
      // CONTROL: the same command at the listed box is applied, so the refusal above is the box's.
      await expect(applyEditDrawnObject(session, { ...elsewhere, box: SQUARE })).resolves.toBeUndefined();
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
