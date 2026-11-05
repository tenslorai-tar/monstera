import { degrees, PDFDocument, PDFName, type PDFRef } from '@cantoo/pdf-lib';
import * as mupdf from './mupdfRaw.js';
import { describe, expect, it } from 'vitest';

import type { ByteImage, MupdfSession } from './engineSeam.js';
import { applyAddAnnotation } from './pageAnnotations.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyApplyRedactions } from './pageRedact.js';

/**
 * Drawn line art under a Redact area mark, read back out of the SAVED FILE's content streams.
 *
 * ## The defect, and why every case reads operators rather than pixels
 *
 * Found by a live run on 2026-11-05: a curved stroked line — a drawn signature — wholly under a mark was still in the
 * saved copy's page content after Apply redactions, under the black box that hid it. A render shows a black box either
 * way, so the observable here is the path's own operators in the reopened file's content (the page's and every form it
 * draws), never a colour.
 *
 * Each fixture carries the line under test and, 300 points above it and far from every mark, the same line moved up:
 * the CONTROL that the reading can see a path MuPDF rewrote, so a reading blind to the format passes nothing.
 */

/** A page the size the live run used. */
const PAGE: readonly [number, number] = [612, 460];

/** The live run's line, verbatim: a drawn signature, round-capped, stroked at 1.6. */
const SIGNATURE =
  '100 62 m 118 92 124 88 128 64 c 134 48 146 88 158 68 c 170 50 180 82 196 68 c 212 56 232 78 270 72 c';

/** The same path moved up by `dy` points, so the control is the same shape far from the mark. */
function moved(path: string, dy: number): string {
  const tokens = path.split(' ');
  return tokens
    .map((token, index) => {
      if (!/^-?[\d.]+$/.test(token)) return token;
      // A coordinate pair is (x, y); count numbers since the last operator to know which this is.
      let numbersBefore = 0;
      for (let at = index - 1; at >= 0 && /^-?[\d.]+$/.test(tokens[at] ?? ''); at -= 1) numbersBefore += 1;
      return numbersBefore % 2 === 1 ? String(Number(token) + dy) : token;
    })
    .join(' ');
}

/** The Redact area the live run swept, widened to y 42 as its second sweep was: the whole line's ink is inside it. */
const OVER_LINE = { x0: 92, y0: 42, x1: 278, y1: 98 } as const;

/** How the path under test is painted, and with what. */
interface Painted {
  readonly path: string;
  /** Graphics state ahead of the path, e.g. `1 J 1.6 w`. */
  readonly state: string;
  /** `S` stroke, `f` fill, `B` both. */
  readonly paint: 'S' | 'f' | 'B';
}

/** The content a page or form draws: the path under test, and the same path far above it as the control. */
function drawing({ path, state, paint }: Painted): string {
  return [
    `q .1 .2 .45 RG .1 .2 .45 rg ${state} ${path} ${paint} Q`,
    `q .1 .2 .45 RG .1 .2 .45 rg ${state} ${moved(path, 300)} ${paint} Q`,
  ].join('\n');
}

interface Fixture {
  readonly painted: Painted;
  /** Drawn from inside a form XObject rather than the page's own stream. */
  readonly inForm?: boolean;
  /** The page's `/Rotate`. */
  readonly rotate?: 0 | 90 | 180 | 270;
}

async function fixture({ painted, inForm = false, rotate = 0 }: Fixture): Promise<ByteImage> {
  const document = await PDFDocument.create();
  const page = document.addPage([...PAGE]);
  if (rotate !== 0) page.setRotation(degrees(rotate));
  let content = drawing(painted);
  if (inForm) {
    const form = document.context.stream(content, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, PAGE[0], PAGE[1]],
    });
    page.node.setXObject(PDFName.of('Fx'), document.context.register(form));
    content = 'q /Fx Do Q';
  }
  const stream: PDFRef = document.context.register(document.context.stream(content));
  page.node.set(PDFName.of('Contents'), stream);
  return document.save({ useObjectStreams: false });
}

