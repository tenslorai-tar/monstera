import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import type { CommandOfKind, DrawnEdit } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { applyEditDrawnObject, editDrawnContent, sameDrawn } from './drawnObjectEdit.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { pageContentStreams, xobjectKinds } from './pageContent.js';
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
  page.node.set(
    PDFName.of('Resources'),
    context.obj({ Font: { F1: font.ref }, XObject: { Im1: picture, Fm1: group }, ExtGState: { Half: { Type: 'ExtGState', ca: 0.5, CA: 0.5 } } }),
  );
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
async function pdfjsReading(bytes: Uint8Array): Promise<{ images: number[][]; paths: number[][]; fills: string[]; painted: string[] }> {
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
    /** Everything painted, in the order PDF.js paints it, with the fill in force: `image [box]` or `path [box] #colour`. */
    const painted: string[] = [];
    let fill = '#000000';
    const fillStack: string[] = [];
    for (let at = 0; at < list.fnArray.length; at += 1) {
      const fn = list.fnArray[at];
      const args = list.argsArray[at] as unknown[];
      if (fn === pdfjs.OPS.save) {
        stack.push(ctm);
        fillStack.push(fill);
      } else if (fn === pdfjs.OPS.restore) {
        ctm = stack.pop() ?? ctm;
        fill = fillStack.pop() ?? fill;
      } else if (fn === pdfjs.OPS.transform) ctm = times(args as unknown as M, ctm);
      else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
        images.push(boxOf(ctm, 0, 0, 1, 1));
        painted.push(`image ${JSON.stringify(boxOf(ctm, 0, 0, 1, 1))}`);
      } else if (fn === pdfjs.OPS.paintFormXObjectBegin) {
        stack.push(ctm);
        const matrix = args[0] as M | null;
        if (matrix !== null) ctm = times(matrix, ctm);
      } else if (fn === pdfjs.OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
      else if (fn === pdfjs.OPS.setFillRGBColor) {
        fill = String(args[0]);
        fills.push(fill);
      } else if (fn === pdfjs.OPS.constructPath) {
        const minMax = args.at(-1) as ArrayLike<number> | null;
        if (minMax !== null && minMax.length === 4) {
          const box = boxOf(ctm, minMax[0] ?? 0, minMax[1] ?? 0, minMax[2] ?? 0, minMax[3] ?? 0);
          paths.push(box);
          painted.push(`path ${JSON.stringify(box)} ${fill}`);
        }
      }
    }
    return { images, paths, fills, painted };
  } finally {
    await task.destroy();
  }
}

const RED = [255, 0, 0] as const;
const GREEN = [0, 200, 0] as const;
const WHITE = [255, 255, 255] as const;
const YELLOW = [255, 255, 0] as const;
const BLUE = [0, 0, 255] as const;

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

describe('editDrawnObject — delete (ADR-0264 Decision 3)', () => {
  const remove = { op: 'delete' } as const;

  it('removes the red square: MuPDF draws paper there and PDF.js reads one path fewer, every other object as it was', async () => {
    const bytes = await edited(command('path', 0, SQUARE, remove));
    const pixels = await mupdfPixels(bytes);
    expect([pixels(40, 40), pixels(120, 40), pixels(40, 120), pixels(160, 160)]).toStrictEqual([WHITE, GREEN, YELLOW, [255, 0, 255]]);
    const control = await pdfjsReading(await fixture());
    const reading = await pdfjsReading(bytes);
    // CONTROL: the fixture's square is in PDF.js's reading, so its absence below is the removal's.
    expect(control.paths).toContainEqual([20, 20, 60, 60]);
    expect(reading.paths).toStrictEqual(control.paths.filter((path) => JSON.stringify(path) !== JSON.stringify([20, 20, 60, 60])));
    expect(reading.images).toStrictEqual(control.images);
  });

  it('removes the picture; PDF.js reads no picture and MuPDF draws paper where it was', async () => {
    const bytes = await edited(command('image', 0, PICTURE, remove));
    expect((await pdfjsReading(bytes)).images).toStrictEqual([]);
    expect((await mupdfPixels(bytes))(120, 40)).toStrictEqual(WHITE);
  });

  it('a shape that sets the clip loses its paint and keeps its clip: the yellow still shows inside it alone', async () => {
    const bytes = await edited(command('path', 1, CLIPPER, remove));
    expect(new TextDecoder('latin1').decode(await savedContent(bytes))).toContain('20 100 40 40 re W n');
    const pixels = await mupdfPixels(bytes);
    expect([pixels(40, 120), pixels(100, 120)]).toStrictEqual([YELLOW, WHITE]);
  });
});

