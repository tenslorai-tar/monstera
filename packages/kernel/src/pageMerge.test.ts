import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { applyDeletePages } from './pageOrder.js';
import { applyMergeDocument, captureMergeDocument, invertMergeDocument } from './pageMerge.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import type { MupdfSession } from './engineSeam.js';

/**
 * Merging another document's pages in.
 *
 * ## THE PARENT CHAIN IS THE CASE, and everything else here is a control
 *
 * Measured 2026-09-05, and it is why this file is shaped the way it is: the
 * rejected implementation — `graftObject` plus a `/Kids` push — produces a
 * document with the **right page count, the right order, the right sizes and
 * the right rotations**. pdf-lib renders it correctly. Every assertion a merge
 * would naturally ship with passes on it.
 *
 * What is wrong is the structure: the copied page's `/Parent` points at a
 * grafted copy of the source's intermediate node rather than at the target's
 * own page-tree root, so the page sits in one node's `/Kids` while naming
 * another as its parent, and a phantom subtree is reachable beside the real
 * tree. Only an assertion about `/Parent` separates the two.
 *
 * So `every merged page's parent is the node that lists it` is the load-bearing
 * case, and it is written against the **hard shape** — a source whose leaves
 * inherit `/Rotate` from an intermediate node. Against a flat source both
 * implementations agree, which is the fixture that separates nothing.
 *
 * ## Read back with pdf-lib, never with MuPDF
 *
 * `pageOrder.test.ts`' rule and its reason: a round trip verified by the engine
 * that wrote it proves the engine is self-consistent and nothing else.
 * `layers.ts` paid three weeks for that lesson in one day.
 */

/** Pages of distinct widths, so a merged order is read off the document. */
async function flatDocument(widths: readonly number[]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const width of widths) document.addPage([width, 700]);
  return document.save({ useObjectStreams: false });
}

/**
 * The HARD SHAPE: two leaves carrying no `/Rotate` of their own, inheriting 90
 * from an intermediate `/Pages` node.
 *
 * `pageOrder.test.ts`' `nestedDocument`, and deliberately the same construction
 * — that file's fixture is what found this class of defect for `duplicatePage`,
 * and a second spelling of it here would be a second opinion about what *nested*
 * means.
 */
async function nestedSource(widths: readonly number[]): Promise<Uint8Array> {
  const document = await PDFDocument.load(await flatDocument(widths));
  const root = document.catalog.Pages();
  const kids = root.Kids();

  const innerKids = PDFArray.withContext(document.context);
  const first = kids.get(0);
  const second = kids.get(1);
  innerKids.push(first);
  innerKids.push(second);

  const inner = document.context.obj({
    Type: PDFName.of('Pages'),
    Kids: innerKids,
    Count: PDFNumber.of(2),
    Rotate: PDFNumber.of(90),
    Parent: document.catalog.get(PDFName.of('Pages')),
  });
  const innerRef = document.context.register(inner);

  const outerKids = PDFArray.withContext(document.context);
  outerKids.push(innerRef);
  for (let index = 2; index < widths.length; index += 1) outerKids.push(kids.get(index));
  root.set(PDFName.of('Kids'), outerKids);

  for (const ref of [first, second]) {
    const page = document.context.lookup(ref, PDFDict);
    page.set(PDFName.of('Parent'), innerRef);
  }
  return document.save({ useObjectStreams: false });
}

/** Runs the merge and hands back the target's saved bytes. */
async function merged(
  targetBytes: Uint8Array,
  sourceBytes: Uint8Array,
  at: number,
): Promise<Uint8Array> {
  const target = await mupdfWriter.open(targetBytes);
  const source = await mupdfWriter.open(sourceBytes);
  try {
    await applyMergeDocument(target, { kind: 'mergeDocument', source: asDocId('s'), at }, source);
    return await mupdfWriter.serialise(target);
  } finally {
    await mupdfWriter.close(target);
    await mupdfWriter.close(source);
  }
}

/** A `DocId` for a payload the apply never reads — it is handed the session. */
function asDocId(value: string): never {
  return value as never;
}

async function widthsOf(bytes: Uint8Array): Promise<number[]> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => Math.round(page.getSize().width));
}

async function rotationsOf(bytes: Uint8Array): Promise<number[]> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => page.getRotation().angle);
}