/** Every content stream the page draws: its own, and every form XObject reachable from its resources. */
function contentOf(document: mupdf.PDFDocument, index: number): string {
  const seen = new Set<number>();
  const parts: string[] = [];
  // A STREAM IS ASKED THROUGH ITS REFERENCE: MuPDF knows a stream by its object number, so a resolved one answers
  // `isStream()` false.
  const streamsOf = (object: mupdf.PDFObject): void => {
    if (object.isStream()) {
      parts.push(object.readStream().asString());
    } else if (object.isArray()) {
      for (let at = 0; at < object.length; at += 1) streamsOf(object.get(at));
    }
  };
  const formsOf = (resources: mupdf.PDFObject): void => {
    // MuPDF's null object belongs to no document and cannot be resolved, so absence is asked first.
    if (resources.isNull()) return;
    const listed = resources.resolve().get('XObject');
    if (listed.isNull()) return;
    const xobjects = listed.resolve();
    if (!xobjects.isDictionary()) return;
    xobjects.forEach((value) => {
      if (value.isIndirect()) {
        const number = value.asIndirect();
        if (seen.has(number)) return;
        seen.add(number);
      }
      if (!value.isStream() || value.get('Subtype').asName() !== 'Form') return;
      parts.push(value.readStream().asString());
      formsOf(value.get('Resources'));
    });
  };
  const page = document.loadPage(index).getObject();
  streamsOf(page.get('Contents'));
  formsOf(page.getInheritable('Resources'));
  return parts.join('\n').replace(/\s+/g, ' ');
}

/** The tail of a path — its last curve or line segment — as a token run, which is how it is found in a stream. */
function tailOf(path: string): string {
  // A closing `h` carries no coordinates, so the tail is the segment before it.
  const tokens = path.trim().replace(/ h$/, '').split(' ');
  const last = tokens.length - 1;
  let start = last - 1;
  while (start > 0 && /^-?[\d.]+$/.test(tokens[start - 1] ?? '')) start -= 1;
  return tokens.slice(start, last + 1).join(' ');
}

/** Marks `rect` with Redact area, applies with the dialog's defaults, saves, reopens, and answers the page's content. */
async function burnedIn(bytes: ByteImage, rect: { x0: number; y0: number; x1: number; y1: number } | null): Promise<string> {
  const session: MupdfSession = await mupdfWriter.open(bytes);
  try {
    if (rect !== null) {
      await applyAddAnnotation(session, {
        kind: 'addAnnotation',
        page: 0,
        stamp: { author: 'A. Tester', created: '2026-11-05T09:00:00.000Z' },
        annotation: { type: 'redact', over: 'region', rect, colour: [0.85, 0.15, 0.15], opacity: 1 },
      });
      // The dialog's defaults: a filled box, and only the covered part of a picture blanked.
      await applyApplyRedactions(session, {
        kind: 'applyRedactions',
        pages: 'all',
        cover: 'solid',
        images: 'pixels',
        keepTitle: false,
      });
    }
    const saved = await mupdfWriter.serialise(session);
    const again = await mupdfWriter.open(saved);
    try {
      return await withDocument(again, (document) => contentOf(document, 0));
    } finally {
      await mupdfWriter.close(again);
    }
  } finally {
    await mupdfWriter.close(session);
  }
}