describe('editDrawnObject — arrange (ADR-0264 Decision 3)', () => {
  /** A red square from 20 to 80 and the green picture over it from 50 to 110: the overlap shows green. */
  const OVERLAP = ['q 1 0 0 rg 20 20 60 60 re f Q', 'q 60 0 0 60 50 50 cm /Im1 Do Q'].join('\n');
  const RED_BOX = { left: 20, bottom: 20, right: 80, top: 80 };
  const GREEN_BOX = { left: 50, bottom: 50, right: 110, top: 110 };

  it('brings the red square forward past the picture: both engines draw it on top, after a save and a reopen', async () => {
    const before = await mupdfPixels(await fixture(OVERLAP));
    // CONTROL: the picture is on top where the two overlap.
    expect(before(65, 65)).toStrictEqual(GREEN);
    const bytes = await edited(command('path', 0, RED_BOX, { op: 'arrange', to: 'forward', past: { kind: 'image', ordinal: 0 } }), await fixture(OVERLAP));
    const after = await mupdfPixels(bytes);
    expect([after(65, 65), after(30, 30), after(100, 100)]).toStrictEqual([RED, RED, GREEN]);
    // PDF.js PAINTS THE PICTURE FIRST NOW, then the square in its own red.
    expect((await pdfjsReading(bytes)).painted).toStrictEqual(['image [50,50,110,110]', 'path [20,20,80,80] #ff0000']);
  });

  it('sends the picture backward past the square: the square shows over it', async () => {
    const bytes = await edited(command('image', 0, GREEN_BOX, { op: 'arrange', to: 'backward', past: { kind: 'path', ordinal: 0 } }), await fixture(OVERLAP));
    expect((await mupdfPixels(bytes))(65, 65)).toStrictEqual(RED);
    expect((await pdfjsReading(bytes)).painted).toStrictEqual(['image [50,50,110,110]', 'path [20,20,80,80] #ff0000']);
  });

  it('CARRIES THE STATE it was drawn under: a colour set before it, and the opacity in force past its neighbour reset', async () => {
    // THE SQUARE'S RED IS SET OUTSIDE IT, and past the picture the fill is blue and the opacity half.
    const content = ['1 0 0 rg 20 20 60 60 re f', '0 0 1 rg /Half gs', 'q 60 0 0 60 50 50 cm /Im1 Do Q', '120 120 30 30 re f'].join('\n');
    const bytes = await edited(command('path', 0, RED_BOX, { op: 'arrange', to: 'forward', past: { kind: 'image', ordinal: 0 } }), await fixture(content));
    const pixels = await mupdfPixels(bytes);
    // RED AND OPAQUE, where it was drawn red and opaque; CONTROL: the blue square after it is still half blue.
    expect([pixels(30, 30), pixels(65, 65)]).toStrictEqual([RED, RED]);
    expect(pixels(135, 135)).toStrictEqual((await mupdfPixels(await fixture(content)))(135, 135));
    const text = new TextDecoder('latin1').decode(await savedContent(bytes));
    expect(text).toMatch(/\/MonPlain1 gs/u);
  });

  it('carries the CLIP it stood in: moved past a picture outside its window, it is still cut to that window', async () => {
    const content = ['q 20 20 30 30 re W n 1 0 0 rg 20 20 60 60 re f 0 0 1 rg 150 150 10 10 re f Q', 'q 60 0 0 60 50 50 cm /Im1 Do Q'].join('\n');
    const bytes = await edited(command('path', 0, RED_BOX, { op: 'arrange', to: 'forward', past: { kind: 'image', ordinal: 0 } }), await fixture(content));
    const pixels = await mupdfPixels(bytes);
    // INSIDE ITS WINDOW it is red; outside it, where the picture is not, paper — as it was.
    expect([pixels(30, 30), pixels(70, 30)]).toStrictEqual([RED, WHITE]);
  });

  it('REFUSES at `cropped` where the new place clips to an area that does not hold it, and the page is unchanged', async () => {
    // THE PICTURE IS IN A WINDOW SHARED WITH A SHAPE, so the square past it would be drawn through that window.
    const content = ['q 1 0 0 rg 20 20 60 60 re f Q', 'q 50 50 60 60 re W n q 60 0 0 60 50 50 cm /Im1 Do Q 0 0 1 rg 100 100 5 5 re f Q'].join('\n');
    const session = await mupdfWriter.open(await fixture(content));
    try {
      const refusal = await applyEditDrawnObject(session, command('path', 0, RED_BOX, { op: 'arrange', to: 'forward', past: { kind: 'image', ordinal: 0 } })).catch(
        (error: unknown) => error,
      );
      expect(refusal).toMatchObject({ name: 'EditRefusedError', step: 'cropped' });
      const after = await withDocument(session, (document) => new TextDecoder('latin1').decode(joinedContent(pageContentStreams(document.findPage(0)))));
      expect(after.trim()).toBe(content);
      // CONTROL: the picture sent backward past the square lands outside every window, carries its own, and applies.
      await expect(
        applyEditDrawnObject(session, command('image', 0, GREEN_BOX, { op: 'arrange', to: 'backward', past: { kind: 'path', ordinal: 0 } })),
      ).resolves.toBeUndefined();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a shape that SETS THE CLIP leaves its clip where it stood and moves its paint: what followed is clipped as before', async () => {
    const content = ['0 0 1 rg 20 20 60 60 re W f', 'q 60 0 0 60 50 50 cm /Im1 Do Q'].join('\n');
    const before = await mupdfPixels(await fixture(content));
    const bytes = await edited(command('path', 0, RED_BOX, { op: 'arrange', to: 'forward', past: { kind: 'image', ordinal: 0 } }), await fixture(content));
    const after = await mupdfPixels(bytes);
    // THE PICTURE IS STILL CUT TO THE SQUARE (paper at 100, 100 as before), and the square is now over it.
    expect([after(100, 100), before(100, 100)]).toStrictEqual([WHITE, WHITE]);
    expect([after(65, 65), before(65, 65)]).toStrictEqual([BLUE, GREEN]);
  });

  it('a setting inside a marked-content wrapper STAYS where it stood: the shape after it keeps its colour', async () => {
    const content = ['/Artifact BMC 1 0 0 rg 20 20 60 60 re f EMC', 'q 60 0 0 60 50 50 cm /Im1 Do Q', '120 120 30 30 re f'].join('\n');
    const bytes = await edited(command('path', 0, RED_BOX, { op: 'arrange', to: 'forward', past: { kind: 'image', ordinal: 0 } }), await fixture(content));
    const pixels = await mupdfPixels(bytes);
    expect([pixels(65, 65), pixels(135, 135)]).toStrictEqual([RED, RED]);
  });

  it('refuses a neighbour on the wrong side at `object`; CONTROL: the same neighbour the other way applies', async () => {
    const session = await mupdfWriter.open(await fixture(OVERLAP));
    try {
      await expect(
        applyEditDrawnObject(session, command('path', 0, RED_BOX, { op: 'arrange', to: 'backward', past: { kind: 'image', ordinal: 0 } })),
      ).rejects.toMatchObject({ step: 'object' });
      await expect(
        applyEditDrawnObject(session, command('path', 0, RED_BOX, { op: 'arrange', to: 'forward', past: { kind: 'image', ordinal: 0 } })),
      ).resolves.toBeUndefined();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('goes past a neighbour with a TWIN of the same geometry: a fill and its outline, two objects with one path', async () => {
    // PATH 0 fills the square and PATH 1 outlines the same square, then the picture. Sent backward past path 1, the picture
    // goes between them. The read-back found the neighbour again by its geometry, met path 0 first, and refused a
    // correct arrange as "not on the other side of its neighbour" (42 of 44 arrange refusals over the owner's corpus).
    const content = ['q 0 1 0 rg 20 20 60 60 re f Q', 'q 0 0 0 RG 20 20 60 60 re S Q', 'q 60 0 0 60 50 50 cm /Im1 Do Q'].join('\n');
    const between = new TextDecoder('latin1').decode(
      await savedContent(await edited(command('image', 0, GREEN_BOX, { op: 'arrange', to: 'backward', past: { kind: 'path', ordinal: 1 } }), await fixture(content))),
    );
    expect(between.indexOf('re f')).toBeLessThan(between.indexOf('/Im1 Do'));
    expect(between.indexOf('/Im1 Do')).toBeLessThan(between.indexOf('re S'));
    // CONTROL: past path 0, the twin itself, it goes before both — the neighbour is the one named, not one with its shape.
    const before = new TextDecoder('latin1').decode(
      await savedContent(await edited(command('image', 0, GREEN_BOX, { op: 'arrange', to: 'backward', past: { kind: 'path', ordinal: 0 } }), await fixture(content))),
    );
    expect(before.indexOf('/Im1 Do')).toBeLessThan(before.indexOf('re f'));
  });

  it('reads an object back WITHIN TOLERANCE: a hair apart either side of a rounding edge is the same place', () => {
    // THE PAIR MEASURED over the owner's corpus: a shape arranged correctly, its carried CTM worked out again, read
    // 726.2909500038639 where it had been 726.29095 — four billionths of a point, and 726.29095 sits on the edge of a
    // ten-thousandth, so rounded and compared as text the two fell in different buckets.
    const at = (y: number) => ({ kind: 'path' as const, ctm: [1, 0, 0, 1, 0, 0] as const, points: [[19.174417, y], [35.031547, y]] as [number, number][] });
    expect(sameDrawn(at(726.29095), at(726.2909500038639))).toBe(true);
    // CONTROL: a hundredth of a point apart is a different place.
    expect(sameDrawn(at(726.29095), at(726.30095))).toBe(false);
  });

  it('goes past a TEXT object named by PDFium’s number for it', async () => {
    const content = ['q 1 0 0 rg 20 20 60 60 re f Q', 'BT /F1 40 Tf 0 1 0 rg 20 40 Td (HHH) Tj ET'].join('\n');
    const bytes = await edited(command('path', 0, RED_BOX, { op: 'arrange', to: 'forward', past: { kind: 'text', object: 0 } }), await fixture(content));
    const text = new TextDecoder('latin1').decode(await savedContent(bytes));
    expect(text.indexOf('(HHH) Tj')).toBeLessThan(text.indexOf('20 20 60 60 re f'));
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

  it('a shape that ALSO SETS THE CLIP moves its paint, and the clip it sets for what follows STAYS (ADR-0264, corrected)', async () => {
    const bytes = await edited(command('path', 1, CLIPPER, { op: 'place', moveBy: { x: 100, y: 0 }, scaleBy: { x: 1, y: 1 } }));
    const content = new TextDecoder('latin1').decode(await savedContent(bytes));
    // THE CLIP SAID AGAIN WHERE IT STOOD, painting nothing.
    expect(content).toContain('20 100 40 40 re W n');
    const before = await mupdfPixels(await fixture());
    const pixels = await mupdfPixels(bytes);
    // THE SHAPE IS PAINTED AT ITS NEW PLACE, in its own blue, where there was paper.
    expect([before(140, 120), pixels(140, 120)]).toStrictEqual([WHITE, BLUE]);
    // AND THE YELLOW DRAWN AFTER IT IS CUT AS BEFORE: through the old place, not the new. A clip that moved with the shape
    // would show the yellow at 140, 120 and paper at 40, 120, which is what Decision 3 as first built did.
    expect([pixels(40, 120), before(40, 120)]).toStrictEqual([YELLOW, YELLOW]);
    const reading = await pdfjsReading(bytes);
    expect(reading.paths).toContainEqual([120, 100, 160, 140]);
  });

  it('a picture moved WITH ITS WINDOW closes its wrap: the square drawn after it stays where it was, in its own red', async () => {
    // THE WINDOW HOLDS THE PICTURE ALONE, so it moves with it, and the window's span ends where its `Q` begins. The wrap's
    // closing `Q` set against that one read as `QQ`, an unknown token: the wrap never closed and the square after it was
    // drawn moved.
    const content = ['q 50 50 60 60 re W n q 60 0 0 60 50 50 cm /Im1 Do Q Q', 'q 1 0 0 rg 150 150 20 20 re f Q'].join('\n');
    const bytes = await edited(
      command('image', 0, { left: 50, bottom: 50, right: 110, top: 110 }, { op: 'place', moveBy: { x: 0, y: 30 }, scaleBy: { x: 1, y: 1 } }),
      await fixture(content),
    );
    const text = new TextDecoder('latin1').decode(await savedContent(bytes));
    expect(text).not.toMatch(/QQ/u);
    const before = await mupdfPixels(await fixture(content));
    const pixels = await mupdfPixels(bytes);
    // THE SQUARE WHERE IT WAS: red at its centre, paper 30 points above it — as before.
    expect([pixels(160, 160), pixels(160, 195)]).toStrictEqual([before(160, 160), before(160, 195)]);
    expect(pixels(160, 160)).toStrictEqual(RED);
    // AND THE PICTURE MOVED: green 30 points higher, paper where its bottom was.
    expect([pixels(80, 125), pixels(80, 60)]).toStrictEqual([GREEN, WHITE]);
  });

  it('copies every byte outside the object, and the text and every object’s kind in order', () => {
    const content = new TextEncoder().encode(CONTENT);
    const kinds = (name: string): 'image' | 'form' | undefined => (name === 'Im1' ? 'image' : name === 'Fm1' ? 'form' : undefined);
    const { content: after } = editDrawnContent(content, kinds, command('image', 0, PICTURE, { op: 'place', moveBy: { x: 5, y: 5 }, scaleBy: { x: 1, y: 1 } }));
    const text = new TextDecoder('latin1').decode(after);
    // THE ONLY CHANGE IS THE WRAP: everything before and after it is the fixture's own text.
    const wrap = /q [-\d. ]+ cm\n/u.exec(text);
    expect(wrap).not.toBeNull();
    // THE CLOSING `Q` HAS A LINE BREAK EACH SIDE, so it cannot run into the token after it.
    expect(text.replace(wrap?.[0] ?? '', '').replace('/Im1 Do\nQ\n', '/Im1 Do')).toBe(CONTENT);
    expect(showOperators(after).map((op) => op.object)).toStrictEqual(showOperators(content).map((op) => op.object));
    expect(drawnObjects(after, kinds).map((object) => object.kind)).toStrictEqual(drawnObjects(content, kinds).map((object) => object.kind));
  });

  it('places a shape on a page whose resources name no XObject at all (a null `/XObject` is not resolved)', async () => {
    const document = await PDFDocument.create({ updateMetadata: false });
    const page = document.addPage([200, 200]);
    page.node.set(PDFName.of('Resources'), document.context.obj({}));
    page.node.set(PDFName.of('Contents'), document.context.register(document.context.stream('q 1 0 0 rg 20 20 40 40 re f Q')));
    const bytes = await edited(command('path', 0, SQUARE, { op: 'place', moveBy: { x: 0, y: 30 }, scaleBy: { x: 1, y: 1 } }), await document.save());
    expect((await mupdfPixels(bytes))(40, 75)).toStrictEqual(RED);
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