/**
 * For every page, whether its `/Parent` is the node whose `/Kids` lists it.
 *
 * **This is the assertion the whole file exists for.** It walks the tree the
 * way a consumer does — from the root down through `/Kids` — and then checks
 * the back-reference, which is the edge the rejected implementation gets wrong.
 *
 * Returns one boolean per page in tree order, so a failure names which page
 * rather than only that one exists.
 */
async function parentsAgreeWithKids(bytes: Uint8Array): Promise<boolean[]> {
  const document = await PDFDocument.load(bytes);
  const answers: boolean[] = [];

  const walk = (nodeRef: unknown, node: PDFDict): void => {
    const kids = node.get(PDFName.of('Kids'));
    if (!(kids instanceof PDFArray)) return;
    for (let at = 0; at < kids.size(); at += 1) {
      const childRef = kids.get(at);
      const child = document.context.lookup(childRef, PDFDict);
      const type = child.get(PDFName.of('Type'));
      const parent = child.get(PDFName.of('Parent'));
      if (type === PDFName.of('Pages')) {
        walk(childRef, child);
        continue;
      }
      // A LEAF. Its `/Parent` must be the node we reached it through.
      answers.push(String(parent) === String(nodeRef));
    }
  };

  const rootRef = document.catalog.get(PDFName.of('Pages'));
  walk(rootRef, document.catalog.Pages());
  return answers;
}

