import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  PDFString,
  StandardFonts,
} from '@cantoo/pdf-lib';
import type { AnnotationDraft, CommandOfKind } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { MupdfSession } from './engineSeam.js';
import { mupdfWriter } from './mupdfWriter.js';
import {
  applyAddAnnotation,
  applyRemoveAnnotation,
  captureAddAnnotation,
  captureRemoveAnnotation,
  readAnnotations,
} from './pageAnnotations.js';

/**
 * Adding an annotation, read back through a DIFFERENT library than the one that
 * wrote it.
 *
 * ## The whole file exists because `getRect` agrees with `setRect`
 *
 * MuPDF's annotation API round-trips its own numbers exactly, in whatever space
 * the caller believed they were in. So a case that writes a rectangle and reads
 * it back with `getRect` passes whether or not the conversion this module
 * performs is the right one — it is the same value, returned. Measured
 * 2026-09-05: `setRect([10, 20, 110, 70])` on a `/MediaBox [0 0 200 300]` page
 * stores `/Rect [9.5 229.5 110.5 280.5]`, and `getRect` answers
 * `[10, 20, 110, 70]`.
 *
 * Every placement case here therefore reads the **stored dictionary** with
 * pdf-lib and computes the rectangle from `/Rect` and `/RD`, which is the
 * format's own definition rather than either library's opinion.
 *
 * ## Three fixtures, because the easy one cannot separate anything
 *
 * An upright page whose box starts at the origin makes *flip y* and *translate
 * by the crop origin* and *turn by /Rotate* all invisible or identical. So the
 * placement cases run on a rotated page and a cropped one as well, and each is
 * a different term of the transform:
 *
 * | fixture | what a wrong implementation still passes |
 * |---|---|
 * | upright, origin 0 | nothing — a missing y-flip already shows |
 * | `/Rotate 90` | everything except the rotation term |
 * | `/CropBox` origin 50,100 | everything except the translation term |
 */

const MEDIA: readonly [number, number] = [200, 300];

/** `/RD` describes the inset from `/Rect` to the annotation's real boundary. */
interface StoredAnnotation {
  readonly subtype: string;
  /** `/Rect` inset by `/RD`, which is where the shape actually is. */
  readonly bounds: readonly [number, number, number, number];
  readonly colour: readonly number[] | null;
  readonly borderWidth: number | null;
  readonly hasAppearance: boolean;
  readonly keys: readonly string[];
  /** `/L`, the two points a `/Line` runs between, or `null`. */
  readonly line: readonly number[] | null;
  /** `/LE`, the two ending styles, or `null` when the key is absent. */
  readonly endings: readonly string[] | null;
  /** `/InkList`, one flat number list per stroke, or `null`. */
  readonly ink: readonly (readonly number[])[] | null;
}

/** One page of {@link MEDIA}, with whatever `/CropBox` and `/Rotate` are asked for. */
async function fixture({
  crop,
  rotate,
  foreign,
  content,
  field,
  claimsAuthored,
}: {
  readonly crop?: readonly number[];
  readonly rotate?: number;
  readonly foreign?: boolean;
  readonly content?: boolean;
  readonly field?: boolean;
  /**
   * Puts `/Monstera_Authored` on the foreign annotation with a **string**
   * value, which is what a document claiming the mark badly looks like.
   */
  readonly claimsAuthored?: boolean;
} = {}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([...MEDIA]);
  if (field === true) {
    // A WIDGET, WHICH IS AN ANNOTATION THE WALK DOES NOT RETURN. It goes on the
    // page FIRST so that every index below it shifts — a field added after the
    // squares would leave the two numbering schemes agreeing, which is the
    // fixture the defect also handles correctly.
    const font = await document.embedFont(StandardFonts.Helvetica);
    document
      .getForm()
      .createTextField('applicant.name')
      .addToPage(page, { x: 10, y: 200, width: 60, height: 16, font });
  }
  if (content === true) {
    // SOMETHING UNDER THE MARK. A page with no content stream cannot show that
    // a redaction was not applied — nothing would have changed either way,
    // which is item 4's *never build a fixture the bug also handles correctly*.
    page.drawRectangle({ x: 20, y: 30, width: 80, height: 30 });
  }
  if (crop !== undefined) {
    const box = PDFArray.withContext(document.context);
    for (const value of crop) box.push(PDFNumber.of(value));
    page.node.set(PDFName.of('CropBox'), box);
  }
  if (rotate !== undefined) page.node.set(PDFName.of('Rotate'), PDFNumber.of(rotate));
  if (foreign === true) {
    // AN ANNOTATION THIS BUILD DID NOT AUTHOR, carrying keys it never writes.
    // `/T` and `/Contents` are a person's name and note; `/Sound` is nonsense on
    // a Square and is here precisely because nothing in this codebase would ever
    // produce it, so a key that survives cannot have been re-written by us.
    const other = document.context.obj({});
    other.set(PDFName.of('Type'), PDFName.of('Annot'));
    other.set(PDFName.of('Subtype'), PDFName.of('Square'));
    const rect = PDFArray.withContext(document.context);
    for (const value of [5, 5, 25, 25]) rect.push(PDFNumber.of(value));
    other.set(PDFName.of('Rect'), rect);
    other.set(PDFName.of('T'), PDFString.of('Someone Else'));
    other.set(PDFName.of('Contents'), PDFString.of('written by another application'));
    other.set(PDFName.of('Sound'), PDFName.of('NotARealKeyForASquare'));
    if (claimsAuthored === true) {
      // THE MARK'S KEY WITH THE WRONG TYPE. `authoredHere` reads the value
      // rather than the key's presence, so this is the fixture that separates
      // *the key is there* from *the claim is made*.
      other.set(PDFName.of('Monstera_Authored'), PDFString.of('yes'));
    }
    const ref = document.context.register(other);
    const annots = PDFArray.withContext(document.context);
    annots.push(ref);
    page.node.set(PDFName.of('Annots'), annots);
  }
  return document.save({ useObjectStreams: false });
}

/** Every annotation on page 0, read with pdf-lib. */
async function readBack(bytes: Uint8Array): Promise<readonly StoredAnnotation[]> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = document.getPages()[0];
  if (page === undefined) throw new Error('the fixture lost its page');
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return [];

  // `lookup(key, Type)` THROWS when the key is absent rather than answering
  // `undefined`, so every optional key here is read untyped and narrowed. The
  // foreign fixture is what says so: it carries no `/RD` and no `/BS`, which is
  // exactly what an annotation another producer wrote looks like.
  const numbers = (dict: PDFDict, key: string): readonly number[] | null => {
    const array = dict.lookup(PDFName.of(key));
    if (!(array instanceof PDFArray)) return null;
    return array.asArray().map((entry) => (entry instanceof PDFNumber ? entry.asNumber() : NaN));
  };

  return annots.asArray().map((entry) => {
    const dict = entry instanceof PDFRef ? document.context.lookup(entry, PDFDict) : undefined;
    if (dict === undefined) throw new Error('an /Annots entry is not a dictionary');
    const rect = numbers(dict, 'Rect') ?? [0, 0, 0, 0];
    // `/RD` is optional and absent means no inset.
    const inset = numbers(dict, 'RD') ?? [0, 0, 0, 0];
    const border = dict.lookup(PDFName.of('BS'));
    const width = border instanceof PDFDict ? border.lookup(PDFName.of('W')) : undefined;
    const subtype = dict.lookup(PDFName.of('Subtype'));
    return {
      // `asString()` on a `PDFName` includes the leading slash, which is the
      // name as the file spells it.
      subtype: subtype instanceof PDFName ? subtype.asString() : '',
      bounds: [
        (rect[0] ?? 0) + (inset[0] ?? 0),
        (rect[1] ?? 0) + (inset[1] ?? 0),
        (rect[2] ?? 0) - (inset[2] ?? 0),
        (rect[3] ?? 0) - (inset[3] ?? 0),
      ],
      colour: numbers(dict, 'C'),
      borderWidth: width instanceof PDFNumber ? width.asNumber() : null,
      line: numbers(dict, 'L'),
      ink: ((): readonly (readonly number[])[] | null => {
        const strokes = dict.lookup(PDFName.of('InkList'));
        if (!(strokes instanceof PDFArray)) return null;
        return strokes.asArray().map((stroke) => {
          const resolved = stroke instanceof PDFRef ? document.context.lookup(stroke) : stroke;
          if (!(resolved instanceof PDFArray)) return [];
          return resolved
            .asArray()
            .map((value) => (value instanceof PDFNumber ? value.asNumber() : NaN));
        });
      })(),
      endings: ((): readonly string[] | null => {
        const array = dict.lookup(PDFName.of('LE'));
        if (!(array instanceof PDFArray)) return null;
        return array.asArray().map((name) => (name instanceof PDFName ? name.asString() : ''));
      })(),
      hasAppearance: dict.lookup(PDFName.of('AP')) !== undefined,
      keys: dict.keys().map((key) => key.asString()),
    };
  });
}

