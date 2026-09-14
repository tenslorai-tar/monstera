import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { asDocVersion } from '@monstera/shared';

import { applyImportPageAsLayer } from './layers.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * Importing another document's first page onto a page, as a layer (ADR-0064).
 *
 * ## Read back with pdf-lib, never with MuPDF
 *
 * `pageMerge.test.ts`' rule and its reason: a round trip checked by the engine that wrote
 * it proves only that the engine agrees with itself. MuPDF writes; pdf-lib reads.
 *
 * ## The hard shape is a source that INHERITS its box
 *
 * A source leaf with no `/MediaBox` of its own, inheriting 400 × 200 from its `/Pages`
 * node, so a layer built without pushing the inheritables down has no `/BBox` worth the
 * name — and the box differs from the target's 300 × 300 on both axes, so a box copied
 * from the target, or defaulted, cannot pass by coincidence.
 */

/** A `DocId` for a payload the apply never reads — it is handed the session. */
function asDocId(value: string): never {
  return value as never;
}

/** A target of `count` pages, each 300 × 300. */
async function target(count: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let page = 0; page < count; page += 1) document.addPage([300, 300]);
  return document.save({ useObjectStreams: false });
}

/** A one-page source whose leaf inherits its 400 × 200 `/MediaBox` from `/Pages`. */
async function inheritingSource(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 200]);
  page.drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
  const leaf = page.node;
  const box = leaf.get(PDFName.of('MediaBox'));
  if (!(box instanceof PDFArray)) throw new Error('pdf-lib wrote no /MediaBox on the leaf');
  document.catalog.Pages().set(PDFName.of('MediaBox'), box);
  leaf.delete(PDFName.of('MediaBox'));
  return document.save({ useObjectStreams: false });
}

/** A two-page target that already has one layer, named "Existing". */
async function targetWithALayer(): Promise<Uint8Array> {
  const document = await PDFDocument.load(await target(2));
  const group = document.context.register(
    document.context.obj({ Type: PDFName.of('OCG'), Name: PDFString.of('Existing') }),
  );
  document.catalog.set(
    PDFName.of('OCProperties'),
    document.context.obj({ OCGs: [group], D: { Order: [group] } }),
  );
  return document.save({ useObjectStreams: false });
}

/** Runs the import and hands back the target's saved bytes. */
async function imported(
  targetBytes: Uint8Array,
  sourceBytes: Uint8Array,
  at: number,
  name = 'Letterhead',
): Promise<Uint8Array> {
  const targetSession = await mupdfWriter.open(targetBytes);
  const sourceSession = await mupdfWriter.open(sourceBytes);
  try {
    await applyImportPageAsLayer(
      targetSession,
      { kind: 'importPageAsLayer', source: asDocId('s'), name, at, version: asDocVersion(1) },
      sourceSession,
    );
    return await mupdfWriter.serialise(targetSession);
  } finally {
    await mupdfWriter.close(targetSession);
    await mupdfWriter.close(sourceSession);
  }
}

/** A PDF text string's value, whichever of the two string forms the writer chose. */
function text(value: unknown): string | undefined {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return undefined;
}

/** The document's groups, in `/OCGs` order, as `{ ref, name }`. */
function groupsOf(document: PDFDocument): { ref: string; name: string | undefined }[] {
  const properties = document.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
  const groups = properties?.lookupMaybe(PDFName.of('OCGs'), PDFArray);
  if (groups === undefined) return [];
  return groups.asArray().map((entry) => ({
    ref: String(entry),
    name: text(document.context.lookup(entry, PDFDict).get(PDFName.of('Name'))),
  }));
}

/** `/D/Order`'s entries, as reference strings. */
function orderOf(document: PDFDocument): string[] {
  const properties = document.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
  const config = properties?.lookupMaybe(PDFName.of('D'), PDFDict);
  const order = config?.lookupMaybe(PDFName.of('Order'), PDFArray);
  return order === undefined ? [] : order.asArray().map(String);
}

/** One page's `/XObject` resources, as name → the Form's dictionary. */
function formsOn(document: PDFDocument, page: number): Map<string, PDFDict> {
  const node = document.getPage(page).node;
  const resources = node.lookupMaybe(PDFName.of('Resources'), PDFDict);
  const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  const forms = new Map<string, PDFDict>();
  if (xobjects === undefined) return forms;
  for (const [key, value] of xobjects.entries()) {
    const stream = document.context.lookup(value);
    if (stream instanceof PDFRawStream) forms.set(key.decodeText(), stream.dict);
  }
  return forms;
}

/** Every content stream of one page, decoded and joined. */
function contentOf(document: PDFDocument, page: number): string {
  const contents = document.getPage(page).node.get(PDFName.of('Contents'));
  const refs = contents instanceof PDFArray ? contents.asArray() : contents === undefined ? [] : [contents];
  return refs
    .map((ref) => {
      const stream = document.context.lookup(ref);
      return stream instanceof PDFRawStream
        ? new TextDecoder().decode(decodePDFRawStream(stream).decode())
        : '';
    })
    .join('\n');
}

