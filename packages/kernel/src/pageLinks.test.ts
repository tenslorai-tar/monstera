import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFString } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { CommandOfKind } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';

import { mupdfWriter } from './mupdfWriter.js';
import { readAnnotations } from './pageAnnotations.js';
import { applyAddLink, applySetLinkOutline, captureAddLink, readLinkAddress, readPageLinks } from './pageLinks.js';

/** Applies one `addLink` to a link-free three-page document and serialises. */
async function written(command: CommandOfKind<'addLink'>): Promise<Uint8Array> {
  const blank = await PDFDocument.create();
  blank.addPage([200, 200]);
  blank.addPage([200, 200]);
  blank.addPage([200, 200]);
  const session = await mupdfWriter.open(await blank.save({ useObjectStreams: false }));
  try {
    await applyAddLink(session, command);
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * The link reader, against documents whose links this file put there.
 *
 * ## The fixture is built with pdf-lib, not read from a corpus
 *
 * Which links a page carries and where they point is then a fact about the
 * generator rather than an opinion of the thing under test — the same property
 * `textStructure.mjs`' fixtures have and for the same reason. A found document
 * would make a wrong answer indistinguishable from a document nobody read.
 *
 * The annotations are written as raw PDF objects because pdf-lib has no link
 * helper. That is the format's own spelling: a `/Link` annotation with `/Dest`
 * for an internal destination and an `/A << /S /URI >>` action for an external
 * one, which is exactly the split MuPDF reports through `isExternal()`.
 */
async function buildDocumentWithLinks(): Promise<PDFDocument> {
  const document = await PDFDocument.create();
  const first = document.addPage([200, 200]);
  const second = document.addPage([200, 200]);
  document.addPage([200, 200]);

  // AN INTERNAL LINK TO THE THIRD PAGE, not the second: a destination one page
  // along would be satisfied by an off-by-one, and the point of a resolved page
  // index is that it is the page the document names.
  const third = document.getPage(2);
  const internal = document.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: PDFArray.withContext(document.context),
    Dest: PDFArray.withContext(document.context),
  });
  const rect = internal.get(PDFName.of('Rect'));
  if (rect instanceof PDFArray) {
    for (const value of [10, 20, 90, 40]) rect.push(PDFNumber.of(value));
  }
  const dest = internal.get(PDFName.of('Dest'));
  if (dest instanceof PDFArray) {
    dest.push(third.ref);
    dest.push(PDFName.of('Fit'));
  }

  const external = document.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: PDFArray.withContext(document.context),
    A: document.context.obj({
      Type: PDFName.of('Action'),
      S: PDFName.of('URI'),
      URI: PDFString.of('https://example.org/thing'),
    }),
  });
  const outerRect = external.get(PDFName.of('Rect'));
  if (outerRect instanceof PDFArray) {
    for (const value of [10, 60, 90, 80]) outerRect.push(PDFNumber.of(value));
  }

  const annots = PDFArray.withContext(document.context);
  annots.push(document.context.register(internal));
  annots.push(document.context.register(external));
  first.node.set(PDFName.of('Annots'), annots);

  // THE SECOND PAGE CARRIES NONE, which is what makes the per-page case below a
  // statement about the page rather than about the document.
  void second;

  return document;
}

/** The flat document, saved. */
async function documentWithLinks(): Promise<Uint8Array> {
  return (await buildDocumentWithLinks()).save({ useObjectStreams: false });
}

/**
 * The same document with a NESTED page tree.
 *
 * ## The checklist's own hard shape, and it is not decoration here
 *
 * *"flat page tree → nested page tree (the reorder was wrong on nested)"* is
 * item 2's first example, and a link reader is exactly where it could bite
 * again: an internal destination names a page **object**, and turning that into
 * an index means walking the tree. A reader that counted `/Kids` at the root
 * would be right on every document pdf-lib produces and wrong on most real
 * ones, because pdf-lib builds flat trees and real producers do not.
 *
 * The tree here is `root → [ inner → [p0, p1], p2 ]`, so the destination on
 * page 0 points at a page that is a direct child of the root while the linking
 * page is two levels down. A reader confusing tree position with page index
 * cannot get 2 out of that by luck.
 *
 * ## Built from the SAME document, never copied into a new one
 *
 * The first version used `copyPages` and the nested case failed at page 0 —
 * which read exactly like a tree-walking defect. It was not. A probe on the
 * COPIED-BUT-FLAT document failed identically: `copyPages` does not carry the
 * `/Dest` reference, so the destination was already broken before anything was
 * nested. Two axes, one attributed conclusion, and the wrong one.
 *
 * That is AAAA-8's tell — *what else is different about the odd point?* — and
 * the probe is what answered it. The tree is now restructured in place, so the
 * only thing that differs from the flat fixture is the tree.
 */