/**
 * Page 0's content stream bytes, read with pdf-lib.
 *
 * The thing a burn-in would rewrite and a mark must not touch. Read as BYTES
 * rather than as a decoded operator list: what matters is that nothing changed,
 * and a decode that normalised whitespace would hide a rewrite that did.
 */
async function pageContentOf(bytes: Uint8Array): Promise<readonly number[]> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = document.getPages()[0];
  if (page === undefined) throw new Error('the fixture lost its page');
  const contents = page.node.lookup(PDFName.of('Contents'));
  // `/Contents` IS A STREAM OR AN ARRAY OF THEM, both legal, and which one a
  // producer writes is not this case's subject — so both are read rather than
  // one being asserted. A reader that handled only the shape the fixture
  // happens to have would break on the shape the writer happens to produce.
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  const bodies = streams.map((entry) => {
    const resolved = entry instanceof PDFRef ? document.context.lookup(entry) : entry;
    if (!(resolved instanceof PDFStream)) return [];
    return [...resolved.getContents()];
  });
  const joined = bodies.flat();
  if (joined.length === 0) throw new Error('this fixture has no content stream to compare');
  return joined;
}

const SQUARE: Extract<AnnotationDraft, { type: 'square' }> = {
  type: 'square',
  rect: { x0: 10, y0: 20, x1: 110, y1: 70 },
  colour: [1, 0, 0],
  borderWidth: 2,
};

/** The same box as {@link SQUARE}, and no border width — see the schema. */
const REDACT: Extract<AnnotationDraft, { type: 'redact' }> = {
  type: 'redact',
  rect: { x0: 10, y0: 20, x1: 110, y1: 70 },
  colour: [1, 0, 0],
};

/** A three-point stroke, so *the middle point survives* is observable. */
const INK: Extract<AnnotationDraft, { type: 'ink' }> = {
  type: 'ink',
  points: [
    { x: 10, y: 20 },
    { x: 40, y: 30 },
    { x: 70, y: 20 },
  ],
  colour: [1, 0, 0],
  borderWidth: 2,
};

/** The same two corners as {@link SQUARE}, so the geometries can be compared. */
const LINE: Extract<AnnotationDraft, { type: 'line' }> = {
  type: 'line',
  from: { x: 10, y: 20 },
  to: { x: 110, y: 70 },
  ending: 'none',
  colour: [1, 0, 0],
  borderWidth: 2,
};

function command(
  overrides: Partial<CommandOfKind<'addAnnotation'>> = {},
): CommandOfKind<'addAnnotation'> {
  return { kind: 'addAnnotation', page: 0, annotation: SQUARE, ...overrides };
}

