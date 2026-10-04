import {
  PDFArray,
  type PDFContext,
  PDFDict,
  PDFDocument,
  PDFName,
  type PDFObject as LibObject,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { applyDeleteFormFields } from './formFields.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { readDestinations } from './destinations.js';
import { extractPages } from './pageExtract.js';
import { readPageLinks } from './pageLinks.js';
import { applyMergeDocument, applyReplacePage } from './pageMerge.js';
import { applyDeletePages } from './pageOrder.js';
import { removeFieldsOnPages } from './formFields.js';

/**
 * A page that leaves takes every reference to it
 * ([ADR-0155](../../../docs/DECISIONS/0155-a-page-that-leaves-takes-every-reference-to-it.md); the owner's 12a
 * follow-up and L1).
 *
 * ## Two observables per case, and the second is what makes it a case
 *
 * Each fixture is three pages, page 2 alone draws {@link MARK}, and one kind of reference names page 2. Page 2 is
 * deleted and the document saved; `@cantoo/pdf-lib` reads the saved bytes back by walking EVERY indirect object.
 *
 * 1. The page and its text are gone from the file (the owner's L2).
 * 2. The structure that named it says what the kind's own rule says: the bookmark is gone or a heading, the link is
 *    off its page, the entry is out of its tree (L1).
 *
 * The first alone separates nothing between kinds: the last step of the rule replaces any reference still naming the
 * page with null, so with a kind's own step taken out its page still goes, and its bookmark stays drawn going nowhere.
 * The second is what a missing step changes, so each case holds both.
 *
 * ## The answers read SAVED bytes, so each case is also save and reopen.
 */

const MARK = 'only-page-two-says-this';
const ANSWER = 'answer-in-the-field-on-page-two';

/** What a fixture's builder is handed: the context, the three pages and the catalog. */
interface Builder {
  readonly ctx: PDFContext;
  readonly catalog: PDFDict;
  readonly page: (at: number) => PDFRef;
  readonly node: (at: number) => PDFDict;
  readonly fit: (at: number) => PDFArray;
  readonly goTo: (at: number) => PDFDict;
  readonly link: (on: number, extra: Record<string, LibObject>) => PDFRef;
  readonly annotate: (on: number, entry: PDFRef) => void;
  readonly nameTree: (entries: readonly (readonly [string, LibObject])[]) => PDFRef;
  readonly outline: (items: readonly OutlineSpec[]) => void;
}

interface OutlineSpec {
  readonly title: string;
  readonly entries?: Record<string, LibObject>;
  readonly count?: number;
  readonly kids?: readonly OutlineSpec[];
}

async function fixture(build: (b: Builder) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  const pages = [0, 1, 2].map((at) => {
    const page = doc.addPage([400, 600]);
    const text = at === 1 ? MARK : `page ${String(at + 1)}`;
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(`BT /F1 12 Tf 50 550 Td (${text}) Tj ET`)));
    page.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font } }));
    return page;
  });
  const pageAt = (at: number): (typeof pages)[number] => {
    const page = pages[at];
    if (page === undefined) throw new Error(`the fixture has no page ${String(at)}`);
    return page;
  };
  const annotate = (on: number, entry: PDFRef): void => {
    const node = pageAt(on).node;
    const annots = node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots === undefined) node.set(PDFName.of('Annots'), ctx.obj([entry]));
    else annots.push(entry);
  };
  const fit = (at: number): PDFArray => ctx.obj([pageAt(at).ref, PDFName.of('Fit')]);
  const builder: Builder = {
    ctx,
    catalog: doc.catalog,
    page: (at) => pageAt(at).ref,
    node: (at) => pageAt(at).node,
    fit,
    goTo: (at) => ctx.obj({ S: 'GoTo', D: fit(at) }),
    link: (on, extra) => {
      const ref = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 50, 150, 70], ...extra }));
      annotate(on, ref);
      return ref;
    },
    annotate,
    nameTree: (entries) => {
      const flat: LibObject[] = [];
      for (const [key, value] of entries) flat.push(PDFString.of(key), value);
      return ctx.register(ctx.obj({ Names: flat }));
    },
    outline: (items) => {
      const root = ctx.nextRef();
      const place = (parent: PDFRef, specs: readonly OutlineSpec[]): readonly PDFRef[] => {
        const refs = specs.map(() => ctx.nextRef());
        specs.forEach((spec, index) => {
          const ref = refs[index];
          if (ref === undefined) return;
          const before = refs[index - 1];
          const after = refs[index + 1];
          const kids = spec.kids === undefined ? [] : place(ref, spec.kids);
          const first = kids[0];
          const last = kids[kids.length - 1];
          ctx.assign(
            ref,
            ctx.obj({
              Title: PDFString.of(spec.title),
              Parent: parent,
              ...(before === undefined ? {} : { Prev: before }),
              ...(after === undefined ? {} : { Next: after }),
              ...(first === undefined || last === undefined ? {} : { First: first, Last: last }),
              ...(spec.count === undefined ? {} : { Count: spec.count }),
              ...spec.entries,
            }),
          );
        });
        return refs;
      };
      const top = place(root, items);
      ctx.assign(root, ctx.obj({ Type: 'Outlines', First: top[0] ?? null, Last: top[top.length - 1] ?? null, Count: top.length }));
      doc.catalog.set(PDFName.of('Outlines'), root);
    },
  };
  build(builder);
  return await doc.save({ useObjectStreams: false });
}