/** The class: every shape of drawn line art the burn-in must take when the mark covers its ink. */
const CLASS: readonly (Fixture & { readonly name: string })[] = [
  { name: 'the live run’s curved signature, round caps, 1.6 wide', painted: { path: SIGNATURE, state: '1 J 1.6 w', paint: 'S' } },
  { name: 'a straight diagonal stroke', painted: { path: '100 50 m 270 90 l', state: '1.6 w', paint: 'S' } },
  { name: 'a straight level stroke', painted: { path: '100 70 m 270 70 l', state: '1.6 w', paint: 'S' } },
  { name: 'a filled curved shape', painted: { path: `${SIGNATURE} h`, state: '', paint: 'f' } },
  { name: 'a filled and stroked curved shape', painted: { path: `${SIGNATURE} h`, state: '1.6 w', paint: 'B' } },
  ...([0, 1, 2] as const).flatMap((cap) =>
    ([0, 1, 2] as const).map((join) => ({
      name: `the signature with line cap ${String(cap)} and line join ${String(join)}`,
      painted: { path: SIGNATURE, state: `${String(cap)} J ${String(join)} j 1.6 w`, paint: 'S' as const },
    })),
  ),
  { name: 'the signature drawn from inside a form XObject', painted: { path: SIGNATURE, state: '1 J 1.6 w', paint: 'S' }, inForm: true },
  { name: 'a thick stroke, 6 wide', painted: { path: SIGNATURE, state: '1 J 6 w', paint: 'S' } },
  ...([90, 180, 270] as const).map((rotate) => ({
    name: `the signature on a page turned ${String(rotate)} degrees`,
    painted: { path: SIGNATURE, state: '1 J 1.6 w', paint: 'S' as const },
    rotate,
  })),
];

/**
 * A picture of a signature: dark strokes on white, drawn twice — under the mark as `/ImA`, and 300 points above it as
 * `/ImB`, the control. A picture goes through MuPDF's image filter, not the path culler, so it is its own case.
 */
async function signaturePicture(): Promise<ByteImage> {
  const document = await PDFDocument.create();
  const page = document.addPage([...PAGE]);
  const [width, height] = [34, 10];
  const samples = new Uint8Array(width * height).fill(255);
  for (let x = 0; x < width; x += 1) samples[Math.round(5 + 3 * Math.sin(x / 3)) * width + x] = 0;
  const image = (): PDFRef =>
    document.context.register(
      document.context.stream(samples, {
        Type: 'XObject',
        Subtype: 'Image',
        Width: width,
        Height: height,
        ColorSpace: 'DeviceGray',
        BitsPerComponent: 8,
      }),
    );
  page.node.setXObject(PDFName.of('ImA'), image());
  page.node.setXObject(PDFName.of('ImB'), image());
  const content = 'q 170 0 0 50 100 45 cm /ImA Do Q\nq 170 0 0 50 100 345 cm /ImB Do Q';
  page.node.set(PDFName.of('Contents'), document.context.register(document.context.stream(content)));
  return document.save({ useObjectStreams: false });
}

/** A page whose content is `content` alone, with `resources` as its resource dictionary. */
async function pageOf(content: string, resources: (document: PDFDocument) => Record<string, unknown> = () => ({})): Promise<ByteImage> {
  const document = await PDFDocument.create();
  const page = document.addPage([...PAGE]);
  page.node.set(PDFName.of('Resources'), document.context.obj(resources(document) as never));
  page.node.set(PDFName.of('Contents'), document.context.register(document.context.stream(content)));
  return document.save({ useObjectStreams: false });
}

/** An axial gradient across the mark, painted with `sh` inside a clip — and the same one 300 points above. */
function gradientPage(): Promise<ByteImage> {
  const shading = (document: PDFDocument, dy: number): PDFRef =>
    document.context.register(
      document.context.obj({
        ShadingType: 2,
        ColorSpace: 'DeviceRGB',
        Coords: [100, 50 + dy, 270, 90 + dy],
        Function: { FunctionType: 2, Domain: [0, 1], C0: [1, 0, 0], C1: [0, 0, 1], N: 1 },
      }),
    );
  return pageOf('q 100 50 170 40 re W n /ShA sh Q\nq 100 350 170 40 re W n /ShB sh Q', (document) => ({
    Shading: { ShA: shading(document, 0), ShB: shading(document, 300) },
  }));
}

