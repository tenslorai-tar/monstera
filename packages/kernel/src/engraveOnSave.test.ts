import { PDFDocument, PDFName, PDFString, degrees } from '@cantoo/pdf-lib';
import {
  type AnnotationDraft,
  type AnnotationRect,
  BUILT_IN_STAMPS,
  BUILT_IN_STAMP_NAME,
  type CommandOfKind,
  type DrawableSignature,
  outlineOpCodes,
  placedMarkOf,
} from '@monstera/contract';
import { zlibSync } from 'fflate';
import forge from 'node-forge';
import { describe, expect, it } from 'vitest';

import type { ByteImage, MupdfSession } from './engineSeam.js';
import { engraveForGood } from './engraveOnSave.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter } from './mupdfWriter.js';
import {
  applyAddAnnotation,
  applyPlaceImage,
  applyPlaceSignatureMark,
  applyPlaceSignaturePicture,
  readAnnotations,
} from './pageAnnotations.js';
import { applyApplyRedactions } from './pageRedact.js';
import { readSignatures } from './signatureRead.js';
import { applySignDocument } from './signpdfWriter.js';

/**
 * A placed signature, picture or barcode is part of the page in a saved file (ADR-0287), read from the SAVED file after
 * a reopen. Every case compares the engraved save with the same session saved as held, which is the control: what the
 * layer drew is what the page must now draw, and the held save still carries the layer the engraved one must not.
 */

const STAMP = { author: 'Priya Raman', created: '2026-11-06T09:00:00.000Z' } as const;
const BOX: AnnotationRect = { x0: 100, y0: 100, x1: 300, y1: 180 };

/** A PNG with an alpha ramp, built byte by byte (B10: nothing committed), `w` by `h`. */
function alphaPng(w: number, h: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Uint8Array): number => {
    let c = 0xffffffff;
    for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, w);
  hv.setUint32(4, h);
  header[8] = 8;
  header[9] = 6;
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const at = y * (w * 4 + 1) + 1 + x * 4;
      raw[at] = 20;
      raw[at + 1] = 40;
      raw[at + 2] = 160;
      raw[at + 3] = Math.round((255 * x) / Math.max(1, w - 1));
    }
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const typed: DrawableSignature = {
  kind: 'outlined',
  text: 'Grace Hopper',
  font: 'great-vibes',
  outline: {
    ops: outlineOpCodes('MLLLZMLQZ'),
    points: [0, 100, 1000, 100, 1000, 400, 0, 400, 0, 440, 1000, 440, 500, 500, 0, 440],
    frame: [0, 0, 1000, 500],
  },
};
const drawn: DrawableSignature = {
  kind: 'drawn',
  strokes: [
    [
      [0.05, 0.1],
      [0.5, 0.3],
      [0.95, 0.05],
    ],
  ],
};

interface Saves {
  /** The session saved as held: the layer, which is what a save wrote before ADR-0287. */
  readonly held: ByteImage;
  /** The same session saved as a file a person keeps. */
  readonly engraved: ByteImage;
  /** The session's own annotations after the engraved save: the layer it keeps. */
  readonly sessionAfter: readonly string[];
}

