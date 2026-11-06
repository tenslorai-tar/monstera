import { PDFDict, PDFDocument, PDFName, type PDFRef, PDFString } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { ByteImage } from './engineSeam.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyAddAnnotation } from './pageAnnotations.js';
import { applyApplyRedactions } from './pageRedact.js';

/**
 * Keep bookmarks on pages that aren't redacted (ADR-0163's correction of 2026-11-06), read from the SAVED file after a
 * reopen: which bookmarks a burn-in keeps, where each still lands, how a tree with removed parents is rebuilt, and that
 * a removed bookmark's title is in none of the file's bytes.
 */

/** Where a bookmark goes. */
type Target =
  | { readonly page: number }
  | { readonly named: string }
  | { readonly action: number }
  | { readonly uri: string }
  | { readonly remote: string };

interface Bookmark {
  readonly title: string;
  readonly target: Target;
  readonly closed?: boolean;
  readonly kids?: readonly Bookmark[];
}

const PAGES = 4;

/**
 * A four-page document whose outline is `tree`, with `/PageMode /UseOutlines`. A named destination `chapter-three` is
 * defined, to page 2; any other name is defined nowhere.
 */
async function outlined(tree: readonly Bookmark[]): Promise<ByteImage> {
  const document = await PDFDocument.create();
  const pages = Array.from({ length: PAGES }, () => document.addPage([300, 300]));
  for (const page of pages)
    page.node.set(PDFName.of('Contents'), document.context.register(document.context.stream('0 0 1 rg 20 20 260 260 re f')));
  const ref = (index: number): PDFRef => {
    const page = pages[index];
    if (page === undefined) throw new Error(`no page ${String(index)}`);
    return page.ref;
  };
  const catalog = document.catalog;
  catalog.set(PDFName.of('Dests'), document.context.obj({ 'chapter-three': [ref(2), PDFName.of('Fit')] }));

  const root = document.context.register(document.context.obj({ Type: 'Outlines' }));
  const write = (items: readonly Bookmark[], parent: PDFRef): { first: PDFRef; last: PDFRef; count: number } | undefined => {
    const refs = items.map(() => document.context.nextRef());
    let count = 0;
    items.forEach((item, at) => {
      const own = refs[at];
      if (own === undefined) return;
      const entry: Record<string, unknown> = { Title: PDFString.of(item.title), Parent: parent };
      const before = refs[at - 1];
      const after = refs[at + 1];
      if (before !== undefined) entry['Prev'] = before;
      if (after !== undefined) entry['Next'] = after;
      const { target } = item;
      if ('page' in target) entry['Dest'] = [ref(target.page), PDFName.of('XYZ'), 0, 300, 0];
      else if ('named' in target) entry['Dest'] = PDFName.of(target.named);
      else if ('action' in target) entry['A'] = { S: 'GoTo', D: [ref(target.action), PDFName.of('Fit')] };
      else if ('uri' in target) entry['A'] = { S: 'URI', URI: PDFString.of(target.uri) };
      else entry['A'] = { S: 'GoToR', F: PDFString.of(target.remote), D: [0, PDFName.of('Fit')] };
      const kids = write(item.kids ?? [], own);
      if (kids !== undefined) {
        entry['First'] = kids.first;
        entry['Last'] = kids.last;
        entry['Count'] = item.closed === true ? -kids.count : kids.count;
      }
      document.context.assign(own, document.context.obj(entry as never));
      count += 1 + (kids !== undefined && item.closed !== true ? kids.count : 0);
    });
    const first = refs[0];
    const last = refs[refs.length - 1];
    return first === undefined || last === undefined ? undefined : { first, last, count };
  };
  const top = write(tree, root);
  if (top !== undefined) {
    const outlines = document.context.lookup(root, PDFDict);
    outlines.set(PDFName.of('First'), top.first);
    outlines.set(PDFName.of('Last'), top.last);
    outlines.set(PDFName.of('Count'), document.context.obj(top.count));
  }
  catalog.set(PDFName.of('Outlines'), root);
  catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  return document.save({ useObjectStreams: false });
}

/** A kept bookmark as the reopened file reads it: its title, the page MuPDF lands on, and its children. */
interface Read {
  readonly title: string;
  readonly page: number | null;
  readonly kids?: readonly Read[];
}

interface Saved {
  readonly saved: ByteImage;
  /** The outline as MuPDF reads it after a reopen, or null when there is none. */
  readonly outline: readonly Read[] | null;
  /** `/PageMode`, as written. */
  readonly pageMode: string;
  /** The outline's `/Count` and each item's, in reading order, and every kept item's `/Dest` where it is a name. */
  readonly counts: readonly number[];
  readonly destNames: readonly string[];
}