describe('Redact area over drawn line art, read back from the saved file', () => {
  it('CONTROL: unredacted, the saved file paints both gradients', async () => {
    const content = await burnedIn(await gradientPage(), null);
    expect(content).toMatch(/100 50 170 40 re W n \/\S+ sh/);
    expect(content).toMatch(/100 350 170 40 re W n \/\S+ sh/);
  });

  it('STATED: a gradient painted with `sh` wholly under the mark SURVIVES, because MuPDF has no rule for it', async () => {
    // MuPDF 1.28.0's burn-in culler (`culler` in source/pdf/pdf-clean.c) answers *keep* for every type but a path,
    // and no `line_art` value changes that: a shading is neither line art nor an image to it. Pinned so the day a
    // MuPDF release or a change here takes it, this case says so; the dialog's sentence must not claim it meanwhile.
    const content = await burnedIn(await gradientPage(), OVER_LINE);
    expect(content).toMatch(/100 50 170 40 re W n \/\S+ sh/);
    expect(content).toMatch(/100 350 170 40 re W n \/\S+ sh/);
  });

  it('REMOVES WHOLE a line that crosses the mark’s edge, so no part of it under the mark stays in the file', async () => {
    // A level line from x 40 to x 400 at y 70: its middle is under the mark and both ends are outside it. MuPDF cannot
    // cut a path at the mark, so the two answers are keep it all or take it all, and only the second leaves nothing
    // the mark covered.
    const content = await burnedIn(await pageOf('q 1.6 w 40 70 m 400 70 l S Q\nq 1.6 w 40 370 m 400 370 l S Q'), OVER_LINE);
    expect(content).not.toContain('400 70 l');
    expect(content).toContain('400 370 l');
  });

  it('STATED: a mitre-joined line whose ink stays 8 points clear of the mark is removed too', async () => {
    // THE PRICE of judging by MuPDF's box. The signature moved up 44 points: its lowest ink is at about y 106, the
    // mark's top is at 98, and the box MuPDF bounds it by reaches 16 points below its lowest control point (y 92).
    // Pinned so the owner's choice is made on a measured case, not a description of one.
    const near = moved(SIGNATURE, 44);
    const content = await burnedIn(await pageOf(`q 1.6 w ${near} S Q\nq 1.6 w ${moved(SIGNATURE, 300)} S Q`), OVER_LINE);
    expect(content).not.toContain(tailOf(near));
    expect(content).toContain(tailOf(moved(SIGNATURE, 300)));
  });

  it('STATED: a filled background the mark lies inside is removed whole', async () => {
    // The same rule from the other side: a rectangle filling the page touches every mark on it. Pinned for the owner.
    const content = await burnedIn(await pageOf('q .9 .9 1 rg 0 0 612 460 re f Q\nq 1.6 w 40 370 m 400 370 l S Q'), OVER_LINE);
    expect(content).not.toContain('0 0 612 460 re');
    expect(content).toContain('400 370 l');
  });

  it('CONTROL: unredacted, the saved file draws both pictures of the signature', async () => {
    const content = await burnedIn(await signaturePicture(), null);
    expect(content).toContain('/ImA Do');
    expect(content).toContain('/ImB Do');
  });

  it('REMOVES a picture of a signature wholly under the mark, and keeps the one the mark does not reach', async () => {
    const content = await burnedIn(await signaturePicture(), OVER_LINE);
    // BY PLACEMENT, NOT NAME: the burn-in renames the resources it keeps (measured: `/ImB` comes back as `/Im1`).
    expect(content).toMatch(/100 45 cm Q/);
    expect(content).not.toMatch(/100 45 cm \/\S+ Do/);
    expect(content).toMatch(/100 345 cm \/\S+ Do/);
  });

  for (const shape of CLASS) {
    it(`CONTROL: unredacted, the saved file carries ${shape.name} and its far copy`, async () => {
      const content = await burnedIn(await fixture(shape), null);
      expect(content).toContain(tailOf(shape.painted.path));
      expect(content).toContain(tailOf(moved(shape.painted.path, 300)));
    });

    it(`REMOVES ${shape.name} when the mark covers its ink, and keeps the copy the mark does not reach`, async () => {
      const content = await burnedIn(await fixture(shape), OVER_LINE);
      expect(content).not.toContain(tailOf(shape.painted.path));
      // THE FAR COPY STAYS: a burn-in that emptied the page would pass the line above.
      expect(content).toContain(tailOf(moved(shape.painted.path, 300)));
    });
  }
});