describe('importPageAsLayer', () => {
  it('adds ONE group, named as the payload says, to /OCGs and to /D/Order', async () => {
    const document = await PDFDocument.load(await imported(await target(3), await inheritingSource(), 1));

    const groups = groupsOf(document);
    expect(groups.map((group) => group.name)).toStrictEqual(['Letterhead']);
    expect(orderOf(document)).toStrictEqual([groups[0]?.ref]);
  });

  it('draws a Form XObject governed by THAT group, on the page it was given and no other', async () => {
    // PAGE 1 OF 3, NOT PAGE 0 — the rotate's lesson. A layer placed on the first page
    // regardless of `at` would pass a fixture where the two coincide.
    const document = await PDFDocument.load(await imported(await target(3), await inheritingSource(), 1));
    const [group] = groupsOf(document);

    const forms = formsOn(document, 1);
    expect([...forms.keys()]).toStrictEqual(['MonsteraLayer0']);
    const layer = forms.get('MonsteraLayer0');
    expect(layer?.get(PDFName.of('Subtype'))).toBe(PDFName.of('Form'));
    expect(String(layer?.get(PDFName.of('OC')))).toBe(group?.ref);
    expect(contentOf(document, 1)).toMatch(/\/MonsteraLayer0 Do/u);

    expect(formsOn(document, 0).size).toBe(0);
    expect(formsOn(document, 2).size).toBe(0);
  });

  it('THE HARD SHAPE: the layer carries the box the source page INHERITED', async () => {
    const document = await PDFDocument.load(await imported(await target(1), await inheritingSource(), 0));
    const bbox = formsOn(document, 0).get('MonsteraLayer0')?.lookup(PDFName.of('BBox'), PDFArray);

    expect(bbox?.asArray().map((entry) => (entry as PDFNumber).asNumber())).toStrictEqual([0, 0, 400, 200]);
  });

  it("keeps the page's OWN content, and draws the layer after it", async () => {
    const withOwn = await PDFDocument.load(await target(1));
    withOwn.getPage(0).drawRectangle({ x: 1, y: 1, width: 2, height: 2 });
    const bytes = await withOwn.save({ useObjectStreams: false });

    const after = await PDFDocument.load(await imported(bytes, await inheritingSource(), 0));
    const content = contentOf(after, 0);
    // `2 2 l`, NOT ` re`. pdf-lib's `drawRectangle` writes a PATH — read on 2026-09-14 as
    // `0 0 m`, `2 0 l`, `2 2 l`, `0 2 l`, `h`, `f` — and the first version of this case
    // looked for the `re` operator it never emits. `2 2 l` is this 2 × 2 rectangle's own
    // corner; the source page's 50 × 50 one lives in the Form XObject, not in `/Contents`.
    const own = content.indexOf('2 2 l');
    const layer = content.indexOf('/MonsteraLayer0 Do');
    expect(own).toBeGreaterThanOrEqual(0);
    expect(layer).toBeGreaterThan(own);
  });

  it('APPENDS to a document that already has a layer, and leaves that layer where it was', async () => {
    const document = await PDFDocument.load(await imported(await targetWithALayer(), await inheritingSource(), 0));

    expect(groupsOf(document).map((group) => group.name)).toStrictEqual(['Existing', 'Letterhead']);
    expect(orderOf(document)).toHaveLength(2);
  });

  it('a second import onto the same page takes the NEXT name, deterministically', async () => {
    const once = await imported(await target(1), await inheritingSource(), 0, 'First');
    const twice = await PDFDocument.load(await imported(once, await inheritingSource(), 0, 'Second'));

    expect([...formsOn(twice, 0).keys()].sort()).toStrictEqual(['MonsteraLayer0', 'MonsteraLayer1']);
    expect(groupsOf(twice).map((group) => group.name)).toStrictEqual(['First', 'Second']);
  });

  it('REFUSES a target page that does not exist, and writes nothing', async () => {
    const targetSession = await mupdfWriter.open(await target(2));
    const sourceSession = await mupdfWriter.open(await inheritingSource());
    try {
      await expect(
        applyImportPageAsLayer(
          targetSession,
          { kind: 'importPageAsLayer', source: asDocId('s'), name: 'X', at: 2, version: asDocVersion(1) },
          sourceSession,
        ),
      ).rejects.toThrow(RangeError);
      // Built from something the absent refusal would NOT satisfy: a write before the
      // check would leave a group behind, and this reads the document back to see.
      const document = await PDFDocument.load(await mupdfWriter.serialise(targetSession));
      expect(groupsOf(document)).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(targetSession);
      await mupdfWriter.close(sourceSession);
    }
  });
});