/** The saved file after `work`, read back. */
async function after(bytes: Uint8Array, work: (session: Awaited<ReturnType<typeof mupdfWriter.open>>) => Promise<void>): Promise<PDFDocument> {
  const session = await mupdfWriter.open(bytes);
  try {
    await work(session);
    return await PDFDocument.load(await mupdfWriter.serialise(session), { updateMetadata: false });
  } finally {
    await mupdfWriter.close(session);
  }
}

const deletePageTwo = (session: Awaited<ReturnType<typeof mupdfWriter.open>>): Promise<void> =>
  applyDeletePages(session, { kind: 'deletePages', pages: [1] });

/** Every page dictionary in the file, and whether any stream says {@link MARK} or any value is {@link ANSWER}. */
function held(doc: PDFDocument): { readonly pages: number; readonly mark: boolean; readonly answer: boolean } {
  let pages = 0;
  let mark = false;
  let answer = false;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict) {
      if (object.get(PDFName.of('Type')) === PDFName.of('Page')) pages += 1;
      const value = object.get(PDFName.of('V'));
      if (value instanceof PDFString && value.decodeText() === ANSWER) answer = true;
    }
    if (object instanceof PDFRawStream && new TextDecoder('latin1').decode(decodePDFRawStream(object).decode()).includes(MARK)) {
      mark = true;
    }
  }
  return { pages, mark, answer };
}

const GONE = { pages: 2, mark: false, answer: false } as const;

function catalogEntry(doc: PDFDocument, key: string): LibObject | undefined {
  const value = doc.catalog.get(PDFName.of(key));
  return value instanceof PDFRef ? doc.context.lookup(value) : value;
}

function look(doc: PDFDocument, value: LibObject | undefined): LibObject | undefined {
  return value instanceof PDFRef ? doc.context.lookup(value) : value;
}

function dictAt(doc: PDFDocument, value: LibObject | undefined): PDFDict {
  const found = look(doc, value);
  if (!(found instanceof PDFDict)) throw new Error(`expected a dictionary, found ${String(found)}`);
  return found;
}

/** The outline as titles, nested, each with whether it still names a destination. */
function outlineOf(doc: PDFDocument): readonly string[] {
  const root = catalogEntry(doc, 'Outlines');
  if (!(root instanceof PDFDict)) return [];
  const lines: string[] = [];
  const walk = (parent: PDFDict, depth: number): void => {
    for (let item = look(doc, parent.get(PDFName.of('First'))); item instanceof PDFDict; item = look(doc, item.get(PDFName.of('Next')))) {
      const title = item.lookup(PDFName.of('Title'), PDFString).decodeText();
      const goes = item.has(PDFName.of('Dest')) || item.has(PDFName.of('A'));
      const count = item.get(PDFName.of('Count'));
      lines.push(`${'  '.repeat(depth)}${title}${goes ? '' : ' (heading)'}${count instanceof PDFNumber ? ` count ${String(count.asNumber())}` : ''}`);
      walk(item, depth + 1);
    }
  };
  walk(root, 0);
  const count = root.get(PDFName.of('Count'));
  if (count instanceof PDFNumber) lines.push(`total ${String(count.asNumber())}`);
  return lines;
}

/** The subtypes of a page's annotations, in order. */
function annotationsOn(doc: PDFDocument, page: number): readonly string[] {
  const annots = doc.getPage(page).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (annots === undefined) return [];
  return annots.asArray().map((entry) => String(dictAt(doc, entry).get(PDFName.of('Subtype'))));
}

/** A name tree's keys, from its leaves. */
function treeKeys(doc: PDFDocument, root: LibObject | undefined): readonly string[] {
  const keys: string[] = [];
  const walk = (node: LibObject | undefined): void => {
    const found = look(doc, node);
    if (!(found instanceof PDFDict)) return;
    const names = found.lookupMaybe(PDFName.of('Names'), PDFArray);
    if (names !== undefined) for (let at = 0; at < names.size(); at += 2) keys.push(names.lookup(at, PDFString).decodeText());
    const kids = found.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (kids !== undefined) for (const kid of kids.asArray()) walk(kid);
  };
  walk(root);
  return keys;
}