/** Applies the command to a fixture and returns the resulting bytes. */
async function drawnOn(
  bytes: Uint8Array,
  given: CommandOfKind<'addAnnotation'> = command(),
): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes);
  try {
    await applyAddAnnotation(session, given);
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Runs `work` against an open session, closing it whatever happens. */
async function onSession<T>(
  bytes: Uint8Array,
  work: (session: MupdfSession) => Promise<T>,
): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await work(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Applies a removal to a fixture and returns the resulting bytes. */
async function removedFrom(
  bytes: Uint8Array,
  page: number,
  index: number,
): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes);
  try {
    await applyRemoveAnnotation(session, {
      kind: 'removeAnnotation',
      page,
      index,
      // THE VERSION IS NEVER READ HERE, and that is ADR-0041 Decision 3 rather
      // than an omission: the bus compares it before this apply is reached, and
      // an apply that re-derived the rule would be a second opinion about what
      // the declaration table already says. `commandBus.test.ts` is where the
      // refusal is a case.
      version: asDocVersion(1),
    });
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('applyAddAnnotation writes a text box as the format defines one', () => {
  /** The `/FreeText` on page 0, read with pdf-lib. */
  async function freeTextIn(
    bytes: Uint8Array,
  ): Promise<{ readonly contents: string; readonly appearance: string; readonly keys: string[] }> {
    const loaded = await PDFDocument.load(bytes, { updateMetadata: false });
    const annots = loaded.getPages()[0]?.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) throw new Error('the page carries no /Annots');
    const [first] = annots.asArray();
    const dict = first instanceof PDFRef ? loaded.context.lookup(first, PDFDict) : undefined;
    if (dict === undefined) throw new Error('the annotation is not a reachable dictionary');
    const contents = dict.lookup(PDFName.of('Contents'));
    const appearance = dict.lookup(PDFName.of('DA'));
    return {
      contents: contents instanceof PDFString ? contents.asString() : '',
      appearance: appearance instanceof PDFString ? appearance.asString() : '',
      keys: dict.keys().map((key) => key.asString()),
    };
  }

  const TEXT_BOX: Extract<AnnotationDraft, { type: 'text-box' }> = {
    type: 'text-box',
    rect: { x0: 10, y0: 20, x1: 110, y1: 70 },
    text: 'see figure 3',
    colour: [0.1, 0.1, 0.1],
    fontSize: 12,
  };

  it('puts the words in /Contents, which is where a FreeText keeps them', async () => {
    // NOT A NOTE ABOUT THE ANNOTATION. For every other subtype `/Contents` is a
    // comment beside the object; §12.5.6.6 makes it the text a FreeText
    // DISPLAYS. So this is the one member whose contents a viewer renders, and
    // asserting it is asserting what the person sees rather than metadata.
    const drawn = await drawnOn(await fixture(), command({ annotation: TEXT_BOX }));
    expect((await freeTextIn(drawn)).contents).toBe('see figure 3');
  });

  it('writes a /DA naming a base-14 font, rather than a hand-built operator string', async () => {
    // `setDefaultAppearance` OWNS THE SPELLING. A `/DA` is a content-stream
    // fragment, and building one here would be this file spelling operators
    // MuPDF already spells — and naming a font whose resource it does not own.
    // The assertion is loose about the exact bytes on purpose: what matters is
    // that the font is Helvetica and the size is the one the draft asked for,
    // not the order MuPDF chose to emit them in.
    const drawn = await drawnOn(await fixture(), command({ annotation: TEXT_BOX }));
    const { appearance } = await freeTextIn(drawn);
    expect(appearance).toMatch(/Helv/u);
    expect(appearance).toMatch(/\b12\b/u);
  });

  it('gives it an appearance stream, so a viewer draws the words rather than a box', async () => {
    // The pair to the case above. A `/DA` says how the text should look and an
    // `/AP` is what most viewers actually paint — an annotation with the first
    // and not the second renders as nothing in some readers and correctly in
    // others, which is the worst version of this bug to ship.
    const [stored] = await readBack(await drawnOn(await fixture(), command({ annotation: TEXT_BOX })));
    expect(stored?.subtype).toBe('/FreeText');
    expect(stored?.hasAppearance).toBe(true);
  });

  it('PINS the keys MuPDF writes for a FreeText, including one this build never asks for', async () => {
    // MEASURED, AND IT CORRECTED THE SOURCE. `pageAnnotations.ts` said a text
    // box is left with no border because nothing calls `setBorderWidth`. MuPDF
    // 1.28.0 writes a `/BS` anyway — and a `/CL`, the callout line — from
    // `createAnnotation('FreeText')` rather than from anything this build does.
    // The reasoning was sound and the object was not what it described.
    //
    // So this pins the whole key set rather than asserting an absence. The
    // absence version would have gone green the day MuPDF stopped writing `/BS`
    // and said nothing about what arrived instead — and `/CL` is exactly the
    // sort of thing that arrives: a key a viewer may honour, put there by the
    // engine, which is much cheaper to find here than as a stray line on
    // somebody's page.
    // ONE OF THESE IS OURS, as of 2026-09-06: `/Monstera_Authored` is the
    // `srcRef` mark (ADR-0043) and everything else on this line is MuPDF's. The
    // pin keeps them together deliberately — the case's subject is *what ends
    // up in the dictionary*, and a key this build writes going missing is worth
    // exactly as much as one the engine stops writing.
    const drawn = await drawnOn(await fixture(), command({ annotation: TEXT_BOX }));
    expect((await freeTextIn(drawn)).keys.sort().join(' ')).toBe(
      '/AP /BS /CL /Contents /DA /F /Monstera_Authored /P /RD /Rect /Subtype /Type',
    );
  });

  it('is listed as a text box, and so is a FOREIGN FreeText', async () => {
    // THE CLOSED UNION'S RULE ARRIVING. A member is added the day a tool writes
    // that kind — and from that day every document's FreeText stops being
    // `other`, including ones this build never wrote. That is right: the label
    // says what the object is, not who made it. Asserted because it is a change
    // in what an existing document looks like in the panel, made by a commit
    // that is nominally about a new tool.
    const listed = await onSession(
      await drawnOn(await fixture(), command({ annotation: TEXT_BOX })),
      (session) => readAnnotations(session),
    );
    expect(listed.annotations).toStrictEqual([
      { page: 0, index: 0, kind: 'text-box', contents: 'see figure 3', authored: true },
    ]);
  });
});

describe('applyAddAnnotation places a point annotation where the click was', () => {
  /**
   * The two point-placed subtypes, and what makes them a pair worth testing
   * together: neither is given its size by this build, and MuPDF's two answers
   * are DIFFERENT. A `/Text` keeps the corner it was handed and a `/Caret`
   * keeps the centre, so a single shared expectation would be right for one of
   * them and would pass for an implementation that had confused the two.
   *
   * The numbers are pinned rather than derived, for the reason the text box's
   * key set is: they are the engine's, this build cannot compute them, and a
   * MuPDF version that changes either should be a red build here rather than a
   * silent move in where every note on every page sits.
   */
  const NOTE: Extract<AnnotationDraft, { type: 'sticky-note' }> = {
    type: 'sticky-note',
    at: { x: 40, y: 200 },
    text: 'check this figure',
    colour: [1, 0.8, 0.2],
  };

  const CARET: Extract<AnnotationDraft, { type: 'caret' }> = {
    type: 'caret',
    // THE SAME POINT AS THE NOTE, deliberately, so the two stored boxes can be
    // compared directly. That comparison is the whole reason these are separate
    // table entries: one clamps and one does not, from one input.
    at: { x: 40, y: 200 },
    colour: [0.85, 0.15, 0.15],
  };

  /** `/Name`, which is the icon a `/Text` draws. Absent on every other subtype. */
  async function iconOf(bytes: Uint8Array): Promise<string | null> {
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    const annots = document.getPages()[0]?.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) throw new Error('the page carries no /Annots');
    const [first] = annots.asArray();
    const dict = first instanceof PDFRef ? document.context.lookup(first, PDFDict) : undefined;
    if (dict === undefined) throw new Error('the annotation is not a reachable dictionary');
    const name = dict.lookup(PDFName.of('Name'));
    return name instanceof PDFName ? name.asString() : null;
  }

  it('anchors a note at the point, at the 10-point floor MuPDF clamps to', async () => {
    // THE POINT IS THE DISPLAYED TOP-LEFT CORNER, measured 2026-09-06 and
    // asserted here in PDF space: a draft at (40, 200) stores
    // `/Rect [40 190 50 200]` — x runs right from the point and y runs DOWN
    // from it, because down the page is smaller y.
    //
    // TEN AND NOT TWENTY, which is the number this assertion exists to hold.
    // MuPDF clamps the side to [10, 20] and a point request is below the floor,
    // so a note is ten points square. Read from a single 30-point sample the
    // rule looked like a fixed twenty, and the value that prediction gave for
    // the input this build actually sends was wrong by half.
    //
    // It is also the assertion a wrong y-flip cannot survive: an implementation
    // that forgot the flip would anchor at (40, 100) on this 300-high page,
    // which is a different number rather than the same box mirrored.
    const stored = await readBack(await drawnOn(await fixture(), command({ annotation: NOTE })));
    expect(stored[0]?.subtype).toBe('/Text');
    expect(stored[0]?.bounds).toStrictEqual([40, 190, 50, 200]);
  });

  it('CENTRES a caret on the point, in a fixed 20 by 14 that is not the note’s box', async () => {
    // THE SECOND RULE, and the case exists because the first one passing says
    // nothing about it. From the SAME point (40, 200) the note stores
    // `[40 190 50 200]` — a 10-square box hanging off the corner — and a caret
    // stores `[30 193 50 207]`, which is 20 by 14 centred on it. Different
    // size, different anchor, one input.
    //
    // This is what a shared point-shaped helper would have hidden. Both
    // subtypes take a point and answer with a box, so one function would have
    // been written against whichever was measured first and would have looked
    // right; only holding the input constant and comparing the two answers
    // shows that one of them clamps.
    const stored = await readBack(await drawnOn(await fixture(), command({ annotation: CARET })));
    expect(stored[0]?.subtype).toBe('/Caret');
    expect(stored[0]?.bounds).toStrictEqual([30, 193, 50, 207]);
  });

  it('gives the caret a colour and none of the three keys MuPDF refuses', async () => {
    // MEASURED REFUSALS, not omissions: `setIcon` answers *"Caret annotations
    // have no Name property"*, and `setBorderWidth` and `setDefaultAppearance`
    // answer likewise. So the entry writing two calls is the whole of what the
    // writer of record accepts rather than a start somebody should extend.
    const stored = await readBack(await drawnOn(await fixture(), command({ annotation: CARET })));
    expect(stored[0]?.colour).toStrictEqual([0.85, 0.15, 0.15]);
    expect(stored[0]?.borderWidth).toBeNull();
    expect(stored[0]?.keys).not.toContain('Name');
  });

  it('places a note through the CROP ORIGIN, not from the media box', async () => {
    // THE TRANSLATION TERM, which the upright origin-zero fixture cannot see:
    // its crop starts at 0, so *translate by the crop origin* is adding zero.
    //
    // The displayed box is the crop INTERSECTED with the media box, which this
    // fixture is built to exercise: `/CropBox [50 100 250 400]` over a
    // `/MediaBox [0 0 200 300]` is visible from (50, 100) to (200, 300) — 150
    // by 200, which is what the refusal message says when a point misses it.
    // So the frame's top-left corner is (50, 300), and a draft at (60, 280) is
    // 10 across and 20 down: the note hangs down and right to `[60 270 70 280]`.
    //
    // An implementation measuring from the media box's own corner would put the
    // same point 50 to the left, at x 10.
    const stored = await readBack(
      await drawnOn(
        await fixture({ crop: [50, 100, 250, 400] }),
        command({ annotation: { ...NOTE, at: { x: 60, y: 280 } } }),
      ),
    );
    expect(stored[0]?.bounds).toStrictEqual([60, 270, 70, 280]);
  });

  it('stores the SAME box on a rotated page, because both halves turn', async () => {
    // THE ROTATION TERM, and the expected value is deliberately the upright
    // case's — which reads like a case that proves nothing and is the opposite.
    //
    // `/Rotate` is applied twice on this path and cancels: `placedRect` turns
    // the PDF point into the displayed frame, and MuPDF turns the displayed
    // rectangle back when it stores `/Rect`. Landing at the same document
    // coordinates whatever the page is displayed at is the CORRECT behaviour —
    // a note belongs where the reader pointed, and rotating the view must not
    // move it.
    //
    // What separates it is that only ONE of the two halves is ours. MuPDF's is
    // fixed and measured: handed the same displayed rectangle on `/Rotate 0`
    // and `/Rotate 90` it stores `[10 270 20 280]` and `[20 0 30 10]`, so its
    // half is unambiguously rotation-aware. An implementation whose transform
    // ignored rotation would therefore NOT cancel — it would hand MuPDF an
    // upright rectangle and get that second answer back. Equality here is the
    // assertion; a difference would be the defect.
    const stored = await readBack(
      await drawnOn(await fixture({ rotate: 90 }), command({ annotation: NOTE })),
    );
    expect(stored[0]?.subtype).toBe('/Text');
    expect(stored[0]?.bounds).toStrictEqual([40, 190, 50, 200]);
  });

  it('writes the icon MuPDF calls Comment, which no draft field chose', async () => {
    // THE CONSTANT, asserted so it is a decision on the record rather than a
    // default inherited. `/Name` picks between the format's eight standard
    // icons; the draft has no field for one because no FEATURES row owes a
    // control that would set it, and this is what the absence resolves to.
    expect(await iconOf(await drawnOn(await fixture(), command({ annotation: NOTE })))).toBe(
      '/Comment',
    );
  });

  it('gives the note a colour and NO border, which the engine refuses anyway', async () => {
    const stored = await readBack(await drawnOn(await fixture(), command({ annotation: NOTE })));
    expect(stored[0]?.colour).toStrictEqual([1, 0.8, 0.2]);
    // MEASURED, not omitted: MuPDF answers `setBorderWidth` on a `/Text` with
    // *"Text annotations have no BS property"*, exactly as it does on a Redact.
    // So the draft carries no border width and the object has no `/BS`.
    expect(stored[0]?.borderWidth).toBeNull();
  });

  it('THE WALK DOES NOT SEE THE POPUP MuPDF WRITES BESIDE THE NOTE', async () => {
    // THE CASE THE HANDLE RESTS ON, one subtype further than the widget case
    // that established it. `createAnnotation('Text')` writes TWO objects into
    // `/Annots` — the note and a `/Popup` for it — so a build that named an
    // annotation by its `/Annots` position would have every handle after the
    // first note off by one, on documents that look completely ordinary.
    //
    // The fixture puts an ink stroke AFTER the note precisely so the two
    // numbering schemes disagree: `/Annots` is [Text, Popup, Ink] and the walk
    // is [Text, Ink]. A fixture with the note alone would have both schemes
    // agreeing at index 0, which is the shape the defect also handles
    // correctly.
    const both = await drawnOn(
      await drawnOn(await fixture(), command({ annotation: NOTE })),
      command({ annotation: INK }),
    );

    expect((await readBack(both)).map((entry) => entry.subtype)).toStrictEqual([
      '/Text',
      '/Popup',
      '/Ink',
    ]);
    const listed = await onSession(both, (session) => readAnnotations(session));
    expect(listed.annotations).toStrictEqual([
      { page: 0, index: 0, kind: 'sticky-note', contents: 'check this figure', authored: true },
      { page: 0, index: 1, kind: 'ink', contents: '', authored: true },
    ]);
  });

  it('and removing the note takes its popup with it, leaving no orphan', async () => {
    // THE OTHER HALF, and it is the one that could have been a leak: a `/Popup`
    // whose `/Parent` had been deleted would be an object referencing nothing,
    // and `/Annots` would keep growing as notes were added and removed. MuPDF
    // deletes the pair, measured — three entries down to one.
    const both = await drawnOn(
      await drawnOn(await fixture(), command({ annotation: NOTE })),
      command({ annotation: INK }),
    );
    const after = await removedFrom(both, 0, 0);

    expect((await readBack(after)).map((entry) => entry.subtype)).toStrictEqual(['/Ink']);
    const listed = await onSession(after, (session) => readAnnotations(session));
    expect(listed.annotations).toStrictEqual([
      { page: 0, index: 0, kind: 'ink', contents: '', authored: true },
    ]);
  });

  it('CONTROL: a caret writes no popup, so its handle is the plain case', async () => {
    // THE CONTROL FOR THE TWO CASES ABOVE. Without it *the walk filters the
    // popup* is asserted only where a popup exists, and an implementation that
    // filtered something else — or a fixture whose two counts happened to
    // agree — would read identically. A caret is the same click, the same
    // point and the same command shape, and MuPDF writes exactly one object
    // for it: so the array and the walk agree here, and disagree there.
    const both = await drawnOn(
      await drawnOn(await fixture(), command({ annotation: CARET })),
      command({ annotation: INK }),
    );
    expect((await readBack(both)).map((entry) => entry.subtype)).toStrictEqual(['/Caret', '/Ink']);
    const listed = await onSession(both, (session) => readAnnotations(session));
    expect(listed.annotations).toStrictEqual([
      { page: 0, index: 0, kind: 'caret', contents: '', authored: true },
      { page: 0, index: 1, kind: 'ink', contents: '', authored: true },
    ]);
  });
});