async function nestedDocumentWithLinks(): Promise<Uint8Array> {
  const document = await buildDocumentWithLinks();
  const root = document.catalog.Pages();
  const kids = root.Kids();
  // THE COUNT, not three undefined-checks. `PDFArray.get` is typed as always
  // answering, so comparing each result to `undefined` is a condition the types
  // say can never hold — and the thing actually worth asserting is that the
  // fixture has the three pages this nesting assumes.
  if (kids.size() !== 3) {
    throw new Error(
      `the fixture should have three pages before nesting, not ${String(kids.size())}`,
    );
  }
  const first = kids.get(0);
  const second = kids.get(1);
  const third = kids.get(2);

  // An intermediate /Pages node holding the first two, with the third left as a
  // direct child — so the tree is genuinely uneven rather than merely deeper.
  const innerKids = PDFArray.withContext(document.context);
  innerKids.push(first);
  innerKids.push(second);
  const inner = document.context.obj({
    Type: PDFName.of('Pages'),
    Kids: innerKids,
    Count: PDFNumber.of(2),
    Parent: root.get(PDFName.of('Parent')) ?? document.catalog.get(PDFName.of('Pages')),
  });
  const innerRef = document.context.register(inner);

  const outerKids = PDFArray.withContext(document.context);
  outerKids.push(innerRef);
  outerKids.push(third);
  root.set(PDFName.of('Kids'), outerKids);

  // The two moved pages now hang off the intermediate node, not the root. A
  // /Parent left pointing at the root is a tree that disagrees with itself, and
  // MuPDF is entitled to read either direction.
  for (const ref of [first, second]) {
    const page = document.context.lookup(ref);
    if (page !== undefined && 'set' in page && typeof page.set === 'function') {
      (page as { set: (key: unknown, value: unknown) => void }).set(
        PDFName.of('Parent'),
        innerRef,
      );
    }
  }

  return document.save({ useObjectStreams: false });
}