describe('a page that leaves takes every reference to it (ADR-0155)', () => {
  it('CONTROL: a page nothing names leaves the file, and the fixture holds the mark it looks for', async () => {
    const bytes = await fixture(() => undefined);
    expect(held(await PDFDocument.load(bytes))).toStrictEqual({ pages: 3, mark: true, answer: false });
    expect(held(await after(bytes, deletePageTwo))).toStrictEqual(GONE);
  });

  describe("the owner's two fixtures: page 2 named by a bookmark, a link, a named destination and the open action", () => {
    const named = (): Promise<Uint8Array> =>
      fixture((b) => {
        b.outline([{ title: 'Chapter two', entries: { Dest: b.fit(1) } }, { title: 'Chapter three', entries: { Dest: b.fit(2) } }]);
        b.link(0, { Dest: b.fit(1) });
        b.catalog.set(PDFName.of('Names'), b.ctx.obj({ Dests: b.nameTree([['chapter-two', b.fit(1)]]) }));
        b.catalog.set(PDFName.of('OpenAction'), b.fit(1));
        // AND ITS FORM ANSWER: a filled field whose widget is on page 2.
        const field = b.ctx.nextRef();
        const widget = b.ctx.register(
          b.ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [50, 400, 250, 420], P: b.page(1), Parent: field }),
        );
        b.annotate(1, widget);
        b.ctx.assign(field, b.ctx.obj({ FT: 'Tx', T: PDFString.of('applicant'), V: PDFString.of(ANSWER), Kids: [widget] }));
        b.catalog.set(PDFName.of('AcroForm'), b.ctx.obj({ Fields: [field] }));
      });

    it('the deleted page, its content and its answer are gone from the file, and nothing that named it is left', async () => {
      const doc = await after(await named(), deletePageTwo);
      expect(held(doc)).toStrictEqual(GONE);
      expect(outlineOf(doc)).toStrictEqual(['Chapter three', 'total 1']);
      expect(annotationsOn(doc, 0)).toStrictEqual([]);
      expect(treeKeys(doc, dictAt(doc, catalogEntry(doc, 'Names')).get(PDFName.of('Dests')))).toStrictEqual([]);
      expect(catalogEntry(doc, 'OpenAction')).toBeUndefined();
    });

    it('CONTROL: taken out of the tree with its fields and nothing else cleared, the page and its text stay', async () => {
      // EVERYTHING BUT THE RELEASE: ADR-0151's field removal, then MuPDF's own removal from the tree, which is the
      // reference-blind half the delete rewrote before ADR-0155.
      const doc = await after(await named(), (session) =>
        withDocument(session, (document) => {
          removeFieldsOnPages(document, [1]);
          document.deletePage(1);
        }),
      );
      expect(held(doc)).toStrictEqual({ pages: 3, mark: true, answer: false });
    });
  });

  describe('outline entries', () => {
    it('an entry whose destination left goes, by its /Dest, its GoTo or a name', async () => {
      const doc = await after(
        await fixture((b) => {
          b.catalog.set(PDFName.of('Names'), b.ctx.obj({ Dests: b.nameTree([['two', b.fit(1)]]) }));
          b.outline([
            { title: 'by dest', entries: { Dest: b.fit(1) } },
            { title: 'by action', entries: { A: b.goTo(1) } },
            { title: 'by name', entries: { Dest: PDFString.of('two') } },
            { title: 'stays', entries: { Dest: b.fit(0) } },
          ]);
        }),
        deletePageTwo,
      );
      expect(held(doc)).toStrictEqual(GONE);
      expect(outlineOf(doc)).toStrictEqual(['stays', 'total 1']);
    });

    it('an entry with children stays as a HEADING, its children kept and every count recomputed with its sign', async () => {
      const doc = await after(
        await fixture((b) => {
          b.outline([
            {
              title: 'Part one',
              entries: { Dest: b.fit(1) },
              count: 3,
              kids: [
                { title: 'gone', entries: { Dest: b.fit(1) } },
                { title: 'kept', entries: { Dest: b.fit(2) } },
                { title: 'closed', entries: { Dest: b.fit(0) }, count: -2, kids: [{ title: 'a', entries: { Dest: b.fit(1) } }, { title: 'b', entries: { Dest: b.fit(2) } }] },
              ],
            },
          ]);
        }),
        deletePageTwo,
      );
      expect(held(doc)).toStrictEqual(GONE);
      // Part one is open: its visible descendants are `kept` and `closed` (whose own child is hidden), two. `closed`
      // stays closed with one child that would show. The outline's own count is every visible item: three.
      expect(outlineOf(doc)).toStrictEqual([
        'Part one (heading) count 2',
        '  kept',
        '  closed count -1',
        '    b',
        'total 3',
      ]);
    });

    it('an entry whose chain holds another action keeps that action and loses only the GoTo', async () => {
      const doc = await after(
        await fixture((b) => {
          b.outline([{ title: 'site', entries: { A: b.ctx.obj({ S: 'URI', URI: PDFString.of('https://example.org/'), Next: b.goTo(1) }) } }]);
        }),
        deletePageTwo,
      );
      expect(held(doc)).toStrictEqual(GONE);
      const item = dictAt(doc, dictAt(doc, catalogEntry(doc, 'Outlines')).get(PDFName.of('First')));
      const action = dictAt(doc, item.get(PDFName.of('A')));
      expect(String(action.get(PDFName.of('S')))).toBe('/URI');
      expect(action.has(PDFName.of('Next'))).toBe(false);
    });

    it('an outline of 3,000 entries in one chain is walked to its end, with no stack to run out of', async () => {
      // MEASURED 2026-10-04: the walk of every object recursed one frame per reference, and a chain of 2,000 entries
      // threw `Maximum call stack size exceeded`, which refused the delete. The entry that named the page is the last.
      const doc = await after(
        await fixture((b) => {
          b.outline(
            Array.from({ length: 3000 }, (_unused, at) => ({ title: `entry ${String(at)}`, entries: { Dest: b.fit(at === 2999 ? 1 : 0) } })),
          );
        }),
        deletePageTwo,
      );
      expect(held(doc)).toStrictEqual(GONE);
      const outline = outlineOf(doc);
      expect([outline.length, outline[outline.length - 2], outline[outline.length - 1]]).toStrictEqual([3000, 'entry 2998', 'total 2999']);
    });

    it('the outline as the panel reads it holds no entry going nowhere', async () => {
      const session = await mupdfWriter.open(
        await fixture((b) => {
          b.outline([
            { title: 'Part', entries: { Dest: b.fit(1) }, count: 2, kids: [{ title: 'gone', entries: { Dest: b.fit(1) } }, { title: 'kept', entries: { Dest: b.fit(2) } }] },
            { title: 'leaf', entries: { Dest: b.fit(1) } },
          ]);
        }),
      );
      try {
        await deletePageTwo(session);
        const read = await readDestinations(session);
        expect(read.destinations.map(({ title, page, depth }) => ({ title, page, depth }))).toStrictEqual([
          { title: 'Part', page: null, depth: 0 },
          { title: 'kept', page: 1, depth: 1 },
        ]);
      } finally {
        await mupdfWriter.close(session);
      }
    });
  });

  describe('links and actions', () => {
    it('a link whose /Dest, GoTo or named destination left is taken off its page; one to a page that stays is not', async () => {
      const doc = await after(
        await fixture((b) => {
          b.catalog.set(PDFName.of('Dests'), b.ctx.obj({ two: b.fit(1) }));
          b.link(0, { Dest: b.fit(1) });
          b.link(0, { A: b.goTo(1) });
          b.link(0, { Dest: PDFName.of('two') });
          b.link(0, { Dest: b.fit(2), Contents: PDFString.of('stays') });
        }),
        deletePageTwo,
      );
      expect(held(doc)).toStrictEqual(GONE);
      expect(annotationsOn(doc, 0)).toStrictEqual(['/Link']);
      const kept = dictAt(doc, doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).get(0));
      expect(kept.lookup(PDFName.of('Contents'), PDFString).decodeText()).toBe('stays');
    });

    it('the Links panel’s reader, asked before the delete and after it on the same session, no longer lists the link', async () => {
      // THE HARD SHAPE for a cache: the page is loaded and its links read while the link is there, and then the delete
      // edits `/Annots` under it. MuPDF keeps a loaded page's links from when it was loaded, and resyncs every open page
      // in a full save (`pdf-write.c`, `pdf_sync_open_pages`, MuPDF 1.28.0). The bus saves after every command whose
      // display is `'image'`, as a delete's is (`commandBus.ts`, `replaceCanonicalImageFrom`), before any read reaches
      // the session; so the case saves where the bus does. Measured 2026-10-04: read straight after the apply, with no
      // save, the page still listed both links.
      const session = await mupdfWriter.open(
        await fixture((b) => {
          b.link(0, { Dest: b.fit(1) });
          b.link(0, { Dest: b.fit(2) });
        }),
      );
      try {
        const before = await readPageLinks(session, 0);
        expect(before.links.map((link) => (link.kind === 'internal' ? link.page : -1))).toStrictEqual([1, 2]);
        await deletePageTwo(session);
        await mupdfWriter.serialise(session);
        const afterwards = await readPageLinks(session, 0);
        expect(afterwards.links.map((link) => (link.kind === 'internal' ? link.page : -1))).toStrictEqual([1]);
      } finally {
        await mupdfWriter.close(session);
      }
    });

    it('a link that does something else first keeps it, and loses only the GoTo after it', async () => {
      const doc = await after(
        await fixture((b) => {
          b.link(0, { A: b.ctx.obj({ S: 'URI', URI: PDFString.of('https://example.org/'), Next: b.goTo(1) }) });
        }),
        deletePageTwo,
      );
      expect(held(doc)).toStrictEqual(GONE);
      expect(annotationsOn(doc, 0)).toStrictEqual(['/Link']);
      const action = dictAt(doc, dictAt(doc, doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).get(0)).get(PDFName.of('A')));
      expect(action.has(PDFName.of('Next'))).toBe(false);
    });

    it('a GoTo in a page’s, an annotation’s or the document’s additional actions goes, and so does an emptied /AA', async () => {
      const doc = await after(
        await fixture((b) => {
          b.node(0).set(PDFName.of('AA'), b.ctx.obj({ O: b.goTo(1), C: b.goTo(2) }));
          b.link(0, { AA: b.ctx.obj({ E: b.goTo(1) }), Dest: b.fit(2) });
          b.catalog.set(PDFName.of('AA'), b.ctx.obj({ WC: b.goTo(1) }));
        }),
        deletePageTwo,
      );
      expect(held(doc)).toStrictEqual(GONE);
      const pageActions = doc.getPage(0).node.lookup(PDFName.of('AA'), PDFDict);
      expect(pageActions.keys().map(String)).toStrictEqual(['/C']);
      const link = dictAt(doc, doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).get(0));
      expect(link.has(PDFName.of('AA'))).toBe(false);
      expect(catalogEntry(doc, 'AA')).toBeUndefined();
    });

    it('a Hide of an annotation that left is taken out, and the link it was all of goes', async () => {
      const doc = await after(
        await fixture((b) => {
          const note = b.ctx.register(b.ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [50, 50, 70, 70], P: b.page(1), Contents: PDFString.of(MARK) }));
          b.annotate(1, note);
          b.link(0, { A: b.ctx.obj({ S: 'Hide', T: note }) });
        }),
        deletePageTwo,
      );
      expect(held(doc)).toStrictEqual(GONE);
      expect(annotationsOn(doc, 0)).toStrictEqual([]);
    });
  });

  describe("the catalog's own", () => {
    it('/OpenAction naming the page goes, as a destination and as a GoTo', async () => {
      for (const opening of ['dest', 'action'] as const) {
        const doc = await after(
          await fixture((b) => {
            b.catalog.set(PDFName.of('OpenAction'), opening === 'dest' ? b.fit(1) : b.goTo(1));
          }),
          deletePageTwo,
        );
        expect(held(doc), opening).toStrictEqual(GONE);
        expect(catalogEntry(doc, 'OpenAction'), opening).toBeUndefined();
      }
    });

    it('CONTROL: /OpenAction naming a page that stays is left as it was', async () => {
      const doc = await after(
        await fixture((b) => {
          b.catalog.set(PDFName.of('OpenAction'), b.fit(2));
        }),
        deletePageTwo,
      );
      expect(catalogEntry(doc, 'OpenAction')).toBeInstanceOf(PDFArray);
    });

    it('named destinations naming the page leave /Dests and the /Names tree, whose /Limits stay right', async () => {
      const doc = await after(
        await fixture((b) => {
          b.catalog.set(PDFName.of('Dests'), b.ctx.obj({ two: b.fit(1), three: b.fit(2) }));
          const leaf = b.ctx.register(
            b.ctx.obj({ Names: [PDFString.of('a'), b.fit(0), PDFString.of('b'), b.ctx.obj({ D: b.fit(1) }), PDFString.of('c'), b.fit(1)], Limits: [PDFString.of('a'), PDFString.of('c')] }),
          );
          b.catalog.set(PDFName.of('Names'), b.ctx.obj({ Dests: b.ctx.obj({ Kids: [leaf] }) }));
        }),
        deletePageTwo,
      );
      expect(held(doc)).toStrictEqual(GONE);
      expect(dictAt(doc, catalogEntry(doc, 'Dests')).keys().map(String)).toStrictEqual(['/three']);
      const tree = dictAt(doc, dictAt(doc, catalogEntry(doc, 'Names')).get(PDFName.of('Dests')));
      expect(treeKeys(doc, tree)).toStrictEqual(['a']);
      const leaf = dictAt(doc, tree.lookup(PDFName.of('Kids'), PDFArray).get(0));
      expect(leaf.lookup(PDFName.of('Limits'), PDFArray).asArray().map((key) => (key as PDFString).decodeText())).toStrictEqual(['a', 'a']);
    });

    it('a named page in /Names /Pages leaves its tree', async () => {
      const doc = await after(
        await fixture((b) => {
          b.catalog.set(PDFName.of('Names'), b.ctx.obj({ Pages: b.nameTree([['second', b.page(1)], ['third', b.page(2)]]) }));
        }),
        deletePageTwo,
      );
      expect(held(doc)).toStrictEqual(GONE);
      expect(treeKeys(doc, dictAt(doc, catalogEntry(doc, 'Names')).get(PDFName.of('Pages')))).toStrictEqual(['third']);
    });

    it('CONTROL: a named TEMPLATE, a page outside the tree by design, is kept', async () => {
      const doc = await after(
        await fixture((b) => {
          const template = b.ctx.register(b.ctx.obj({ Type: 'Page', MediaBox: [0, 0, 100, 100], Contents: b.ctx.register(b.ctx.stream('BT (template-only) Tj ET')) }));
          b.catalog.set(PDFName.of('Names'), b.ctx.obj({ Templates: b.nameTree([['blank', template]]) }));
        }),
        deletePageTwo,
      );
      // The two pages the tree keeps, and the template beside them.
      expect(held(doc)).toStrictEqual({ pages: 3, mark: false, answer: false });
      expect(treeKeys(doc, dictAt(doc, catalogEntry(doc, 'Names')).get(PDFName.of('Templates')))).toStrictEqual(['blank']);
    });
  });

  describe('structure, threads and annotations of the pages that stay', () => {
    const tagged = (b: Builder, kids: (root: PDFRef) => readonly LibObject[]): void => {
      const root = b.ctx.nextRef();
      b.ctx.assign(root, b.ctx.obj({ Type: 'StructTreeRoot', K: [...kids(root)] }));
      b.catalog.set(PDFName.of('StructTreeRoot'), root);
    };

    it('an element whose content was on the page goes, by its /Pg, a marked-content reference and an object reference', async () => {
      const doc = await after(
        await fixture((b) => {
          tagged(b, (root) => {
            const note = b.ctx.register(b.ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [50, 50, 70, 70], P: b.page(1) }));
            b.annotate(1, note);
            return [
              b.ctx.register(b.ctx.obj({ Type: 'StructElem', S: 'P', P: root, Pg: b.page(1), K: 0 })),
              b.ctx.register(b.ctx.obj({ Type: 'StructElem', S: 'P', P: root, K: [b.ctx.obj({ Type: 'MCR', Pg: b.page(1), MCID: 0 })] })),
              b.ctx.register(b.ctx.obj({ Type: 'StructElem', S: 'Annot', P: root, K: [b.ctx.obj({ Type: 'OBJR', Pg: b.page(1), Obj: note })] })),
              b.ctx.register(b.ctx.obj({ Type: 'StructElem', S: 'H1', P: root, Pg: b.page(0), K: 0 })),
            ];
          });
        }),
        deletePageTwo,
      );
      expect(held(doc)).toStrictEqual(GONE);
      const kids = dictAt(doc, catalogEntry(doc, 'StructTreeRoot')).lookup(PDFName.of('K'), PDFArray);
      expect(kids.asArray().map((kid) => String(dictAt(doc, kid).get(PDFName.of('S'))))).toStrictEqual(['/H1']);
    });

    it('an element with content on a page that stays keeps it, loses the item and the /Pg that named the page, and its /ParentTree entry follows', async () => {
      const doc = await after(
        await fixture((b) => {
          const root = b.ctx.nextRef();
          const both = b.ctx.register(
            b.ctx.obj({ Type: 'StructElem', S: 'P', P: root, Pg: b.page(1), K: [0, b.ctx.obj({ Type: 'MCR', Pg: b.page(2), MCID: 0 })] }),
          );
          const only = b.ctx.register(b.ctx.obj({ Type: 'StructElem', S: 'Span', P: root, Pg: b.page(1), K: 1 }));
          b.node(1).set(PDFName.of('StructParents'), PDFNumber.of(0));
          b.node(2).set(PDFName.of('StructParents'), PDFNumber.of(1));
          b.ctx.assign(
            root,
            b.ctx.obj({ Type: 'StructTreeRoot', K: [both, only], ParentTree: b.ctx.obj({ Nums: [0, [both, only], 1, [both]] }) }),
          );
          b.catalog.set(PDFName.of('StructTreeRoot'), root);
        }),
        deletePageTwo,
      );
      expect(held(doc)).toStrictEqual(GONE);
      const structure = dictAt(doc, catalogEntry(doc, 'StructTreeRoot'));
      const kids = structure.lookup(PDFName.of('K'), PDFArray).asArray().map((kid) => dictAt(doc, kid));
      expect(kids.map((kid) => String(kid.get(PDFName.of('S'))))).toStrictEqual(['/P']);
      const element = kids[0];
      expect(element?.has(PDFName.of('Pg'))).toBe(false);
      expect(element?.lookup(PDFName.of('K'), PDFArray).size()).toBe(1);
      // Page 2's entry kept the element that stays and lost the one that went; page 3's is as it was.
      const nums = dictAt(doc, structure.get(PDFName.of('ParentTree'))).lookup(PDFName.of('Nums'), PDFArray);
      const entry = (at: number): readonly string[] => nums.lookup(at, PDFArray).asArray().map((value) => (value instanceof PDFRef ? 'element' : String(value)));
      expect([entry(1), entry(3)]).toStrictEqual([['element', 'null'], ['element']]);
    });

    it('a thread loses its bead on the page and keeps the one on a page that stays; a thread with none left goes', async () => {
      const doc = await after(
        await fixture((b) => {
          const thread = (title: string, on: readonly number[]): PDFRef => {
            const ref = b.ctx.nextRef();
            const beads = on.map(() => b.ctx.nextRef());
            beads.forEach((bead, index) => {
              const page = on[index] ?? 0;
              b.ctx.assign(
                bead,
                b.ctx.obj({
                  Type: 'Bead',
                  ...(index === 0 ? { T: ref } : {}),
                  N: beads[(index + 1) % beads.length] ?? bead,
                  V: beads[(index - 1 + beads.length) % beads.length] ?? bead,
                  P: b.page(page),
                  R: [50, 50, 300, 500],
                }),
              );
              b.node(page).set(PDFName.of('B'), b.ctx.obj([bead]));
            });
            b.ctx.assign(ref, b.ctx.obj({ Type: 'Thread', F: beads[0] ?? null, I: b.ctx.obj({ Title: PDFString.of(title) }) }));
            return ref;
          };
          b.catalog.set(PDFName.of('Threads'), b.ctx.obj([thread('both', [0, 1]), thread('only', [1])]));
        }),
        deletePageTwo,
      );
      expect(held(doc)).toStrictEqual(GONE);
      const threads = doc.catalog.lookup(PDFName.of('Threads'), PDFArray).asArray().map((thread) => dictAt(doc, thread));
      expect(threads.map((thread) => thread.lookup(PDFName.of('I'), PDFDict).lookup(PDFName.of('Title'), PDFString).decodeText())).toStrictEqual(['both']);
      const first = threads[0]?.get(PDFName.of('F'));
      const bead = dictAt(doc, first);
      // ONE BEAD, linked to itself both ways, and still the thread's first.
      expect([bead.get(PDFName.of('N')), bead.get(PDFName.of('V'))]).toStrictEqual([first, first]);
    });

    it('a reply to a comment that left stays as a comment of its own, and a popup whose parent left goes', async () => {
      const doc = await after(
        await fixture((b) => {
          const note = b.ctx.register(b.ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [50, 50, 70, 70], P: b.page(1), Contents: PDFString.of(MARK) }));
          b.annotate(1, note);
          b.annotate(0, b.ctx.register(b.ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [50, 50, 70, 70], P: b.page(0), IRT: note, RT: PDFName.of('R'), Contents: PDFString.of('a reply') })));
          b.annotate(0, b.ctx.register(b.ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [80, 80, 200, 150], P: b.page(0), Parent: note })));
        }),
        deletePageTwo,
      );
      expect(held(doc)).toStrictEqual(GONE);
      expect(annotationsOn(doc, 0)).toStrictEqual(['/Text']);
      const reply = dictAt(doc, doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).get(0));
      expect([reply.has(PDFName.of('IRT')), reply.has(PDFName.of('RT')), reply.lookup(PDFName.of('Contents'), PDFString).decodeText()]).toStrictEqual([false, false, 'a reply']);
    });

    it('an annotation on a page that stays whose /P named the page now names the page that holds it', async () => {
      const doc = await after(
        await fixture((b) => {
          b.annotate(0, b.ctx.register(b.ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [50, 50, 70, 70], P: b.page(1) })));
        }),
        deletePageTwo,
      );
      expect(held(doc)).toStrictEqual(GONE);
      const square = dictAt(doc, doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).get(0));
      expect(square.get(PDFName.of('P'))).toStrictEqual(doc.getPage(0).ref);
    });
  });

  describe('the form', () => {
    it("a deleted page's field listed in /AcroForm /CO leaves the calculation order, and its answer the file", async () => {
      const doc = await after(
        await fixture((b) => {
          const field = b.ctx.nextRef();
          const widget = b.ctx.register(b.ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [50, 400, 250, 420], P: b.page(1), Parent: field }));
          b.annotate(1, widget);
          b.ctx.assign(field, b.ctx.obj({ FT: 'Tx', T: PDFString.of('total'), V: PDFString.of(ANSWER), Kids: [widget] }));
          b.catalog.set(PDFName.of('AcroForm'), b.ctx.obj({ Fields: [field], CO: [field] }));
        }),
        deletePageTwo,
      );
      expect(held(doc)).toStrictEqual(GONE);
      expect(dictAt(doc, catalogEntry(doc, 'AcroForm')).lookup(PDFName.of('CO'), PDFArray).size()).toBe(0);
    });

    it('so does a field deleteFormFields removed, on every page that stays', async () => {
      const doc = await after(
        await fixture((b) => {
          const field = b.ctx.nextRef();
          const widget = b.ctx.register(b.ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [50, 400, 250, 420], P: b.page(0), Parent: field }));
          b.annotate(0, widget);
          b.ctx.assign(field, b.ctx.obj({ FT: 'Tx', T: PDFString.of('total'), V: PDFString.of(ANSWER), Kids: [widget] }));
          b.catalog.set(PDFName.of('AcroForm'), b.ctx.obj({ Fields: [field], CO: [field] }));
        }),
        (session) => applyDeleteFormFields(session, { kind: 'deleteFormFields', page: 0, indices: [0], version: asDocVersion(1) }),
      );
      expect(held(doc).answer).toBe(false);
    });
  });

  describe('a kind no step names', () => {
    it('a private reference to the page is replaced with null, and the page and its text leave the file', async () => {
      const doc = await after(
        await fixture((b) => {
          b.catalog.set(PDFName.of('MonsteraPrivateProbe'), b.ctx.obj({ Remember: b.page(1), Also: b.page(2) }));
        }),
        deletePageTwo,
      );
      expect(held(doc)).toStrictEqual(GONE);
      const probe = dictAt(doc, catalogEntry(doc, 'MonsteraPrivateProbe'));
      // THE OTHER DIRECTION in the same dictionary: a reference to a page that stays is not touched.
      expect([probe.has(PDFName.of('Remember')) ? String(probe.get(PDFName.of('Remember'))) : 'absent', probe.get(PDFName.of('Also'))]).toStrictEqual([
        'absent',
        doc.getPage(1).ref,
      ]);
    });
  });

  describe('the other commands after which a page is outside the tree', () => {
    const SOURCE = asDocId('00000000-0000-4000-8000-0000000000aa');

    it('REPLACE PAGE: a bookmark to the replaced page follows its replacement, and the replaced page leaves the file', async () => {
      const source = await mupdfWriter.open(await fixture(() => undefined));
      try {
        const doc = await after(
          await fixture((b) => {
            b.outline([{ title: 'Chapter two', entries: { Dest: b.fit(1) } }]);
          }),
          (target) =>
            applyReplacePage(target, { kind: 'replacePage', source: SOURCE, pages: [1], sourcePages: [0], version: asDocVersion(1) }, [source]),
        );
        // The source's page 1 took page 2's place, so the file holds three pages and no mark.
        expect(held(doc)).toStrictEqual({ pages: 3, mark: false, answer: false });
        const item = dictAt(doc, dictAt(doc, catalogEntry(doc, 'Outlines')).get(PDFName.of('First')));
        expect(item.lookup(PDFName.of('Dest'), PDFArray).get(0)).toStrictEqual(doc.getPage(1).ref);
      } finally {
        await mupdfWriter.close(source);
      }
    });

    it('INSERT FROM PDF: a link on a page taken to a page not taken goes, and the page it named does not come in', async () => {
      const source = await mupdfWriter.open(
        await fixture((b) => {
          b.link(0, { Dest: b.fit(1) });
          b.link(0, { Dest: b.fit(2), Contents: PDFString.of('to a page also taken') });
        }),
      );
      try {
        const target = await fixture(() => undefined);
        const doc = await after(target, (session) =>
          applyMergeDocument(session, { kind: 'mergeDocument', documents: [{ source: SOURCE, sourcePages: [0, 2] }], at: 3 }, [source]),
        );
        // The target's three pages, and the source's pages 1 and 3. The target's own page 2 is the one mark.
        expect(held(doc).pages).toBe(5);
        expect(annotationsOn(doc, 3)).toStrictEqual(['/Link']);
        // CONTROL: the link to a page that was also taken stays, and names that page's copy.
        const kept = dictAt(doc, doc.getPage(3).node.lookup(PDFName.of('Annots'), PDFArray).get(0));
        expect(kept.lookup(PDFName.of('Dest'), PDFArray).get(0)).toStrictEqual(doc.getPage(4).ref);
      } finally {
        await mupdfWriter.close(source);
      }
    });

    it('EXTRACT: a bookmark to a page not taken goes, and one with children stays as a heading', async () => {
      const session = await mupdfWriter.open(
        await fixture((b) => {
          b.outline([
            { title: 'Part', entries: { Dest: b.fit(1) }, count: 1, kids: [{ title: 'one', entries: { Dest: b.fit(0) } }] },
            { title: 'two', entries: { Dest: b.fit(1) } },
          ]);
        }),
      );
      try {
        const doc = await PDFDocument.load(await extractPages(session, [0]), { updateMetadata: false });
        expect(held(doc)).toStrictEqual({ pages: 1, mark: false, answer: false });
        expect(outlineOf(doc)).toStrictEqual(['Part (heading) count 1', '  one', 'total 2']);
      } finally {
        await mupdfWriter.close(session);
      }
    });
  });
});