async function onSession<T>(bytes: ByteImage, work: (session: MupdfSession) => Promise<T>): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await work(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Runs `place` on a session of `bytes`, then saves it as held and engraved. */
async function saves(bytes: ByteImage, place: (session: MupdfSession) => Promise<void>): Promise<Saves> {
  return onSession(bytes, async (session) => {
    await place(session);
    const held = await mupdfWriter.serialise(session);
    const engraved = await mupdfWriter.serialise(session, { marks: 'engraved' });
    const reread = await mupdfWriter.serialise(session);
    return { held, engraved, sessionAfter: subtypes(reread, 0) };
  });
}

function opened<T>(bytes: ByteImage, read: (document: mupdf.PDFDocument) => T): T {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  try {
    if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
    return read(document);
  } finally {
    document.destroy();
  }
}

/** Each annotation's subtype and name on page `index`, as `Stamp/Image`, after a reopen. */
function subtypes(bytes: ByteImage, index: number): string[] {
  return opened(bytes, (document) => {
    const annots = document.findPage(index).get('Annots');
    const out: string[] = [];
    if (annots.isArray()) annots.forEach((each) => out.push(`${String(each.get('Subtype')).slice(1)}/${String(each.get('Name')).slice(1)}`));
    return out;
  });
}

/** Page `index` rendered at 2× in RGB, annotations drawn, and its size. */
function render(bytes: ByteImage, index = 0): { readonly width: number; readonly height: number; readonly samples: Uint8Array } {
  return opened(bytes, (document) => {
    const pixmap = document.loadPage(index).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
    return { width: pixmap.getWidth(), height: pixmap.getHeight(), samples: Uint8Array.from(pixmap.getPixels()) };
  });
}

/** How many samples differ by more than `tolerance`, and the most one differs. */
function difference(a: ReturnType<typeof render>, b: ReturnType<typeof render>, tolerance = 8): { readonly differing: number; readonly worst: number } {
  expect([a.width, a.height]).toStrictEqual([b.width, b.height]);
  let differing = 0;
  let worst = 0;
  for (let at = 0; at < a.samples.length; at += 1) {
    const d = Math.abs((a.samples[at] ?? 0) - (b.samples[at] ?? 0));
    worst = Math.max(worst, d);
    if (d > tolerance) differing += 1;
  }
  return { differing, worst };
}

/** Samples not white: something is drawn. */
function painted(page: ReturnType<typeof render>): number {
  let count = 0;
  for (const sample of page.samples) if (sample < 240) count += 1;
  return count;
}

/** A page `size` wide, turned `turn`, with `content` and a CropBox `crop` if given. */
async function pageOf(options: { turn?: number; content?: string; crop?: readonly number[]; pages?: number } = {}): Promise<ByteImage> {
  const document = await PDFDocument.create();
  for (let at = 0; at < (options.pages ?? 1); at += 1) {
    const page = document.addPage([400, 600]);
    page.setRotation(degrees(options.turn ?? 0));
    if (options.content !== undefined) page.node.set(PDFName.of('Contents'), document.context.register(document.context.stream(options.content)));
    if (options.crop !== undefined) page.node.set(PDFName.of('CropBox'), document.context.obj([...options.crop]));
  }
  return document.save({ useObjectStreams: false });
}

const picture = (pages: readonly number[] = [0], rect: AnnotationRect = BOX, bytes = alphaPng(60, 30)) => async (session: MupdfSession) =>
  applyPlaceImage(session, { kind: 'placeImage', pages: [...pages], rect, bytes, stamp: STAMP });
const signature = (mark: DrawableSignature, rect: AnnotationRect = BOX) => async (session: MupdfSession) =>
  applyPlaceSignatureMark(session, { kind: 'placeSignatureMark', page: 0, rect, mark: placedMarkOf(mark), stamp: STAMP });

/** The rule for one save: the layer is gone, the page draws what the layer drew, and the session kept its layer. */
function holdsTheRule(result: Saves, page = 0): void {
  // CONTROL: the held save is the layer.
  expect(subtypes(result.held, page)).toContain('Stamp/Image');
  expect(subtypes(result.engraved, page).filter((each) => each === 'Stamp/Image' || each === 'Stamp/Signature')).toStrictEqual([]);
  const layer = render(result.held, page);
  expect(painted(layer), 'the layer draws something').toBeGreaterThan(500);
  expect(difference(layer, render(result.engraved, page)).differing, 'the engraved page draws what the layer drew').toBe(0);
  expect(result.sessionAfter, 'the session keeps its layer after the save').toContain('Stamp/Image');
}

describe('a placed picture is part of the page in a saved file (ADR-0287)', () => {
  for (const turn of [0, 90, 180, 270]) {
    it(`a transparent picture on a page turned ${String(turn)}`, async () => {
      holdsTheRule(await saves(await pageOf({ turn }), picture()));
    });
  }

  it('a CropBox whose origin is not zero', async () => {
    holdsTheRule(await saves(await pageOf({ crop: [50, 70, 380, 560] }), picture()));
  });

  it('page content that leaves the graphics state changed: the picture still lands where its layer did', async () => {
    // NO q/Q: the content leaves a scale and a fill colour behind.
    const result = await saves(await pageOf({ content: '2 0 0 2 0 0 cm 0 0.6 0 rg 10 10 40 40 re f' }), picture());
    holdsTheRule(result);
    // AND THE CONTENT ITSELF IS KEPT, byte for byte, in its own stream.
    const streams = opened(result.engraved, (document) => {
      const contents = document.findPage(0).get('Contents');
      const out: string[] = [];
      contents.forEach((stream) => out.push(stream.readStream().asString()));
      return out;
    });
    expect(streams).toContain('2 0 0 2 0 0 cm 0 0.6 0 rg 10 10 40 40 re f');
  });

  it('a page whose /Contents and /Resources are shared with another: the other page is unchanged', async () => {
    const document = await PDFDocument.create();
    const shared = document.context.register(document.context.stream('0 0 1 rg 300 500 50 50 re f'));
    const resources = document.context.register(document.context.obj({ ProcSet: [PDFName.of('PDF')] }));
    for (let at = 0; at < 2; at += 1) {
      const page = document.addPage([400, 600]);
      page.node.set(PDFName.of('Contents'), shared);
      page.node.set(PDFName.of('Resources'), resources);
    }
    const bytes = await document.save({ useObjectStreams: false });
    const result = await saves(bytes, picture([0]));
    holdsTheRule(result);
    expect(difference(render(bytes, 1), render(result.engraved, 1)).differing, 'the other page').toBe(0);
    // ITS KEYS TOO: page 2 still reads the shared stream alone and names no mark.
    opened(result.engraved, (document) => {
      const other = document.findPage(1);
      expect(other.get('Contents').isArray()).toBe(false);
      expect(other.getInheritable('Resources').get('XObject').isNull()).toBe(true);
    });
  });

  it('a name the page already uses: the mark takes another, and the page’s own picture is still drawn', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([400, 600]);
    const form = document.context.register(
      document.context.stream('1 0 0 rg 0 0 10 10 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10] }),
    );
    page.node.set(PDFName.of('Resources'), document.context.obj({ XObject: { MonsteraEngraved1: form } }));
    page.node.set(PDFName.of('Contents'), document.context.register(document.context.stream('q 5 0 0 5 300 400 cm /MonsteraEngraved1 Do Q')));
    holdsTheRule(await saves(await document.save({ useObjectStreams: false }), picture()));
  });

  it('several on one page, and one picture on many pages held once', async () => {
    const result = await saves(await pageOf({ pages: 3 }), async (session) => {
      await picture([0, 1, 2])(session);
      await picture([0], { x0: 50, y0: 300, x1: 150, y1: 360 }, alphaPng(20, 20))(session);
    });
    for (const page of [0, 1, 2]) holdsTheRule(result, page);
    // ONE IMAGE OBJECT for the picture on three pages, and one for the second: no copy per page.
    const images = opened(result.engraved, (document) => {
      let count = 0;
      for (let at = 1; at < document.countObjects(); at += 1) {
        const object = document.newIndirect(at);
        if (object.isStream() && String(object.get('Subtype')) === '/Image' && object.get('SMask').isIndirect()) count += 1;
      }
      return count;
    });
    expect(images).toBe(2);
  });

  it('saved twice, and saved again after a reopen: the picture is drawn once', async () => {
    const twice = await onSession(await pageOf(), async (session) => {
      await picture()(session);
      await mupdfWriter.serialise(session, { marks: 'engraved' });
      return mupdfWriter.serialise(session, { marks: 'engraved' });
    });
    const again = await onSession(twice, (session) => mupdfWriter.serialise(session, { marks: 'engraved' }));
    for (const bytes of [twice, again]) {
      const draws = opened(bytes, (document) => {
        let text = '';
        document.findPage(0).get('Contents').forEach((stream) => (text += stream.readStream().asString()));
        return (text.match(/MonsteraEngraved\d+ Do/gu) ?? []).length;
      });
      expect(draws).toBe(1);
    }
  });

  it('after a Save the session still LISTS the picture, so it can be selected and moved until the document closes', async () => {
    const listed = await onSession(await pageOf(), async (session) => {
      await picture()(session);
      const before = (await readAnnotations(session)).annotations.length;
      await mupdfWriter.serialise(session, { marks: 'engraved' });
      return { before, after: (await readAnnotations(session)).annotations.length };
    });
    expect(listed).toEqual({ before: 1, after: 1 });
  });

  it('a file saved earlier with the picture as a layer is engraved when saved again', async () => {
    const earlier = (await saves(await pageOf(), picture())).held;
    const later = await onSession(earlier, (session) => mupdfWriter.serialise(session, { marks: 'engraved' }));
    expect(subtypes(earlier, 0)).toContain('Stamp/Image');
    expect(subtypes(later, 0)).toStrictEqual([]);
    expect(difference(render(earlier), render(later)).differing).toBe(0);
  });
});

describe('a plain signature is part of the page in a saved file', () => {
  for (const [look, mark] of [
    ['typed', typed],
    ['drawn', drawn],
  ] as const) {
    it(`a ${look} signature`, async () => {
      const result = await saves(await pageOf(), signature(mark));
      expect(subtypes(result.held, 0)).toStrictEqual(['Stamp/Signature']);
      expect(subtypes(result.engraved, 0)).toStrictEqual([]);
      expect(difference(render(result.held), render(result.engraved)).differing).toBe(0);
      expect(painted(render(result.engraved))).toBeGreaterThan(100);
    });
  }

  it('a picture signature', async () => {
    const result = await saves(await pageOf(), (session) =>
      applyPlaceSignaturePicture(session, { kind: 'placeSignaturePicture', page: 0, rect: BOX, bytes: alphaPng(80, 30), mediaType: 'image/png', stamp: STAMP }),
    );
    expect(subtypes(result.held, 0)).toStrictEqual(['Stamp/Signature']);
    expect(subtypes(result.engraved, 0)).toStrictEqual([]);
    expect(difference(render(result.held), render(result.engraved)).differing).toBe(0);
  });
});

/** Each annotation on page `index` after a reopen, as its subtype and the key that tells its kind apart. */
function kinds(bytes: ByteImage, index = 0): string[] {
  return opened(bytes, (document) => {
    const annots = document.findPage(index).get('Annots');
    const out: string[] = [];
    const name = (value: mupdf.PDFObject): string => (value.isName() ? value.asName() : '-');
    if (annots.isArray()) annots.forEach((each) => out.push(`${name(each.get('Subtype'))}/${name(each.get('Name'))}/${name(each.get('IT'))}`));
    return out;
  });
}

const added = (annotation: CommandOfKind<'addAnnotation'>['annotation']) => async (session: MupdfSession) => {
  await applyAddAnnotation(session, { kind: 'addAnnotation', page: 0, stamp: STAMP, annotation });
};

type Draft<T extends AnnotationDraft['type']> = Extract<AnnotationDraft, { type: T }>;
const WORDS = { colour: [0.1, 0.1, 0.4], opacity: 1, fontSize: 14, font: 'sans', direction: 'left-to-right' } satisfies Omit<Draft<'text-box'>, 'type' | 'rect' | 'text'>;
const TEXT_BOX: Draft<'text-box'> = { type: 'text-box', rect: BOX, text: 'Received 12 November', ...WORDS };
const TYPEWRITER: Draft<'typewriter'> = { type: 'typewriter', rect: { x0: 60, y0: 300, x1: 300, y1: 330 }, text: 'Paid in full', ...WORDS };
const CALLOUT: Draft<'callout'> = { type: 'callout', rect: { x0: 200, y0: 400, x1: 360, y1: 450 }, at: { x: 120, y: 520 }, text: 'See here', ...WORDS };
const APPROVED: Draft<'stamp'> = { type: 'stamp', stamp: 'approved', rect: BOX, colour: [0.8, 0, 0], opacity: 1 };

describe('a word stamp, typewriter text and a text box are part of the page in a saved file (Group 6)', () => {
  const cases = [
    ...BUILT_IN_STAMPS.map((stamp) => ({
      label: `the ${stamp} stamp`,
      place: added({ type: 'stamp', stamp, rect: BOX, colour: [0.8, 0, 0], opacity: 1 }),
      kind: `Stamp/${BUILT_IN_STAMP_NAME[stamp]}/-`,
    })),
    { label: 'typewriter text', place: added(TYPEWRITER), kind: 'FreeText/-/FreeTextTypeWriter' },
    { label: 'a text box', place: added(TEXT_BOX), kind: 'FreeText/-/-' },
  ];
  for (const { label, place, kind } of cases) for (const turn of [0, 90]) {
    it(`${label}, on a page turned ${String(turn)}`, async () => {
      const result = await onSession(await pageOf({ turn }), async (session) => {
        await place(session);
        const held = await mupdfWriter.serialise(session);
        const engraved = await mupdfWriter.serialise(session, { marks: 'engraved' });
        return { held, engraved, after: kinds(await mupdfWriter.serialise(session)) };
      });
      // CONTROL: the held save is the layer, and it draws something.
      expect(kinds(result.held)).toStrictEqual([kind]);
      const layer = render(result.held);
      expect(painted(layer), 'the layer draws something').toBeGreaterThan(200);
      expect(kinds(result.engraved), 'no layer is left for it').toStrictEqual([]);
      expect(difference(layer, render(result.engraved)).differing, 'the page draws what the layer drew').toBe(0);
      expect(result.after, 'the session keeps its layer after the save').toStrictEqual([kind]);
    });
  }

  it('another producer’s stamp and text box, with no mark of ours, stay layers', async () => {
    const withMarks = async (ours: boolean): Promise<string[]> => {
      const document = await PDFDocument.create();
      const page = document.addPage([400, 600]);
      const appearance = document.context.register(document.context.stream('0 0 1 rg 0 0 100 50 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 50] }));
      const mark = (extra: Record<string, unknown>) =>
        document.context.register(
          document.context.obj({ Type: 'Annot', Rect: [100, 100, 200, 150], AP: { N: appearance }, T: PDFString.of('Other'), ...(ours ? { Monstera_Authored: true } : {}), ...extra }),
        );
      page.node.set(PDFName.of('Annots'), document.context.obj([mark({ Subtype: 'Stamp', Name: 'Approved' }), mark({ Subtype: 'FreeText', Contents: PDFString.of('theirs') })]));
      return kinds(await onSession(await document.save({ useObjectStreams: false }), (session) => mupdfWriter.serialise(session, { marks: 'engraved' })));
    };
    expect(await withMarks(false)).toStrictEqual(['Stamp/Approved/-', 'FreeText/-/-']);
    // CONTROL: the same two WITH our private mark are engraved, so the mark is what decided.
    expect(await withMarks(true)).toStrictEqual([]);
  });
});

describe('what stays a layer', () => {
  it('a callout, a comment, a highlight, a shape and a pen drawing stay layers; the stamp and the picture beside them are engraved', async () => {
    const result = await saves(await pageOf({ content: 'BT /F1 12 Tf 50 500 Td (Hello there) Tj ET' }), async (session) => {
      await picture()(session);
      await applyAddAnnotation(session, {
        kind: 'addAnnotation',
        page: 0,
        stamp: STAMP,
        annotation: { type: 'stamp', stamp: 'approved', rect: { x0: 50, y0: 400, x1: 200, y1: 450 }, colour: [0.8, 0, 0], opacity: 1 },
      });
      await added(CALLOUT)(session);
      await added({ type: 'square', rect: { x0: 20, y0: 20, x1: 80, y1: 60 }, colour: [1, 0, 0], opacity: 1, borderWidth: 2 })(session);
      await added({ type: 'ink', points: [{ x: 300, y: 50 }, { x: 330, y: 80 }, { x: 360, y: 50 }], colour: [0, 0, 1], opacity: 1, borderWidth: 2 })(session);
      await applyAddAnnotation(session, {
        kind: 'addAnnotation',
        page: 0,
        stamp: STAMP,
        annotation: { type: 'sticky-note', at: { x: 300, y: 300 }, text: 'A note', colour: [1, 0.8, 0], opacity: 1 },
      });
      await applyAddAnnotation(session, {
        kind: 'addAnnotation',
        page: 0,
        stamp: STAMP,
        annotation: { type: 'highlight', over: 'area', rect: { x0: 40, y0: 490, x1: 160, y1: 515 }, colour: [1, 1, 0], opacity: 0.5 },
      });
    });
    const held = kinds(result.held);
    const gone = ['Stamp/Image/-', 'Stamp/Approved/-'];
    // CONTROL: the held save carries both marks as layers.
    for (const each of gone) expect(held).toContain(each);
    const engraved = kinds(result.engraved);
    // EVERY OTHER ANNOTATION THE HELD SAVE HAS, the engraved one has too: the callout, square, ink, highlight and note.
    expect([...engraved].sort()).toStrictEqual(held.filter((each) => !gone.includes(each)).sort());
    expect(engraved).toContain('FreeText/-/FreeTextCallout');
    expect(engraved.length).toBeGreaterThanOrEqual(6);
  });

  it('another producer’s stamp named Image, with no mark of ours, stays a layer', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([400, 600]);
    const appearance = document.context.register(document.context.stream('0 0 1 rg 0 0 100 50 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 50] }));
    const foreign = document.context.register(
      document.context.obj({ Type: 'Annot', Subtype: 'Stamp', Name: 'Image', Rect: [100, 100, 200, 150], AP: { N: appearance }, T: PDFString.of('Other') }),
    );
    page.node.set(PDFName.of('Annots'), document.context.obj([foreign]));
    const bytes = await document.save({ useObjectStreams: false });
    const result = await onSession(bytes, (session) => mupdfWriter.serialise(session, { marks: 'engraved' }));
    expect(subtypes(result, 0)).toStrictEqual(['Stamp/Image']);
    // CONTROL: the same stamp WITH our private mark is engraved, so the mark is what decided.
    const ours = await PDFDocument.load(bytes);
    const annot = ours.getPage(0).node.lookup(PDFName.of('Annots'));
    const first = annot !== undefined && 'lookup' in annot ? (annot as unknown as { lookup: (i: number) => { set: (k: PDFName, v: unknown) => void } }).lookup(0) : undefined;
    first?.set(PDFName.of('Monstera_Authored'), ours.context.obj(true));
    const markedBytes = await ours.save({ useObjectStreams: false });
    const marked = await onSession(markedBytes, (session) => mupdfWriter.serialise(session, { marks: 'engraved' }));
    expect(subtypes(marked, 0)).toStrictEqual([]);
  });
});

describe('after the save', () => {
  it('Redact over an engraved picture, after a reopen, removes it', async () => {
    const saved = (await saves(await pageOf(), picture())).engraved;
    const redacted = await onSession(saved, async (session) => {
      await applyAddAnnotation(session, {
        kind: 'addAnnotation',
        page: 0,
        stamp: STAMP,
        annotation: { type: 'redact', over: 'region', rect: { x0: 90, y0: 90, x1: 310, y1: 190 }, colour: [0.85, 0.15, 0.15], opacity: 1 },
      });
      await applyApplyRedactions(session, { kind: 'applyRedactions', pages: 'all', cover: 'none', images: 'pixels', keepTitle: false, keepBookmarks: false });
      return mupdfWriter.serialise(session);
    });
    expect(painted(render(saved)), 'CONTROL: the engraved picture is drawn').toBeGreaterThan(500);
    expect(painted(render(redacted))).toBe(0);
  });

  const redacted: readonly (readonly [string, AnnotationDraft])[] = [
    ['a text box', TEXT_BOX],
    ['typewriter text', { ...TYPEWRITER, rect: BOX }],
    ['a word stamp', APPROVED],
  ];
  for (const [label, mark] of redacted) {
    it(`Redact over engraved ${label}, after a reopen, removes it`, async () => {
      const saved = (await saves(await pageOf(), added(mark))).engraved;
      const redacted = await onSession(saved, async (session) => {
        await applyAddAnnotation(session, {
          kind: 'addAnnotation',
          page: 0,
          stamp: STAMP,
          annotation: { type: 'redact', over: 'region', rect: { x0: 90, y0: 90, x1: 310, y1: 190 }, colour: [0.85, 0.15, 0.15], opacity: 1 },
        });
        await applyApplyRedactions(session, { kind: 'applyRedactions', pages: 'all', cover: 'none', images: 'pixels', keepTitle: false, keepBookmarks: false });
        return mupdfWriter.serialise(session);
      });
      expect(kinds(saved), 'CONTROL: no layer is left, so only the page draws it').toStrictEqual([]);
      expect(painted(render(saved)), 'CONTROL: the engraved mark is drawn').toBeGreaterThan(200);
      expect(painted(render(redacted))).toBe(0);
    });
  }

  it('a document with a certificate signature: the picture stays a layer, the save appends, and the signature still covers its revision', async () => {
    // A REAL SIGNATURE, by the signing writer, with a throwaway self-signed credential.
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 86_400_000);
    cert.validity.notAfter = new Date(Date.now() + 86_400_000);
    cert.setSubject([{ name: 'commonName', value: 'Monstera Test' }]);
    cert.setIssuer([{ name: 'commonName', value: 'Monstera Test' }]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const p12 = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'pass', { algorithm: '3des' })).getBytes();
    const credential = Uint8Array.from(p12, (character: string) => character.charCodeAt(0));
    // THE SIGNING TESTS' OWN FIXTURE SHAPE: pdf-lib's default save, which the placeholder writer is built against.
    const unsigned = await PDFDocument.create();
    unsigned.addPage([400, 600]);
    const signed = await applySignDocument(await unsigned.save(), { kind: 'signDocument', bytes: credential, passphrase: 'pass', name: 'Grace Hopper' });

    // ONE SAVE, the engraved one: what a person's Save writes.
    const result = { engraved: await onSession(signed, async (session) => {
      await picture()(session);
      return mupdfWriter.serialise(session, { marks: 'engraved' });
    }) };
    // THE DECISION (Decision 5): no engraving, because the save appends to keep the signature.
    expect(subtypes(result.engraved, 0)).toContain('Stamp/Image');
    // APPENDED: the signed bytes are the saved file's first bytes, unchanged.
    expect(Buffer.from(result.engraved.subarray(0, signed.length)).equals(Buffer.from(signed))).toBe(true);
    // AND THE SIGNATURE STILL COVERS WHAT IT SIGNED, read back by this build's own reader.
    const read = await onSession(result.engraved, (session) => readSignatures(session, result.engraved));
    expect(read.map((each) => each.coversDocument)).toStrictEqual([true]);
  }, 60_000);

  it('an extraction engraves the pages it builds', async () => {
    const saved = (await saves(await pageOf(), picture())).held;
    const extracted = opened(saved, (document) => {
      engraveForGood(document);
      return document.saveToBuffer('garbage').asUint8Array().slice();
    });
    expect(subtypes(extracted, 0)).toStrictEqual([]);
    expect(difference(render(saved), render(extracted)).differing).toBe(0);
  });
});

describe('a placed picture is written compressed (ADR-0287 Decision 7)', () => {
  it('the picture and its mask carry /FlateDecode and keep their pixel size', async () => {
    const result = await saves(await pageOf(), picture([0], BOX, alphaPng(400, 300)));
    const images = opened(result.held, (document) => {
      const found: { filter: string; width: number; length: number; mask: boolean }[] = [];
      for (let at = 1; at < document.countObjects(); at += 1) {
        const object = document.newIndirect(at);
        if (!object.isStream() || String(object.get('Subtype')) !== '/Image') continue;
        found.push({
          filter: String(object.get('Filter')),
          width: object.get('Width').asNumber(),
          length: object.readRawStream().getLength(),
          mask: object.get('SMask').isIndirect(),
        });
      }
      return found;
    });
    expect(images.map((each) => [each.filter, each.width])).toStrictEqual([
      ['/FlateDecode', 400],
      ['/FlateDecode', 400],
    ]);
    // SMALLER THAN THE RAW SAMPLES: 400 × 300 × 3 for the colour, 400 × 300 for the mask.
    const colour = images.find((each) => each.mask);
    expect(colour?.length).toBeLessThan(400 * 300 * 3);
  });
});