describe('readPageLinks', () => {
  it('reads both kinds, and RESOLVES an internal destination to its page', async () => {
    const session = await mupdfWriter.open(await documentWithLinks());
    try {
      const { links, truncated } = await readPageLinks(session, 0);
      expect(truncated).toBe(false);

      expect(links).toHaveLength(2);
      // PAGE 2 ZERO-BASED, which is the third page — the one the destination
      // names. A reader that returned the annotation's own page, or one along,
      // fails here.
      expect(links[0]).toStrictEqual({
        kind: 'internal',
        page: 2,
        bounds: { x0: 10, y0: 160, x1: 90, y1: 180 },
        // NO `/Border` AND NO `/BS`, which the format draws one point wide (§12.5.2) — so it reads `thin`, with no colour of
        // its own.
        outline: 'thin',
      });
      expect(links[1]).toMatchObject({
        kind: 'external',
        uri: 'https://example.org/thing',
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('reads 4,200 links on one page, and shows a 3,000-character tracking link shortened', async () => {
    // JOURNAL, *No document-size refusals*, table A row 7: past 4,096 links, or one URI past 2,048 characters, the
    // answer was refused whole and the panel said the page's links could not be read.
    const document = await PDFDocument.create();
    const page = document.addPage([600, 800]);
    const context = document.context;
    const tracking = `https://example.org/track?id=${'a'.repeat(2970)}`;
    const annots = context.obj(
      Array.from({ length: 4200 }, (_, index) =>
        context.register(
          context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [index % 500, 10, (index % 500) + 5, 15],
            A: { S: 'URI', URI: PDFString.of(index === 3000 ? tracking : `https://example.org/${String(index)}`) },
          }),
        ),
      ),
    );
    page.node.set(PDFName.of('Annots'), annots);

    const session = await mupdfWriter.open(await document.save({ useObjectStreams: false }));
    try {
      const { links, truncated } = await readPageLinks(session, 0);
      expect(links).toHaveLength(4200);
      expect(truncated).toBe(false);
      // THE WALK'S STOP (AAAAAAA-6), at a bound one under the links: it stops and says so, and at the count it is whole.
      const stopped = await readPageLinks(session, 0, 4199);
      expect([stopped.links.length, stopped.truncated]).toStrictEqual([4199, true]);
      expect((await readPageLinks(session, 0, 4200)).truncated).toBe(false);
      const long = links[3000];
      expect(long?.kind).toBe('external');
      if (long?.kind !== 'external') throw new Error('link 3,000 should be external');
      expect(long.uri).toHaveLength(2048);
      expect(long.uri.startsWith('https://example.org/track?id=aaa')).toBe(true);
      expect(long.uri.endsWith('…')).toBe(true);
      // CONTROL: the fixture's URI is past the bound, and the ones around it are whole.
      expect(tracking.length).toBeGreaterThan(2048);
      expect(links[2999]).toMatchObject({ uri: 'https://example.org/2999' });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('answers per PAGE, so a page with no links reports none', async () => {
    // The control for the case above: without it, a reader that returned every
    // link in the document would pass — and that is the answer invariant 11
    // forbids as well as the wrong one.
    const session = await mupdfWriter.open(await documentWithLinks());
    try {
      expect((await readPageLinks(session, 1)).links).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('resolves the same destination on a NESTED page tree', async () => {
    // Item 2's first hard shape. pdf-lib builds flat trees and real producers
    // do not, so every case above exercises the layout least likely to break —
    // and a reader that confused tree position with page index would pass all
    // of them.
    const session = await mupdfWriter.open(await nestedDocumentWithLinks());
    try {
      const { links } = await readPageLinks(session, 0);
      expect(links[0]).toMatchObject({ kind: 'internal', page: 2 });
      // AND THE PER-PAGE ANSWER SURVIVES THE NESTING, which is the half a
      // destination-only case would miss: page 1 sits under the intermediate
      // node beside page 0, so a reader walking the tree wrongly is as likely
      // to hand back its neighbour's links as the right page's.
      expect((await readPageLinks(session, 1)).links).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('adds an external link, and the reader sees it as one', async () => {
    // WRITTEN THROUGH THE COMMAND AND READ THROUGH THE READER, which is the
    // pair that matters here: `createLink` and `getLinks` are the two halves of
    // MuPDF's own link model, and the measurement that made this a separate
    // command is that `getAnnotations()` sees neither.
    const added = await written({
      kind: 'addLink',
      page: 0,
      rect: { x0: 10, y0: 20, x1: 110, y1: 70 },
      target: { kind: 'uri', uri: 'https://example.org/a' },
    });
    const session = await mupdfWriter.open(added);
    try {
      const { links } = await readPageLinks(session, 0);
      expect(links).toContainEqual({
        kind: 'external',
        uri: 'https://example.org/a',
        // MuPDF's own frame, y down from the page's top: a `/Rect` whose PDF
        // y runs 20–70 on a 200-high page comes back as 130–180.
        bounds: { x0: 10, y0: 130, x1: 110, y1: 180 },
        // WITH NO BORDER ASKED, MuPDF's own `/BS /W 0`: a zero-width outline, which is why `addLink` writes one on request.
        outline: 'none',
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('adds a PAGE link that resolves to the page it names', async () => {
    // THE HALF A URI CASE CANNOT REACH. An internal destination is a `/GoTo`
    // array MuPDF formats, and the assertion is that `resolveLink` — the same
    // function the reader uses — answers the page the command asked for. A
    // spelling this build invented would store something that reads back as
    // external, or as page −1.
    const added = await written({
      kind: 'addLink',
      page: 0,
      rect: { x0: 10, y0: 20, x1: 110, y1: 70 },
      target: { kind: 'page', page: 2 },
    });
    const session = await mupdfWriter.open(added);
    try {
      expect((await readPageLinks(session, 0)).links).toContainEqual(
        expect.objectContaining({ kind: 'internal', page: 2 }),
      );
    } finally {
      await mupdfWriter.close(session);
    }
  });

  describe('the link’s own OUTLINE, so it shows in any viewer (the owner’s review of 2026-10-07)', () => {
    /** Every `/Link` of page 0 as the saved bytes say: its `/Border` and `/C`, read back by ANOTHER library. */
    async function outlines(bytes: Uint8Array): Promise<{ border: number[] | undefined; colour: number[] | undefined }[]> {
      const document = await PDFDocument.load(bytes);
      const annots = document.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
      const numbersOf = (value: unknown): number[] | undefined =>
        value instanceof PDFArray ? value.asArray().map((entry) => (entry instanceof PDFNumber ? entry.asNumber() : Number.NaN)) : undefined;
      return annots.asArray().flatMap((entry) => {
        const dictionary = document.context.lookup(entry);
        if (!(dictionary instanceof Object) || !('get' in dictionary)) return [];
        const dict = dictionary as { get: (name: PDFName) => unknown };
        return [{ border: numbersOf(dict.get(PDFName.of('Border'))), colour: numbersOf(dict.get(PDFName.of('C'))) }];
      });
    }
    const link = (border?: 'none' | 'thin', target: CommandOfKind<'addLink'>['target'] = { kind: 'uri', uri: 'https://example.org/a' }): CommandOfKind<'addLink'> => ({
      kind: 'addLink',
      page: 0,
      rect: { x0: 10, y0: 20, x1: 110, y1: 70 },
      target,
      ...(border === undefined ? {} : { border }),
    });

    it('a THIN link is written with a one-point blue border, and it SURVIVES the save', async () => {
      const [only] = await outlines(await written(link('thin')));
      expect(only).toStrictEqual({ border: [0, 0, 1], colour: [0, 0.4, 0.8] });
    });

    it('the same for a PAGE link — one fix for every link, not two', async () => {
      const [only] = await outlines(await written(link('thin', { kind: 'page', page: 2 })));
      expect(only).toStrictEqual({ border: [0, 0, 1], colour: [0, 0.4, 0.8] });
    });

    it('CONTROL: NONE writes an explicit zero-width border and no colour, which is what separates it from thin', async () => {
      const [only] = await outlines(await written(link('none')));
      expect(only?.border).toStrictEqual([0, 0, 0]);
      expect(only?.colour).toBeUndefined();
    });

    it('CONTROL: with no border asked the engine’s own entries are left, so the field is what writes it', async () => {
      const [only] = await outlines(await written(link()));
      expect(only?.border).not.toStrictEqual([0, 0, 1]);
      expect(only?.colour).toBeUndefined();
    });
  });

  it('is INVISIBLE to the annotation walk, which is what made it its own command', async () => {
    // MEASURED 2026-09-06: `createLink` makes an object `getAnnotations()` does
    // not return, and `createAnnotation('Link')` makes a different one that it
    // does — and that second one never appears among the page's links. Routing
    // this through the annotation table would have taken the second silently.
    //
    // The control is on the same document: the link is there, and the walk is
    // empty. Without it this passes on a command that wrote nothing at all.
    const added = await written({
      kind: 'addLink',
      page: 0,
      rect: { x0: 10, y0: 20, x1: 110, y1: 70 },
      target: { kind: 'uri', uri: 'https://example.org/a' },
    });
    const session = await mupdfWriter.open(added);
    try {
      expect((await readPageLinks(session, 0)).links).toHaveLength(1);
      const listed = await readAnnotations(session);
      expect(listed.annotations).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('refuses a rectangle with no area, and one entirely off the page', async () => {
    // A link nothing can click is the display-only defect with a cursor on it:
    // the region is in the file and no reader can reach it.
    await expect(
      written({
        kind: 'addLink',
        page: 0,
        rect: { x0: 10, y0: 20, x1: 10, y1: 70 },
        target: { kind: 'uri', uri: 'https://example.org/a' },
      }),
    ).rejects.toThrow(/no width or no height/u);
    await expect(
      written({
        kind: 'addLink',
        page: 0,
        rect: { x0: 900, y0: 900, x1: 1000, y1: 1000 },
        target: { kind: 'uri', uri: 'https://example.org/a' },
      }),
    ).rejects.toThrow(/entirely outside/u);
  });

  it('refuses a target page the document does not have', async () => {
    await expect(
      written({
        kind: 'addLink',
        page: 0,
        rect: { x0: 10, y0: 20, x1: 110, y1: 70 },
        target: { kind: 'page', page: 9 },
      }),
    ).rejects.toThrow(/outside this document/u);
  });

  it('records no prior state, and says which handle is missing', async () => {
    // `captureAddAnnotation`'s refusal on a different object, and the reason has
    // to say so: that one waited for a handle ADR-0041 then built, and this one
    // waits for a handle nothing has proposed.
    const session = await mupdfWriter.open(await documentWithLinks());
    try {
      const captured = await captureAddLink(session, {
        kind: 'addLink',
        page: 0,
        rect: { x0: 10, y0: 20, x1: 110, y1: 70 },
        target: { kind: 'uri', uri: 'https://example.org/a' },
      });
      expect(captured.captured).toBe(false);
      expect(captured.captured ? '' : captured.reason).toMatch(/no identity/u);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('REFUSES a page outside the document rather than answering empty', async () => {
    // Empty is what a caller reads as "no links here", so an out-of-range page
    // must not produce it — the same rule `readPageText` states, and the same
    // reason: the two are indistinguishable at the call site.
    const session = await mupdfWriter.open(await documentWithLinks());
    try {
      await expect(readPageLinks(session, 3)).rejects.toBeInstanceOf(RangeError);
      await expect(readPageLinks(session, -1)).rejects.toBeInstanceOf(RangeError);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

describe('setLinkOutline (ADR-0212)', () => {
  /** What the saved bytes say about each page-0 link's outline, read by ANOTHER library: `/Border`, `/BS`'s width and `/C`. */
  async function stored(bytes: Uint8Array): Promise<{ border: unknown[] | undefined; bsWidth: number | undefined; colour: number[] | undefined }[]> {
    const document = await PDFDocument.load(bytes);
    const annots = document.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    const numbersOf = (value: unknown): number[] | undefined =>
      value instanceof PDFArray ? value.asArray().map((entry) => (entry instanceof PDFNumber ? entry.asNumber() : Number.NaN)) : undefined;
    return annots.asArray().map((entry) => {
      const dictionary = document.context.lookup(entry) as PDFDict;
      const border = dictionary.get(PDFName.of('Border'));
      const style = dictionary.get(PDFName.of('BS'));
      const width = style instanceof PDFDict ? style.get(PDFName.of('W')) : undefined;
      return {
        border:
          border instanceof PDFArray
            ? border.asArray().map((item) => (item instanceof PDFNumber ? item.asNumber() : numbersOf(item)))
            : undefined,
        bsWidth: width instanceof PDFNumber ? width.asNumber() : undefined,
        colour: numbersOf(dictionary.get(PDFName.of('C'))),
      };
    });
  }

  /** Applies `command` to `bytes` and serialises. */
  async function outlined(bytes: Uint8Array, command: CommandOfKind<'setLinkOutline'>): Promise<Uint8Array> {
    const session = await mupdfWriter.open(bytes);
    try {
      await applySetLinkOutline(session, command);
      return await mupdfWriter.serialise(session);
    } finally {
      await mupdfWriter.close(session);
    }
  }

  const VERSION = asDocVersion(1);
  const change = (index: number, rest: Partial<CommandOfKind<'setLinkOutline'>>): CommandOfKind<'setLinkOutline'> => ({
    kind: 'setLinkOutline',
    page: 0,
    index,
    version: VERSION,
    ...rest,
  });
  /** The listing's outlines for page 0, in place order. */
  async function listed(bytes: Uint8Array): Promise<{ outline: string; colour: readonly number[] | undefined }[]> {
    const session = await mupdfWriter.open(bytes);
    try {
      return (await readPageLinks(session, 0)).links.map((link) => ({ outline: link.outline, colour: link.colour }));
    } finally {
      await mupdfWriter.close(session);
    }
  }

  it('THICK on the second link writes a three-point border to THAT link only, and the listing reads it back', async () => {
    const result = await outlined(await documentWithLinks(), change(1, { outline: 'thick' }));
    const [first, second] = await stored(result);
    expect(second?.border).toStrictEqual([0, 0, 3]);
    // CONTROL: the neighbour is untouched, so a command that wrote to every link, or to the first, fails here.
    expect(first?.border).toBeUndefined();
    expect(await listed(result)).toStrictEqual([
      { outline: 'thin', colour: undefined },
      // A VISIBLE OUTLINE ON A LINK WITH NO COLOUR GETS `addLink`'s BLUE, never the black a reader would draw.
      { outline: 'thick', colour: [0, expect.closeTo(0.4, 5), expect.closeTo(0.8, 5)] },
    ]);
  });

  it('DASHED writes the dash as the border’s fourth entry, and reads back as dashed', async () => {
    const result = await outlined(await documentWithLinks(), change(0, { outline: 'dashed' }));
    expect((await stored(result))[0]?.border).toStrictEqual([0, 0, 1, [3, 2]]);
    expect((await listed(result))[0]?.outline).toBe('dashed');
  });

  it('NONE writes a zero-width border and KEEPS the colour the link had, for the next time', async () => {
    const coloured = await outlined(await documentWithLinks(), change(0, { outline: 'thin', colour: [1, 0, 0] }));
    const hidden = await outlined(coloured, change(0, { outline: 'none' }));
    const [only] = await stored(hidden);
    expect(only?.border).toStrictEqual([0, 0, 0]);
    expect(only?.colour).toStrictEqual([1, 0, 0]);
    expect((await listed(hidden))[0]).toStrictEqual({ outline: 'none', colour: [1, 0, 0] });
  });

  it('A COLOUR ALONE changes the colour and leaves the outline as it was', async () => {
    const thick = await outlined(await documentWithLinks(), change(0, { outline: 'thick' }));
    const recoloured = await outlined(thick, change(0, { colour: [0, 1, 0] }));
    expect((await stored(recoloured))[0]).toMatchObject({ border: [0, 0, 3], colour: [0, 1, 0] });
  });

  it('A COLOUR THE LINK ALREADY HAS is never replaced by the default when the outline changes', async () => {
    const red = await outlined(await documentWithLinks(), change(0, { outline: 'thin', colour: [1, 0, 0] }));
    const thick = await outlined(red, change(0, { outline: 'thick' }));
    expect((await stored(thick))[0]?.colour).toStrictEqual([1, 0, 0]);
  });

  it('a link ADDED with an outline reads back as the outline it was added with — in the viewer that reads /BS first too', async () => {
    // `createLink` writes a `/BS` of its own, and the format makes `/BS` win over `/Border` (§12.5.2): so an outline written
    // only to `/Border` is read as the engine's `/BS` by any reader that follows the rule. The listing follows it.
    const thin = await listed(await written({ kind: 'addLink', page: 0, rect: { x0: 10, y0: 20, x1: 110, y1: 70 }, target: { kind: 'uri', uri: 'https://example.org/a' }, border: 'thin' }));
    expect(thin[0]?.outline).toBe('thin');
    const none = await listed(await written({ kind: 'addLink', page: 0, rect: { x0: 10, y0: 20, x1: 110, y1: 70 }, target: { kind: 'uri', uri: 'https://example.org/a' }, border: 'none' }));
    expect(none[0]?.outline).toBe('none');
  });

  describe('a link the DOCUMENT outlined with a /BS dictionary', () => {
    /** One external link carrying `/BS << /W 5 >>` and a `/Border` that says something else, so only the rule decides. */
    async function withBorderStyle(): Promise<Uint8Array> {
      const document = await PDFDocument.create();
      const page = document.addPage([200, 200]);
      const link = document.context.obj({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('Link'),
        Rect: [10, 20, 90, 40],
        Border: [0, 0, 1],
        BS: document.context.obj({ W: 5 }),
        A: document.context.obj({ Type: PDFName.of('Action'), S: PDFName.of('URI'), URI: PDFString.of('https://example.org/bs') }),
      });
      page.node.set(PDFName.of('Annots'), document.context.obj([document.context.register(link)]));
      return document.save({ useObjectStreams: false });
    }

    it('reads as OTHER, because /BS wins over the /Border that says thin', async () => {
      expect((await listed(await withBorderStyle()))[0]?.outline).toBe('other');
    });

    it('CHANGING it removes the /BS, so the outline chosen is the one every viewer draws', async () => {
      const result = await outlined(await withBorderStyle(), change(0, { outline: 'thin' }));
      const [only] = await stored(result);
      expect(only?.bsWidth).toBeUndefined();
      expect(only?.border).toStrictEqual([0, 0, 1]);
      expect((await listed(result))[0]?.outline).toBe('thin');
    });

    it('CONTROL: a colour alone leaves the /BS where it is, so an outline nobody asked about is not touched', async () => {
      const result = await outlined(await withBorderStyle(), change(0, { colour: [0, 0, 1] }));
      expect((await stored(result))[0]?.bsWidth).toBe(5);
      expect((await listed(result))[0]?.outline).toBe('other');
    });
  });

  it('REFUSES a position past the page’s links, and a page that is not there, by name', async () => {
    const bytes = await documentWithLinks();
    await expect(outlined(bytes, change(2, { outline: 'thin' }))).rejects.toThrow(/no link at position 2/u);
    await expect(outlined(bytes, { ...change(0, { outline: 'thin' }), page: 9 })).rejects.toBeInstanceOf(RangeError);
    // CONTROL: the position that IS there is applied, so the refusals are about the position and not about the fixture.
    await expect(outlined(bytes, change(1, { outline: 'thin' }))).resolves.toBeInstanceOf(Uint8Array);
  });

  it('is its own link’s outline on a page that ALSO carries a non-link annotation: the position counts links, not /Annots', async () => {
    const document = await PDFDocument.load(await documentWithLinks());
    const first = document.getPage(0);
    const annots = first.node.lookup(PDFName.of('Annots'), PDFArray);
    const note = document.context.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Text'), Rect: [5, 5, 15, 15], Contents: PDFString.of('a note') });
    // The note goes FIRST, so an index into `/Annots` would land on it and an index among links lands on the link.
    const reordered = PDFArray.withContext(document.context);
    reordered.push(document.context.register(note));
    for (const entry of annots.asArray()) reordered.push(entry);
    first.node.set(PDFName.of('Annots'), reordered);
    const result = await outlined(await document.save({ useObjectStreams: false }), change(1, { outline: 'thick' }));
    const all = await stored(result);
    expect(all.map((entry) => entry.border)).toStrictEqual([undefined, undefined, [0, 0, 3]]);
  });
});

describe('readLinkAddress (ADR-0167)', () => {
  /** One page whose links are, in order: a tracking link past the shown bound, one past the followed bound, a short one. */
  async function addresses(tracking: string, overlong: string): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    const page = document.addPage([600, 800]);
    const context = document.context;
    const annots = context.obj(
      [tracking, overlong, 'https://example.org/short'].map((uri, index) =>
        context.register(
          context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [10 + index * 40, 10, 40 + index * 40, 30],
            A: { S: 'URI', URI: PDFString.of(uri) },
          }),
        ),
      ),
    );
    page.node.set(PDFName.of('Annots'), annots);
    return document.save({ useObjectStreams: false });
  }

  it('answers a link’s address WHOLE, by the place the listing gives it, where the listing shows it cut', async () => {
    const tracking = `https://example.org/track?id=${'a'.repeat(5000)}`;
    const session = await mupdfWriter.open(await addresses(tracking, `https://example.org/${'b'.repeat(40_000)}`));
    try {
      // THE SAME PLACE NAMES THE SAME LINK in both reads: the listing shows the first cut, and the address read
      // answers it as the document holds it.
      const { links } = await readPageLinks(session, 0);
      expect(links[0]).toMatchObject({ kind: 'external' });
      if (links[0]?.kind !== 'external') throw new Error('the first link is external');
      expect(links[0].uri.endsWith('…')).toBe(true);
      expect(await readLinkAddress(session, 0, 0)).toStrictEqual({ kind: 'address', uri: tracking });
      // CONTROL: the third, short, comes back as it is; a different place is a different link.
      expect(await readLinkAddress(session, 0, 2)).toStrictEqual({ kind: 'address', uri: 'https://example.org/short' });
      // PAST THE FOLLOWED BOUND it is not opened cut: it is refused by name.
      expect(await readLinkAddress(session, 0, 1)).toStrictEqual({ kind: 'too-long' });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('answers NO SUCH LINK for a place past the page’s links and for a link inside the document', async () => {
    const session = await mupdfWriter.open(await documentWithLinks());
    try {
      // The fixture's page 0: an internal link, then an external one.
      expect(await readLinkAddress(session, 0, 0)).toStrictEqual({ kind: 'no-such-link' });
      expect(await readLinkAddress(session, 0, 2)).toStrictEqual({ kind: 'no-such-link' });
      // CONTROL: the external one at place 1 is an address.
      expect(await readLinkAddress(session, 0, 1)).toStrictEqual({ kind: 'address', uri: 'https://example.org/thing' });
      await expect(readLinkAddress(session, 3, 0)).rejects.toBeInstanceOf(RangeError);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