/** Marks a region on each of `marked`, burns in over `pages` with `keepBookmarks`, serialises, and reads it back. */
async function burned(bytes: ByteImage, marked: readonly number[], pages: 'all' | number[], keepBookmarks: boolean): Promise<Saved> {
  const session = await mupdfWriter.open(bytes);
  try {
    for (const page of marked)
      await applyAddAnnotation(session, {
        kind: 'addAnnotation',
        page,
        stamp: { author: 'A. Tester', created: '2026-11-06T09:00:00.000Z' },
        annotation: { type: 'redact', over: 'region', rect: { x0: 40, y0: 40, x1: 120, y1: 120 }, colour: [0.85, 0.15, 0.15], opacity: 1 },
      });
    await applyApplyRedactions(session, { kind: 'applyRedactions', pages, cover: 'solid', images: 'pixels', keepTitle: false, keepBookmarks });
    const saved = await mupdfWriter.serialise(session);
    const again = await mupdfWriter.open(saved);
    try {
      return { saved, ...(await withDocument(again, (document) => readBack(document))) };
    } finally {
      await mupdfWriter.close(again);
    }
  } finally {
    await mupdfWriter.close(session);
  }
}

function readBack(document: mupdf.PDFDocument): Omit<Saved, 'saved'> {
  const toRead = (items: readonly { title?: string | undefined; page?: number | undefined; down?: readonly unknown[] | undefined }[]): Read[] =>
    items.map((item) => {
      const kids = item.down === undefined ? undefined : toRead(item.down as never);
      return { title: item.title ?? '', page: item.page ?? null, ...(kids === undefined ? {} : { kids }) };
    });
  const loaded = document.loadOutline();
  const root = document.getTrailer().get('Root');
  const counts: number[] = [];
  const destNames: string[] = [];
  const outlines = root.get('Outlines');
  if (outlines.isDictionary()) {
    counts.push(outlines.get('Count').asNumber());
    const walk = (item: mupdf.PDFObject): void => {
      for (let at = item; at.isDictionary(); at = at.get('Next')) {
        const count = at.get('Count');
        if (count.isNumber()) counts.push(count.asNumber());
        const dest = at.get('Dest');
        if (dest.isName()) destNames.push(dest.asName());
        walk(at.get('First'));
      }
    };
    walk(outlines.get('First'));
  }
  return { outline: loaded === null ? null : toRead(loaded), pageMode: String(root.get('PageMode')), counts, destNames };
}

/**
 * Every byte of the saved file as text, AND every stream decoded — an object stream included, which is where a
 * writer that packs objects puts an outline item's dictionary.
 */
function everythingIn(saved: ByteImage): string {
  let text = Buffer.from(saved).toString('latin1');
  const document = mupdf.PDFDocument.openDocument(saved, 'application/pdf');
  try {
    if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
    let streams = 0;
    for (let at = 1; at < document.countObjects(); at += 1) {
      const object = document.newIndirect(at);
      if (!object.isStream()) continue;
      streams += 1;
      text += `\n${object.readStream().asString()}`;
    }
    // THE READING SAW STREAMS: four pages' content at least, so an empty result is not a clean one.
    if (streams < PAGES) throw new Error(`only ${String(streams)} streams read from the saved file`);
  } finally {
    document.destroy();
  }
  return text;
}

const SECRET = 'Secret plan for Q4';