describe('mergeDocument', () => {
  it('appends every source page at the index it was given', async () => {
    const bytes = await merged(await flatDocument([100, 110]), await flatDocument([200, 210]), 2);

    expect(await widthsOf(bytes)).toEqual([100, 110, 200, 210]);
  });

  it('inserts in the middle without reversing the source', async () => {
    // THE CASE THAT SEPARATES *inserted* FROM *inserted backwards*. Grafting
    // every page at the same index would put each new page ahead of the ones
    // already placed, which renders as a complete merge with the block
    // reversed — and a source of identical pages could not see it.
    const bytes = await merged(
      await flatDocument([100, 110]),
      await flatDocument([200, 210, 220]),
      1,
    );

    expect(await widthsOf(bytes)).toEqual([100, 200, 210, 220, 110]);
  });

  it('clamps an index past the end rather than refusing it', async () => {
    const bytes = await merged(await flatDocument([100]), await flatDocument([200]), 99);

    expect(await widthsOf(bytes)).toEqual([100, 200]);
  });

  it('carries an inherited /Rotate onto the merged page', async () => {
    const bytes = await merged(await flatDocument([100]), await nestedSource([200, 210, 220]), 1);

    // The source's first two pages inherit 90; the third declares nothing.
    expect(await rotationsOf(bytes)).toEqual([0, 90, 90, 0]);
  });

  it('THE CASE: every merged page names the node that lists it as its parent', async () => {
    const bytes = await merged(await flatDocument([100]), await nestedSource([200, 210, 220]), 1);

    // VERIFIED BY MUTATION, 2026-09-05, rather than asserted. `graftPage` was
    // replaced with `graftObject` + a `/Kids` push and this file re-run:
    // **eleven of thirteen cases still passed**, including
    // `carries an inherited /Rotate onto the merged page` — the one that looks
    // like it would catch a broken graft. The two that went red were this case
    // and the ordering case, and the ordering one only because that mutation
    // also appends.
    //
    // So the claim in the module header is measured: page count, order, sizes
    // and rotations do not separate the two implementations, and this
    // assertion is the only thing standing between the right document and one
    // that renders identically with a broken parent chain.
    expect(await parentsAgreeWithKids(bytes)).toEqual([true, true, true, true]);
  });

  it('CONTROL: the parent check can report false, so a true means something', async () => {
    // WITHOUT THIS, the assertion above is a function that might only ever
    // return `true` — the reassuring answer, which is exactly what a structural
    // check produces when it cannot see. This builds the defect by hand: a leaf
    // whose `/Parent` names a node that does not list it.
    const document = await PDFDocument.load(await flatDocument([100, 110]));
    const stranger = document.context.register(
      document.context.obj({ Type: PDFName.of('Pages'), Count: PDFNumber.of(0) }),
    );
    const kids = document.catalog.Pages().Kids();
    document.context.lookup(kids.get(1), PDFDict).set(PDFName.of('Parent'), stranger);

    expect(await parentsAgreeWithKids(await document.save({ useObjectStreams: false }))).toEqual([
      true,
      false,
    ]);
  });

  it('leaves the source document unchanged', async () => {
    // ADR-0040: a merge reads the source, so the log holds one entry against
    // the target and nothing against the source. That is only true if this is.
    const sourceBytes = await flatDocument([200, 210]);
    const target = await mupdfWriter.open(await flatDocument([100]));
    const source = await mupdfWriter.open(sourceBytes);
    try {
      await applyMergeDocument(
        target,
        { kind: 'mergeDocument', source: asDocId('s'), at: 1 },
        source,
      );
      const after = await mupdfWriter.serialise(source);
      expect(await widthsOf(after)).toEqual([200, 210]);
    } finally {
      await mupdfWriter.close(target);
      await mupdfWriter.close(source);
    }
  });

  it('this build cannot produce a zero-page source, which is why none is merged here', async () => {
    // NOT A MERGE CASE. It records why the merge loop's `pages === 0` branch has
    // no fixture, because two attempts at one failed for different reasons and
    // the next reader would make the same two.
    //
    // 1. `PDFDocument.create()` reports 0 pages and WRITES ONE ON SAVE —
    //    measured: `getPageCount()` 0 before, 1 after a round trip, 595 wide,
    //    and MuPDF agrees. So `flatDocument([])` is a one-page A4 document. A
    //    case using it would have asserted a no-op while merging a page; it
    //    failed loudly only because the widths happened to differ.
    // 2. Emptying one through this build's own delete is refused on purpose.
    //
    // So the branch is unreachable through every path this build has, and the
    // loop bound is what handles it. Asserting the refusal is the honest
    // coverage available: it is the thing that makes the branch unreachable, so
    // if it ever stops refusing, this goes red and the merge case becomes
    // writable.
    const session = await mupdfWriter.open(await flatDocument([200]));
    try {
      await expect(
        applyDeletePages(session, { kind: 'deletePages', pages: [0] }),
      ).rejects.toThrow(/would leave a document with none/u);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('preserves a catalog entry the target carried', async () => {
    // `rearrangePages` was measured to DROP /AcroForm even for the identity
    // permutation (ADR-0006), which is why invariant L6 exists. `graftPage` is
    // a different call and was measured not to — asserted here rather than
    // assumed, because the two live in the same library.
    const document = await PDFDocument.load(await flatDocument([100]));
    document.catalog.set(PDFName.of('Marker'), PDFNumber.of(4242));
    const bytes = await merged(
      await document.save({ useObjectStreams: false }),
      await flatDocument([200]),
      1,
    );

    const reread = await PDFDocument.load(bytes);
    expect(reread.catalog.get(PDFName.of('Marker'))?.toString()).toBe('4242');
  });

  it('capture always refuses, and says why', async () => {
    const result = await captureMergeDocument();

    expect(result.captured).toBe(false);
    if (!result.captured) expect(result.reason).toContain('checkpoint is of the target');
  });

  it('invert is unreachable and throws rather than pretending', async () => {
    const session = await mupdfWriter.open(await flatDocument([100]));
    try {
      expect(() => invertMergeDocument(session, undefined as never)).toThrow(
        /no inverse and this is unreachable/u,
      );
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('refuses a session this adapter did not open', async () => {
    // The provenance check is `withDocuments`' and it must apply to the SOURCE
    // as much as the target — a forged source is the new surface this command
    // adds, and it reaches a native call if nothing refuses it.
    const target = await mupdfWriter.open(await flatDocument([100]));
    const forged = { engine: 'mupdf' } as unknown as MupdfSession;
    try {
      await expect(
        applyMergeDocument(target, { kind: 'mergeDocument', source: asDocId('s'), at: 0 }, forged),
      ).rejects.toThrow(/not produced by this adapter/u);
    } finally {
      await mupdfWriter.close(target);
    }
  });

  it('CONTROL: the same call succeeds with a real source session', async () => {
    // Without this, the case above passes against an apply that refuses
    // everything — refusal and impossibility produce the same observation.
    const target = await mupdfWriter.open(await flatDocument([100]));
    const source = await mupdfWriter.open(await flatDocument([200]));
    try {
      await expect(
        applyMergeDocument(target, { kind: 'mergeDocument', source: asDocId('s'), at: 0 }, source),
      ).resolves.toBeUndefined();
      await withDocument(target, (document) => {
        expect(document.countPages()).toBe(2);
      });
    } finally {
      await mupdfWriter.close(target);
      await mupdfWriter.close(source);
    }
  });
});