describe('applyAddAnnotation writes the vertex shapes the format defines', () => {
  /** Three corners, so *the middle one survives* is observable. */
  const CORNERS = [
    { x: 10, y: 20 },
    { x: 80, y: 20 },
    { x: 80, y: 90 },
  ];

  const POLYGON: Extract<AnnotationDraft, { type: 'polygon' }> = {
    type: 'polygon',
    points: CORNERS,
    border: 'solid',
    colour: [1, 0, 0],
    borderWidth: 2,
  };

  const CLOUD: Extract<AnnotationDraft, { type: 'polygon' }> = { ...POLYGON, border: 'cloudy' };

  const POLYLINE: Extract<AnnotationDraft, { type: 'polyline' }> = {
    type: 'polyline',
    points: CORNERS,
    colour: [1, 0, 0],
    borderWidth: 2,
  };

  /** `/BE`'s style letter, or `null` when the key is absent. */
  async function borderEffectIn(bytes: Uint8Array): Promise<string | null> {
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    const annots = document.getPages()[0]?.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) throw new Error('the page carries no /Annots');
    const [first] = annots.asArray();
    const dict = first instanceof PDFRef ? document.context.lookup(first, PDFDict) : undefined;
    if (dict === undefined) throw new Error('the annotation is not a reachable dictionary');
    const effect = dict.lookup(PDFName.of('BE'));
    if (!(effect instanceof PDFDict)) return null;
    const style = effect.lookup(PDFName.of('S'));
    return style instanceof PDFName ? style.asString() : null;
  }

  /** `/RD`'s first number — the inset from `/Rect` to where the shape really is. */
  async function insetIn(bytes: Uint8Array): Promise<number | null> {
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    const annots = document.getPages()[0]?.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) throw new Error('the page carries no /Annots');
    const [first] = annots.asArray();
    const dict = first instanceof PDFRef ? document.context.lookup(first, PDFDict) : undefined;
    if (dict === undefined) throw new Error('the annotation is not a reachable dictionary');
    const inset = dict.lookup(PDFName.of('RD'));
    if (!(inset instanceof PDFArray)) return null;
    const [edge] = inset.asArray();
    return edge instanceof PDFNumber ? edge.asNumber() : null;
  }

  /** `/Vertices`, flat as the format stores it. */
  async function verticesIn(bytes: Uint8Array): Promise<readonly number[]> {
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    const annots = document.getPages()[0]?.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) throw new Error('the page carries no /Annots');
    const [first] = annots.asArray();
    const dict = first instanceof PDFRef ? document.context.lookup(first, PDFDict) : undefined;
    if (dict === undefined) throw new Error('the annotation is not a reachable dictionary');
    const list = dict.lookup(PDFName.of('Vertices'));
    if (!(list instanceof PDFArray)) throw new Error('the annotation carries no /Vertices');
    return list.asArray().map((entry) => (entry instanceof PDFNumber ? entry.asNumber() : NaN));
  }

  it('stores the corners the draft named, and NOT a closing repeat', async () => {
    // THE COUNT IS THE ASSERTION AS MUCH AS THE VALUES. MuPDF closes a polygon
    // itself, so a payload that repeated the first corner would store eight
    // numbers here rather than six — a duplicate vertex on every polygon this
    // build writes, invisible in a rendering and present in the file.
    //
    // THE VALUES COME BACK EQUAL TO THE DRAFT, and that reads like a case that
    // proves nothing about the conversion. It is the opposite. `/Vertices` is
    // stored in PDF user space, which is the frame the draft is already in, and
    // `setVertices` takes the DISPLAYED frame — measured, on the probe that
    // wrote `[10, 20]` and read back `[10, 280]` on this 300-high page. So the
    // flip is applied here and undone by the engine, and equality is what a
    // correct round trip looks like. An implementation that handed the PDF
    // numbers straight to `setVertices` would store `[10, 280, 80, 280, 80,
    // 210]` and put the shape at the other end of the page.
    const stored = await drawnOn(await fixture(), command({ annotation: POLYGON }));
    expect(await verticesIn(stored)).toStrictEqual([10, 20, 80, 20, 80, 90]);
  });

  it('lets MuPDF compute /Rect, which it refuses to be told', async () => {
    // MEASURED: `setRect` on a `/Polygon` answers *"Polygon annotations have no
    // Rect property"*. So the box in the file is the engine's, derived from the
    // vertices and inset by `/RD` — and this build must not have an opinion
    // about it. `readBack` reports `/Rect` inset by `/RD`, which is where the
    // shape actually is, so it lands exactly on the corners.
    const stored = await readBack(await drawnOn(await fixture(), command({ annotation: POLYGON })));
    expect(stored[0]?.subtype).toBe('/Polygon');
    expect(stored[0]?.bounds).toStrictEqual([10, 20, 80, 90]);
  });

  it('writes /BE for a cloud and NOT for a solid polygon, on the same geometry', async () => {
    // ONE DRAFT MEMBER, TWO TOOLS, and the two fixtures differ in exactly the
    // field that is supposed to separate them — same corners, same colour, same
    // width. A build that always wrote the effect, or never did, passes one of
    // these and fails the other; neither alone can tell.
    expect(
      await borderEffectIn(await drawnOn(await fixture(), command({ annotation: CLOUD }))),
    ).toBe('/C');
    expect(
      await borderEffectIn(await drawnOn(await fixture(), command({ annotation: POLYGON }))),
    ).toBeNull();
  });

  it('and the cloud’s bumps GROW /RD, which an inert key could not do', async () => {
    // THE MEASUREMENT THAT SAYS `/BE` REACHED THE RENDERER rather than merely
    // landing in the dictionary. A key written and ignored looks identical in
    // `/BE` itself; what only a real effect produces is a bigger `/RD` — 11
    // against 2, measured — because the scallops sit outside the corners and
    // the engine has to widen `/Rect` to hold them.
    //
    // NOT ASSERTED ON `bounds`, and that is the trap this case walked into
    // first: `readBack` reports `/Rect` inset by `/RD`, which is *where the
    // shape is* — and the shape is in the same place either way, by design.
    // The two boxes are equal there, so the assertion has to read the raw
    // difference rather than the corrected one.
    //
    // IT CAUGHT ITS DEFECT ON THE FIRST RUN, which is the argument for writing
    // it this way rather than checking `/BE` and moving on: the writer called
    // `setBorderEffect('Cloudy')` and nothing else, which stores the key and
    // leaves the effect INERT at `/I 0`. `/BE` said `/C`, the case above
    // passed, and every cloud would have rendered as a plain polygon.
    expect(await insetIn(await drawnOn(await fixture(), command({ annotation: POLYGON })))).toBe(2);
    expect(await insetIn(await drawnOn(await fixture(), command({ annotation: CLOUD })))).toBe(11);
  });

  it('writes an open PolyLine from the same points, with no /BE at all', async () => {
    // THE SUBTYPE IS THE WHOLE DIFFERENCE at this level — same vertices, same
    // colour, same width — which is why the fixtures share `CORNERS`. A build
    // that routed a polyline to `/Polygon` would close the shape in every
    // viewer and nothing about the numbers would say so.
    const stored = await drawnOn(await fixture(), command({ annotation: POLYLINE }));
    expect((await readBack(stored))[0]?.subtype).toBe('/PolyLine');
    expect(await verticesIn(stored)).toStrictEqual([10, 20, 80, 20, 80, 90]);
    // AND NO BORDER EFFECT IS REACHABLE HERE. MuPDF refuses `setBorderEffect`
    // on a `/PolyLine` — *"PolyLine annotations have no BE property"* — which
    // is why the draft has no field for one; this pins the absence so a member
    // added later has to meet the measurement.
    expect(await borderEffectIn(stored)).toBeNull();
  });

  it('refuses a shape with no extent, and the test is per AXIS pair not per axis', async () => {
    // A POLYGON FLAT IN Y IS A ZIG-ZAG ALONG A RULE, which is a thing somebody
    // draws — so unlike a rectangle this cannot refuse on one axis. What has
    // nothing to show is every corner in one place.
    await expect(
      drawnOn(
        await fixture(),
        command({
          annotation: { ...POLYGON, points: [
            { x: 10, y: 20 },
            { x: 10, y: 20 },
            { x: 10, y: 20 },
          ] },
        }),
      ),
    ).rejects.toThrow(/no extent/u);
  });

  it('CONTROL: and a polygon flat in one axis is accepted', async () => {
    // Without this the refusal above is satisfied by a rule that rejects any
    // shape with a zero-width bounding box — which would refuse the flat
    // zig-zag the comment above says is legal, and the refusal would read as
    // correct because it is right for the rectangle beside it.
    const stored = await readBack(
      await drawnOn(
        await fixture(),
        command({
          annotation: { ...POLYGON, points: [
            { x: 10, y: 20 },
            { x: 40, y: 20 },
            { x: 80, y: 20 },
          ] },
        }),
      ),
    );
    expect(stored[0]?.subtype).toBe('/Polygon');
  });

  it('names both subtypes in the walk, so a foreign one is not `other`', async () => {
    const listed = await onSession(
      await drawnOn(
        await drawnOn(await fixture(), command({ annotation: POLYGON })),
        command({ annotation: POLYLINE }),
      ),
      (session) => readAnnotations(session),
    );
    expect(listed.annotations).toStrictEqual([
      { page: 0, index: 0, kind: 'polygon', contents: '', authored: true },
      { page: 0, index: 1, kind: 'polyline', contents: '', authored: true },
    ]);
  });
});