describe('Keep bookmarks on pages that aren’t redacted, read from the saved file', () => {
  const tree: Bookmark[] = [
    { title: SECRET, target: { page: 0 } },
    { title: 'Kept, direct', target: { page: 1 } },
    { title: 'Kept, named', target: { named: 'chapter-three' } },
    { title: 'Kept, action', target: { action: 3 } },
  ];

  it('CONTROL, OFF: the outline goes whole and /PageMode /UseOutlines with it, as every burn-in did before', async () => {
    const result = await burned(await outlined(tree), [0], 'all', false);
    expect(result.outline).toBeNull();
    expect(result.pageMode).not.toBe('/UseOutlines');
    const all = everythingIn(result.saved);
    for (const { title } of tree) expect(all).not.toContain(title);
  });

  it('CONTROL, nothing burned: the reading finds every title in the file and every bookmark on its page', async () => {
    const bytes = await outlined(tree);
    // NO MARK: the burn-in skips every page, so nothing is removed, and the same readings see the outline as made.
    const result = await burned(bytes, [], 'all', true);
    expect(result.outline?.map((item) => [item.title, item.page])).toStrictEqual([
      [SECRET, 0],
      ['Kept, direct', 1],
      ['Kept, named', 2],
      ['Kept, action', 3],
    ]);
    expect(everythingIn(result.saved)).toContain(SECRET);
  });

  it('ON: the bookmark to the redacted page goes, title and all; direct, named and action bookmarks to other pages stay and land', async () => {
    const result = await burned(await outlined(tree), [0], 'all', true);
    expect(result.outline?.map((item) => [item.title, item.page])).toStrictEqual([
      ['Kept, direct', 1],
      ['Kept, named', 2],
      ['Kept, action', 3],
    ]);
    expect(everythingIn(result.saved)).not.toContain(SECRET);
    expect(result.pageMode).toBe('/UseOutlines');
    // THE NAMED ONE IS RENAMED with every other reference to the name, and still lands on page 2, above.
    expect(result.destNames).toHaveLength(1);
    expect(result.destNames[0]).not.toBe('chapter-three');
    expect(result.counts).toStrictEqual([3]);
  });

  it('ON: a web link, a broken destination and another file’s destination go, since none is a page of this document', async () => {
    const result = await burned(
      await outlined([
        { title: 'Web link', target: { uri: 'https://example.org/' } },
        { title: 'Broken', target: { named: 'nowhere' } },
        { title: 'Other file', target: { remote: 'other.pdf' } },
        { title: 'Kept, direct', target: { page: 1 } },
      ]),
      [0],
      'all',
      true,
    );
    expect(result.outline?.map((item) => item.title)).toStrictEqual(['Kept, direct']);
    const all = everythingIn(result.saved);
    for (const title of ['Web link', 'Broken', 'Other file']) expect(all).not.toContain(title);
  });

  it('ON, nesting: a removed parent’s kept child moves up in its place; a removed child goes; the counts are right', async () => {
    const result = await burned(
      await outlined([
        { title: 'First, kept', target: { page: 1 } },
        {
          title: 'Parent on the redacted page',
          target: { page: 0 },
          kids: [
            { title: 'Child, kept', target: { page: 2 } },
            { title: 'Child on the redacted page', target: { page: 0 } },
            { title: 'Child, closed and kept', target: { page: 3 }, closed: true, kids: [{ title: 'Grandchild, kept', target: { page: 1 } }] },
          ],
        },
        { title: 'Kept parent', target: { page: 1 }, kids: [{ title: 'Its child on the redacted page', target: { page: 0 } }, { title: 'Its child, kept', target: { page: 3 } }] },
      ]),
      [0],
      'all',
      true,
    );
    expect(result.outline).toStrictEqual([
      { title: 'First, kept', page: 1 },
      { title: 'Child, kept', page: 2 },
      { title: 'Child, closed and kept', page: 3, kids: [{ title: 'Grandchild, kept', page: 1 }] },
      { title: 'Kept parent', page: 1, kids: [{ title: 'Its child, kept', page: 3 }] },
    ]);
    // THE ROOT COUNTS FIVE: four at the top and the open parent's one child; the closed item's grandchild does not show.
    // Then, in reading order: the closed item's -1, the open parent's 1.
    expect(result.counts).toStrictEqual([5, -1, 1]);
    const all = everythingIn(result.saved);
    for (const title of ['Parent on the redacted page', 'Child on the redacted page', 'Its child on the redacted page']) expect(all).not.toContain(title);
  });

  it('ON, every bookmark on a redacted page: no outline is left, and /PageMode /UseOutlines goes', async () => {
    const result = await burned(
      await outlined([
        { title: 'One', target: { page: 0 }, kids: [{ title: 'Two', target: { page: 0 } }] },
        { title: 'Three', target: { action: 0 } },
      ]),
      [0],
      'all',
      true,
    );
    expect(result.outline).toBeNull();
    expect(result.pageMode).not.toBe('/UseOutlines');
  });

  it('ON, an outline whose items loop: the walks cannot be paired, so nothing is kept and the outline goes whole', async () => {
    // THE FAIL-CLOSED BRANCH. The second item's /Next points back at the first, a cycle MuPDF's own walk stops at
    // somewhere this module cannot know; keeping by a guessed pairing could keep the wrong item.
    const looped = await PDFDocument.load(await outlined([
      { title: 'Kept, direct', target: { page: 1 } },
      { title: 'Also kept', target: { page: 2 } },
    ]));
    const outlines = looped.catalog.lookup(PDFName.of('Outlines'), PDFDict);
    const first = outlines.get(PDFName.of('First'));
    const second = outlines.lookup(PDFName.of('Last'), PDFDict);
    if (first === undefined) throw new Error('no first item');
    second.set(PDFName.of('Next'), first);
    const result = await burned(await looped.save({ useObjectStreams: false }), [0], 'all', true);
    expect(result.outline).toBeNull();
    // CONTROL: the same two bookmarks with no loop are both kept, so the loop is what removed them.
    const plain = await burned(
      await outlined([
        { title: 'Kept, direct', target: { page: 1 } },
        { title: 'Also kept', target: { page: 2 } },
      ]),
      [0],
      'all',
      true,
    );
    expect(plain.outline?.map((item) => item.title)).toStrictEqual(['Kept, direct', 'Also kept']);
  });

  it('ON, the Page scope: a mark on another page is not taken, so that page’s bookmark stays; Every page takes it', async () => {
    const pages: Bookmark[] = [
      { title: 'On page 1', target: { page: 0 } },
      { title: 'On page 3', target: { page: 2 } },
      { title: 'On page 4', target: { page: 3 } },
    ];
    const page = await burned(await outlined(pages), [0, 2], [0], true);
    expect(page.outline?.map((item) => item.title)).toStrictEqual(['On page 3', 'On page 4']);
    const every = await burned(await outlined(pages), [0, 2], 'all', true);
    expect(every.outline?.map((item) => item.title)).toStrictEqual(['On page 4']);
  });
});