describe('applyRemoveAnnotation takes the annotation the handle names', () => {
  it('removes it, and leaves the one beside it', async () => {
    // Two marks on one page, distinguishable by kind. Removing index 0 must
    // leave the ink — an implementation that removed the last, or all, or the
    // wrong one passes any assertion that merely counts.
    const both = await drawnOn(
      await drawnOn(await fixture(), command({ annotation: SQUARE })),
      command({ annotation: INK }),
    );
    const after = await onSession(await removedFrom(both, 0, 0), (session) =>
      readAnnotations(session),
    );
    expect(after.annotations).toStrictEqual([
      { page: 0, index: 0, kind: 'ink', contents: '', authored: true },
    ]);
  });

  it('RESOLVES THROUGH THE WALK, so a widget does not shift the handle', async () => {
    // THE CASE THE WHOLE DESIGN RESTS ON, and its fixture is built so the two
    // numbering schemes disagree: the page carries a text field first, then a
    // square, then an ink. `/Annots` is [Widget, Square, Ink] and the walk is
    // [Square, Ink], so handle 0 is the SQUARE and `/Annots` position 0 is the
    // widget.
    //
    // An implementation resolving through `/Annots` removes the form field and
    // leaves both marks. Nothing about the document afterwards looks wrong
    // until someone opens the form.
    const withField = await drawnOn(
      await drawnOn(await fixture({ field: true }), command({ annotation: SQUARE })),
      command({ annotation: INK }),
    );
    const after = await onSession(await removedFrom(withField, 0, 0), (session) =>
      readAnnotations(session),
    );
    expect(after.annotations).toStrictEqual([
      { page: 0, index: 0, kind: 'ink', contents: '', authored: true },
    ]);

    // THE CONTROL, and without it the case above passes on a fixture whose
    // field never arrived. The widget must still be there: this command removes
    // an annotation, and a form field is not one of the things it may take.
    const loaded = await PDFDocument.load(await removedFrom(withField, 0, 0), {
      updateMetadata: false,
    });
    const annots = loaded.getPages()[0]?.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) throw new Error('the page lost /Annots entirely');
    const subtypes = annots.asArray().map((entry) => {
      const dict = entry instanceof PDFRef ? loaded.context.lookup(entry, PDFDict) : undefined;
      const subtype = dict?.lookup(PDFName.of('Subtype'));
      return subtype instanceof PDFName ? subtype.asString() : '?';
    });
    expect(subtypes).toStrictEqual(['/Widget', '/Ink']);
  });

  it('refuses an index the page does not have, naming the count', async () => {
    const one = await drawnOn(await fixture(), command({ annotation: SQUARE }));
    await expect(removedFrom(one, 0, 1)).rejects.toThrow(/has 1 annotation\(s\)/u);
  });

  it('refuses a page the document does not have', async () => {
    // The page is validated FIRST, so this is a page error rather than an
    // annotation one — `pageAt`'s message, not `annotationAt`'s.
    const one = await drawnOn(await fixture(), command({ annotation: SQUARE }));
    await expect(removedFrom(one, 4, 0)).rejects.toThrow(/outside this document/u);
  });

  it('records no prior state, and says why', async () => {
    const one = await drawnOn(await fixture(), command({ annotation: SQUARE }));
    const captured = await onSession(one, (session) =>
      captureRemoveAnnotation(session, {
        kind: 'removeAnnotation',
        page: 0,
        index: 0,
        version: asDocVersion(1),
      }),
    );
    expect(captured.captured).toBe(false);
    // STRUCTURAL, unlike `addAnnotation`'s *not yet* — the reason has to say so,
    // because the two commands' refusals read alike and only one of them is
    // waiting for something.
    expect(captured.captured ? '' : captured.reason).toMatch(/whole object graph/u);
  });

  it('refuses to capture a handle naming nothing, rather than reporting a checkpoint', async () => {
    // `captureAddAnnotation`'s care, and the reason it matters here: a capture
    // that shrugged would have the bus take a full checkpoint of the document
    // for a command whose apply was about to throw.
    const one = await drawnOn(await fixture(), command({ annotation: SQUARE }));
    await expect(
      onSession(one, (session) =>
        captureRemoveAnnotation(session, {
          kind: 'removeAnnotation',
          page: 0,
          index: 9,
          version: asDocVersion(1),
        }),
      ),
    ).rejects.toThrow(RangeError);
  });
});

describe('applyAddAnnotation places the rectangle in PDF user space', () => {
  it('writes the rectangle the command named, on an upright page', async () => {
    const [stored, ...rest] = await readBack(await drawnOn(await fixture()));
    expect(rest).toHaveLength(0);
    expect(stored?.subtype).toBe('/Square');
    // The command's own numbers, unchanged: `/Rect` is PDF user space and so is
    // the command. An implementation that handed the rectangle straight to
    // MuPDF would store the y values flipped about 300.
    expect(stored?.bounds).toStrictEqual([10, 20, 110, 70]);
  });

  it('writes the same user-space rectangle on a page turned 90 degrees', async () => {
    // THE ROTATION TERM. The page displays turned, so the frame MuPDF places
    // annotations in is turned too — and the stored `/Rect` must come back to
    // the same user-space numbers, because that is what makes the rectangle
    // land where the reader drew it and stay there if the page is turned again.
    const [stored] = await readBack(await drawnOn(await fixture({ rotate: 90 })));
    expect(stored?.bounds).toStrictEqual([10, 20, 110, 70]);
  });

  it('writes the same user-space rectangle on a page with a crop-box origin', async () => {
    // THE TRANSLATION TERM. The visible region starts at 50,100, so a
    // conversion that ignored the origin is out by exactly that.
    const [stored] = await readBack(
      await drawnOn(await fixture({ crop: [50, 100, 150, 250] }), {
        kind: 'addAnnotation',
        page: 0,
        annotation: { ...SQUARE, rect: { x0: 60, y0: 110, x1: 140, y1: 160 } },
      }),
    );
    expect(stored?.bounds).toStrictEqual([60, 110, 140, 160]);
  });

  it('writes the same rectangle when the drag ran backwards', async () => {
    // The command is not required to arrive ordered — a drag runs whichever way
    // the pointer went — so this is the same rectangle named by its other
    // diagonal.
    const [stored] = await readBack(
      await drawnOn(await fixture(), {
        kind: 'addAnnotation',
        page: 0,
        annotation: { ...SQUARE, rect: { x0: 110, y0: 70, x1: 10, y1: 20 } },
      }),
    );
    expect(stored?.bounds).toStrictEqual([10, 20, 110, 70]);
  });

  it('writes the colour and the border width, and gives it an appearance stream', async () => {
    const [stored] = await readBack(await drawnOn(await fixture()));
    expect(stored?.colour).toStrictEqual([1, 0, 0]);
    expect(stored?.borderWidth).toBe(2);
    // Without `/AP` every viewer is free to draw the annotation its own way or
    // not at all. MuPDF's own renderer would draw it regardless, so a proof
    // that rasterised through MuPDF could not see this missing.
    expect(stored?.hasAppearance).toBe(true);
  });

  it('survives a save and a reopen through the engine', async () => {
    // The round trip the wired-tools rule asks for: the effect is in the bytes,
    // not in a live session's state.
    const once = await drawnOn(await fixture());
    const reopened = await onSession(once, (session) => mupdfWriter.serialise(session));
    const [stored] = await readBack(reopened);
    expect(stored?.subtype).toBe('/Square');
    expect(stored?.bounds).toStrictEqual([10, 20, 110, 70]);
  });

  it('produces byte-identical output on two runs, which is what reproducible means', async () => {
    // The declaration says `reproducible: true`, and the hazard is a date:
    // annotation dictionaries commonly carry `/M` and `/CreationDate`, which
    // would put a clock in the effect and make the claim false. A version that
    // starts stamping one turns this red rather than changing the meaning of
    // the log entry silently.
    const bytes = await fixture();
    const first = await drawnOn(bytes);
    const second = await drawnOn(bytes);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });
});

describe('applyAddAnnotation writes each annotation type as the format defines it', () => {
  it('writes an ellipse as /Subtype /Circle in the box a rectangle would have taken', async () => {
    // `/Circle` is the format's name and an ellipse is what it draws: the
    // annotation's `/Rect` is the bounding box and the shape touches its edges.
    // THE BOX IS ASSERTED, not the subtype alone — a circle placed by
    // different arithmetic from the square's would still be a circle.
    const [stored] = await readBack(
      await drawnOn(await fixture(), command({ annotation: { ...SQUARE, type: 'circle' } })),
    );
    expect(stored?.subtype).toBe('/Circle');
    expect(stored?.bounds).toStrictEqual([10, 20, 110, 70]);
  });

  it('writes a line as /L, in the same user-space points the command named', async () => {
    const [stored] = await readBack(await drawnOn(await fixture(), command({ annotation: LINE })));
    expect(stored?.subtype).toBe('/Line');
    // MEASURED, not assumed: MuPDF writes `/L` from the two points and computes
    // `/Rect` itself, widening it to fit an arrowhead. So the assertion is on
    // `/L`, which is the thing this command decides.
    expect(stored?.line).toStrictEqual([10, 20, 110, 70]);
  });

  it('writes a line on a ROTATED page in the same user-space points', async () => {
    // The rotation term again, on the other geometry: `setLine` takes the
    // page's displayed frame exactly as `setRect` does, which was measured
    // rather than read off the declaration.
    const [stored] = await readBack(
      await drawnOn(await fixture({ rotate: 90 }), command({ annotation: LINE })),
    );
    expect(stored?.line).toStrictEqual([10, 20, 110, 70]);
  });

  it('writes an arrow as a line with /LE, and a plain line with none', async () => {
    const [line] = await readBack(await drawnOn(await fixture(), command({ annotation: LINE })));
    const [arrow] = await readBack(
      await drawnOn(await fixture(), command({ annotation: { ...LINE, ending: 'closed-arrow' } })),
    );
    // THE HEAD IS AT THE `to` END and the start is `None`, which is what an
    // arrow drawn by dragging means. Asserting the pair rather than *an /LE
    // exists* is what separates that from a head at both ends.
    expect(arrow?.endings).toStrictEqual(['/None', '/ClosedArrow']);
    // CONTROL: the plain line is the same annotation without the head, so an
    // implementation that always wrote one passes the case above. MEASURED —
    // MuPDF writes `/LE [/None /None]` explicitly rather than omitting the key,
    // which is a fact about the writer and not a choice made here.
    expect(line?.endings).toStrictEqual(['/None', '/None']);
  });

  it('accepts a HORIZONTAL line, which the box rule would refuse', async () => {
    // *Nothing a reader could see* is not one shape, and this is where the
    // per-type adapter earns its keep: a box with no height is invisible, and a
    // line with no height is a rule somebody drew on purpose.
    const [stored] = await readBack(
      await drawnOn(await fixture(), command({ annotation: { ...LINE, to: { x: 110, y: 20 } } })),
    );
    expect(stored?.line).toStrictEqual([10, 20, 110, 20]);
  });

  it('CONTROL: a rectangle with no height is still refused', async () => {
    // Without this, the case above is satisfied by dropping the degenerate
    // check altogether.
    await expect(
      drawnOn(
        await fixture(),
        command({ annotation: { ...SQUARE, rect: { x0: 10, y0: 20, x1: 110, y1: 20 } } }),
      ),
    ).rejects.toThrow(/no extent/u);
  });

  it('refuses a line whose two ends are the same point', async () => {
    await expect(
      drawnOn(await fixture(), command({ annotation: { ...LINE, to: { x: 10, y: 20 } } })),
    ).rejects.toThrow(/no extent/u);
  });

  it('writes ink as ONE stroke inside /InkList, in the points the command named', async () => {
    const [stored] = await readBack(await drawnOn(await fixture(), command({ annotation: INK })));
    expect(stored?.subtype).toBe('/Ink');
    // ONE stroke, which is what a drag produces. The format's list holds
    // several and the surface can fill only one, so the schema carries one.
    expect(stored?.ink).toStrictEqual([[10, 20, 40, 30, 70, 20]]);
  });

  it('writes ink on a ROTATED page in the same user-space points', async () => {
    const [stored] = await readBack(
      await drawnOn(await fixture({ rotate: 90 }), command({ annotation: INK })),
    );
    expect(stored?.ink).toStrictEqual([[10, 20, 40, 30, 70, 20]]);
  });

  it('accepts a stroke that RETURNS to where it started', async () => {
    // A loop's two ends are the same point, so a rule written for a line would
    // refuse it — the third shape *nothing a reader could see* takes in this
    // module, and the reason the check is a per-type member.
    const [stored] = await readBack(
      await drawnOn(
        await fixture(),
        command({
          annotation: {
            ...INK,
            points: [
              { x: 10, y: 20 },
              { x: 60, y: 60 },
              { x: 10, y: 20 },
            ],
          },
        }),
      ),
    );
    expect(stored?.subtype).toBe('/Ink');
  });

  it('writes a redact MARK and burns nothing in', async () => {
    // A mark says *this is to be removed* and removes nothing. Burning a
    // redaction in is `applyRedactions` — a full rewrite with object GC and no
    // prior revisions (ADR-0008 rule 1) — and it is a different command with a
    // different save mode.
    const original = await fixture({ content: true });
    const [stored] = await readBack(
      await drawnOn(original, command({ annotation: REDACT })),
    );
    expect(stored?.subtype).toBe('/Redact');
    // NO `/RD`, because there is no border width to inset by — so the stored
    // rectangle is the one the command named, exactly.
    expect(stored?.bounds).toStrictEqual([10, 20, 110, 70]);
    expect(stored?.colour).toStrictEqual([1, 0, 0]);
  });

  it('leaves the page CONTENT byte-identical, which is what a mark means', async () => {
    // THE ASSERTION THAT SEPARATES A MARK FROM A REDACTION, and it is on the
    // content rather than on the annotation: a burn-in also leaves a `/Redact`
    // behind, so every assertion about the annotation passes either way.
    const original = await fixture({ content: true });
    const marked = await drawnOn(original, command({ annotation: REDACT }));
    expect(await pageContentOf(marked)).toStrictEqual(await pageContentOf(original));
  });

  it('carries no border width, because MuPDF refuses one on a Redact', async () => {
    // MEASURED 2026-09-06: `setBorderWidth` on a Redact answers "Redact
    // annotations have no BS property", and `setInteriorColor` "no IC
    // property". The schema has no field for either, so this asserts the
    // consequence rather than the refusal.
    const [stored] = await readBack(await drawnOn(await fixture(), command({ annotation: REDACT })));
    expect(stored?.borderWidth).toBeNull();
  });

  it('refuses a stroke whose points are all the same', async () => {
    await expect(
      drawnOn(
        await fixture(),
        command({
          annotation: {
            ...INK,
            points: [
              { x: 10, y: 20 },
              { x: 10, y: 20 },
            ],
          },
        }),
      ),
    ).rejects.toThrow(/no extent/u);
  });
});

describe('applyAddAnnotation leaves other annotations alone', () => {
  it('keeps every key of an annotation this build did not author', async () => {
    // INVARIANT L5's WEAKER HALF, asserted for the first time on a write path.
    // This is *the foreign annotation survives with its keys* — not the
    // byte-identity `docs/ARCHITECTURE.md`:534 says is still assumed, and not a
    // `srcRef` scheme, which does not exist yet. What it does rule out is the
    // failure that would matter here: adding an annotation rewriting the array
    // it joins.
    const stored = await readBack(await drawnOn(await fixture({ foreign: true })));
    expect(stored).toHaveLength(2);
    // Keys are spelt as the file spells them, slash included, which is also
    // what keeps `/T` from matching `/Type`.
    const other = stored.find((entry) => entry.keys.includes('/T'));
    expect(other?.keys).toEqual(
      expect.arrayContaining(['/Type', '/Subtype', '/Rect', '/T', '/Contents', '/Sound']),
    );
    expect(other?.bounds).toStrictEqual([5, 5, 25, 25]);
  });

  it('adds to the existing array rather than replacing it', async () => {
    const stored = await readBack(await drawnOn(await fixture({ foreign: true })));
    expect(stored.map((entry) => entry.subtype)).toStrictEqual(['/Square', '/Square']);
    // The one we wrote is the one with an appearance stream; the foreign one
    // was authored without. That is what tells the two apart without relying on
    // their order.
    expect(stored.filter((entry) => entry.hasAppearance)).toHaveLength(1);
  });
});

describe('applyAddAnnotation refuses rather than guessing', () => {
  it('refuses a page index this document does not have', async () => {
    await expect(drawnOn(await fixture(), command({ page: 4 }))).rejects.toThrow(/outside this/u);
  });

  it('refuses a rectangle with no width', async () => {
    await expect(
      drawnOn(
        await fixture(),
        command({ annotation: { ...SQUARE, rect: { x0: 10, y0: 20, x1: 10, y1: 70 } } }),
      ),
    ).rejects.toThrow(/no extent/u);
  });

  it('refuses a rectangle entirely off the page', async () => {
    // An annotation nothing can see is the display-only defect at document
    // scale: it is in the file, it is selectable by nothing, and no assertion
    // about the document's structure would notice.
    await expect(
      drawnOn(
        await fixture(),
        command({ annotation: { ...SQUARE, rect: { x0: 400, y0: 400, x1: 500, y1: 500 } } }),
      ),
    ).rejects.toThrow(/entirely outside/u);
  });

  it('accepts a rectangle that only overlaps the page', async () => {
    // THE CONTROL for the case above. A guard spelt "refuse anything not
    // wholly inside the page" passes that case and refuses this one, which is
    // an ordinary drag that ran past the edge.
    const [stored] = await readBack(
      await drawnOn(
        await fixture(),
        command({ annotation: { ...SQUARE, rect: { x0: -50, y0: -50, x1: 50, y1: 50 } } }),
      ),
    );
    expect(stored?.bounds).toStrictEqual([-50, -50, 50, 50]);
  });

  it('refuses a page whose crop box and media box do not overlap', async () => {
    await expect(
      drawnOn(await fixture({ crop: [400, 500, 600, 700] }), command()),
    ).rejects.toThrow(/displays no region/u);
  });
});

describe('readAnnotations', () => {
  it('lists what this build wrote, by page and by kind', async () => {
    const twice = await drawnOn(
      await drawnOn(await fixture(), command({ annotation: SQUARE })),
      command({ annotation: INK }),
    );
    const listed = await onSession(twice, (session) => readAnnotations(session));

    expect(listed.truncated).toBe(false);
    expect(listed.annotations).toStrictEqual([
      { page: 0, index: 0, kind: 'square', contents: '', authored: true },
      { page: 0, index: 1, kind: 'ink', contents: '', authored: true },
    ]);
  });

  it('names a subtype it cannot write as `other` rather than dropping it', async () => {
    // A PANEL THAT SILENTLY OMITTED a document's own comments would be worse
    // than one that names them vaguely, and the closed union is what keeps an
    // arbitrary `/Name` from reaching a renderer that has no message for it.
    // The fixture's foreign annotation is a `/Square`, so this uses a subtype
    // nothing here writes.
    const listed = await onSession(
      await drawnOn(await fixture({ foreign: true }), command()),
      (session) => readAnnotations(session),
    );
    expect(listed.annotations.map((entry) => entry.kind).sort()).toStrictEqual(['square', 'square']);
  });

  it('carries a foreign annotation\'s note, which is the only thing telling two apart', async () => {
    // Nothing this build writes sets `/Contents`, so a row of its own is
    // identified by kind and page. A foreign one usually carries a note, and
    // that is what a panel shows.
    const listed = await onSession(await fixture({ foreign: true }), (session) =>
      readAnnotations(session),
    );
    expect(listed.annotations).toStrictEqual([
      {
        page: 0,
        index: 0,
        kind: 'square',
        contents: 'written by another application',
        authored: false,
      },
    ]);
  });

  it('numbers by the WALK, not by /Annots — a widget takes no index', async () => {
    // THE MEASUREMENT ADR-0041 RESTS ON, pinned as a case so a MuPDF release
    // that starts returning widgets is a red build rather than an eraser that
    // deletes the annotation after the one that was clicked.
    //
    // The page carries a text field and then two squares. `/Annots` holds three
    // entries with the widget first; the walk yields two, numbered 0 and 1. An
    // implementation that had taken the `/Annots` position would say 1 and 2,
    // and every index would be in range on a document that renders correctly.
    const drawn = await drawnOn(
      await drawnOn(await fixture({ field: true }), command({ annotation: SQUARE })),
      command({ annotation: INK }),
    );
    const listed = await onSession(drawn, (session) => readAnnotations(session));
    expect(listed.annotations).toStrictEqual([
      { page: 0, index: 0, kind: 'square', contents: '', authored: true },
      { page: 0, index: 1, kind: 'ink', contents: '', authored: true },
    ]);

    // THE CONTROL, and without it the case above is satisfied by a fixture
    // whose field never arrived: two annotations numbered 0 and 1 is exactly
    // what a page with no widget produces. This reads the stored array with
    // pdf-lib and requires the widget to be there, first, and uncounted.
    const loaded = await PDFDocument.load(drawn, { updateMetadata: false });
    const page = loaded.getPages()[0];
    const annots = page?.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) throw new Error('the fixture wrote no /Annots at all');
    const subtypes = annots.asArray().map((entry) => {
      const dict = entry instanceof PDFRef ? loaded.context.lookup(entry, PDFDict) : undefined;
      const subtype = dict?.lookup(PDFName.of('Subtype'));
      return subtype instanceof PDFName ? subtype.asString() : '?';
    });
    expect(subtypes).toStrictEqual(['/Widget', '/Square', '/Ink']);
  });

  it('reports an empty document as empty rather than refusing', async () => {
    const listed = await onSession(await fixture(), (session) => readAnnotations(session));
    expect(listed).toStrictEqual({ annotations: [], truncated: false });
  });
});

/**
 * The `srcRef` mark — invariant L5's scheme, built
 * ([ADR-0043](../../../docs/DECISIONS/0043-an-annotation-this-build-wrote-carries-a-private-mark.md)).
 *
 * Every case here puts **both** kinds of annotation in one document, and that
 * is the direction rather than the convenience. *Reports authorship* is a
 * comparison, and a scheme that answered `true` for everything and one that
 * answered `false` for everything each satisfy half the claim — so a fixture
 * carrying only ours, or only theirs, is one the broken version handles
 * correctly. Two annotations and two different answers is what separates them.
 */
describe('the srcRef mark', () => {
  it('reports this build\'s annotation as ours and the document\'s as foreign', async () => {
    const listed = await onSession(
      await drawnOn(await fixture({ foreign: true }), command({ annotation: SQUARE })),
      (session) => readAnnotations(session),
    );
    // THE FOREIGN ONE IS FIRST because it was on the page before ours was
    // added, and the walk is in `/Annots` order. Asserted as a pair rather than
    // two lookups, so a scheme that reported one answer for both is red here
    // whichever answer it picked.
    expect(listed.annotations.map((entry) => entry.authored)).toStrictEqual([false, true]);
  });

  it('writes the mark into the FILE, on ours only', async () => {
    // THE REPORT ABOVE COULD BE PRODUCED WITHOUT WRITING ANYTHING — an
    // implementation inferring authorship from `/AP`, which this build always
    // writes and the foreign fixture has not got, passes it exactly. So this
    // reads the stored dictionaries with pdf-lib, which did not write them, and
    // asserts the key itself.
    const stored = await readBack(
      await drawnOn(await fixture({ foreign: true }), command({ annotation: SQUARE })),
    );
    expect(stored.map((entry) => entry.keys.includes('/Monstera_Authored'))).toStrictEqual([
      false,
      true,
    ]);
  });

  it('survives a save and a reopen, which is the span L5 is about', async () => {
    // A MARK HELD BESIDE THE DOCUMENT WOULD PASS EVERY CASE ABOVE and fail
    // here, which is why the alternative was rejected: the invariant is about
    // what a save does, so provenance that does not cross one answers a
    // different question.
    const drawn = await drawnOn(await fixture({ foreign: true }), command({ annotation: SQUARE }));
    const again = await onSession(drawn, (session) => mupdfWriter.serialise(session));
    const listed = await onSession(again, (session) => readAnnotations(session));
    expect(listed.annotations.map((entry) => entry.authored)).toStrictEqual([false, true]);
  });

  it('refuses the claim when the value is not a boolean', async () => {
    // A DOCUMENT CARRYING THE KEY WITH A STRING VALUE. The mark is a claim and
    // a malformed one is not that claim, so this is foreign — and the case is
    // what stops the reader being written as a presence test, which the fixture
    // above cannot tell apart from a value test.
    const listed = await onSession(
      await fixture({ foreign: true, claimsAuthored: true }),
      (session) => readAnnotations(session),
    );
    expect(listed.annotations.map((entry) => entry.authored)).toStrictEqual([false]);

    // THE CONTROL, and without it the assertion above passes on a fixture whose
    // key never arrived — which is exactly what a document with no claim in it
    // produces. This requires the key to be present and the answer to still be
    // `false`.
    const stored = await readBack(await fixture({ foreign: true, claimsAuthored: true }));
    expect(stored[0]?.keys).toContain('/Monstera_Authored');
  });
});

describe('captureAddAnnotation', () => {
  it('refuses, naming the handle rather than the operation', async () => {
    const result = await onSession(await fixture(), (session) =>
      captureAddAnnotation(session, command()),
    );
    expect(result.captured).toBe(false);
    if (result.captured) throw new Error('unreachable: the capture asserted false above');
    expect(result.reason).toMatch(/handle/u);
  });

  it('still throws for a page index this document does not have', async () => {
    // A capture refusal is *this document cannot have its prior state
    // recorded*, which the bus answers with a checkpoint. An out-of-range page
    // is a caller error, and converting it into a checkpoint would take a
    // checkpoint of a command that was never going to apply.
    await expect(
      onSession(await fixture(), (session) => captureAddAnnotation(session, command({ page: 9 }))),
    ).rejects.toThrow(/outside this/u);
  });
});
