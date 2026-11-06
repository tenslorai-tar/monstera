import type * as mupdf from './mupdfRaw.js';

/**
 * The bookmarks a burn-in may keep when the person asks to (ADR-0163's correction of 2026-11-06): a bookmark stays
 * only if its destination resolves to a page of this document that the burn-in redacted nothing on.
 *
 * ## Which page a bookmark goes to is MuPDF's answer, never this module's
 *
 * A destination is a page reference, a named destination in one of two stores, or a GoTo action holding either, and
 * MuPDF already resolves all of them for its own outline (`loadOutline`, each item's `page` and `uri`). Resolving them
 * here too would be a second opinion about the format (B3a). So the file's own items, which are what must be edited,
 * are walked beside MuPDF's, in the same order (`/First`, then `/Next`), and each takes MuPDF's answer for its
 * position. **If the two walks disagree** in shape or in any title, the pairing cannot be trusted and nothing is kept:
 * the whole outline goes, which is what a burn-in does without the option. Failing towards removal is the point.
 *
 * ## What goes
 *
 * - a bookmark to a redacted page;
 * - a bookmark with no page in this document: MuPDF resolves no page (a broken destination), or its link is not
 *   internal (`uri` not starting `#`: a web link, another file's destination);
 * - a removed bookmark's children are judged on their own; a kept one moves up to its removed parent's level, in its
 *   place among that parent's siblings.
 *
 * The removed items are left unreferenced, and the burn-in's removing save collects them, title and all.
 *
 * @returns whether any bookmark was kept; on `false` the caller removes the outline as a whole.
 */
export function keepUnredactedBookmarks(document: mupdf.PDFDocument, redacted: ReadonlySet<number>): boolean {
  const outlines = document.getTrailer().get('Root').get('Outlines');
  if (!outlines.isDictionary()) return false;
  const resolved = resolvedOutline(document);
  const raw = rawItems(outlines.get('First'), new Set());
  if (resolved === null || raw === undefined) return false;
  const paired = pair(raw, resolved);
  if (paired === undefined) return false;

  const kept = prune(paired, redacted);
  if (kept.length === 0) return false;
  relink(outlines, kept);
  // THE ROOT'S COUNT is every item shown at its open level; each item's own is set where it is linked.
  outlines.put('Count', visible(kept));
  return true;
}

/**
 * MuPDF's outline, or `null` where MuPDF cannot read it.
 *
 * **MuPDF THROWS on an outline whose items loop** (*Cycle detected in outlines*, measured 2026-11-06 on MuPDF 1.28.0
 * with one item's `/Next` pointing back at the first). Without this the person's tick would refuse the whole burn-in
 * because of their document. An outline MuPDF cannot read has no pairing to trust, so it is answered as one: nothing
 * is kept, and the caller removes the outline, which is what a burn-in does without the option. The error is not
 * hidden; its consequence is the safe side, and `redactionBookmarks.test.ts` asserts it.
 */
function resolvedOutline(document: mupdf.PDFDocument): readonly ResolvedItem[] | null {
  try {
    return document.loadOutline();
  } catch {
    return null;
  }
}

/** One item as the file holds it, with its children. */
interface RawItem {
  readonly object: mupdf.PDFObject;
  readonly kids: readonly RawItem[];
}

/** One file item with MuPDF's reading of it. */
interface PairedItem {
  readonly object: mupdf.PDFObject;
  readonly page: number | undefined;
  readonly uri: string | undefined;
  readonly open: boolean;
  readonly kids: readonly PairedItem[];
}

/** A kept item and the kept items now under it. */
interface KeptItem {
  readonly item: PairedItem;
  readonly kids: readonly KeptItem[];
}

/** MuPDF's outline item, as `loadOutline` answers it. */
interface ResolvedItem {
  readonly title?: string | undefined;
  readonly uri?: string | undefined;
  readonly open: boolean;
  readonly page?: number | undefined;
  readonly down?: readonly ResolvedItem[] | undefined;
}

/**
 * The file's items from `first` on, following `/Next` and each item's `/First`. `undefined` on a revisited object:
 * a cycle MuPDF's walk would have stopped at somewhere this one cannot know, so the pairing would not hold.
 */
function rawItems(first: mupdf.PDFObject, seen: Set<number>): RawItem[] | undefined {
  const items: RawItem[] = [];
  for (let item = first; item.isDictionary(); item = item.get('Next')) {
    if (item.isIndirect()) {
      if (seen.has(item.asIndirect())) return undefined;
      seen.add(item.asIndirect());
    }
    const kids = rawItems(item.get('First'), seen);
    if (kids === undefined) return undefined;
    items.push({ object: item, kids });
  }
  return items;
}

/** The file's items paired with MuPDF's, or `undefined` where their shape or a title differs. */
function pair(raw: readonly RawItem[], resolved: readonly ResolvedItem[]): PairedItem[] | undefined {
  if (raw.length !== resolved.length) return undefined;
  const out: PairedItem[] = [];
  for (let at = 0; at < raw.length; at += 1) {
    const file = raw[at];
    const read = resolved[at];
    if (file === undefined || read === undefined) return undefined;
    const title = file.object.get('Title');
    if ((title.isString() ? title.asString() : undefined) !== read.title) return undefined;
    const kids = pair(file.kids, read.down ?? []);
    if (kids === undefined) return undefined;
    out.push({ object: file.object, page: read.page, uri: read.uri, open: read.open, kids });
  }
  return out;
}

/**
 * Whether a bookmark stays: an internal link MuPDF resolves to a page nothing was redacted on.
 *
 * **The `#` test is reached by no fixture, and is kept.** MuPDF 1.28.0 resolves no page for an external link, so a web
 * link and another file's destination already fail on `page` (measured 2026-11-06: removing the test turned no case
 * red in `redactionBookmarks.test.ts`). It stays because its fact is true, and a MuPDF that resolved a page for an
 * external link would otherwise keep another file's bookmark landing on this file's page of the same number.
 */
function stays(item: PairedItem, redacted: ReadonlySet<number>): boolean {
  return item.uri?.startsWith('#') === true && item.page !== undefined && item.page >= 0 && !redacted.has(item.page);
}

/** The kept items of `items`, a removed item's kept children taking its place. */
function prune(items: readonly PairedItem[], redacted: ReadonlySet<number>): KeptItem[] {
  return items.flatMap((item) => {
    const kids = prune(item.kids, redacted);
    return stays(item, redacted) ? [{ item, kids }] : kids;
  });
}

/** How many items show under `items` with every open item open, which is what `/Count` counts. */
function visible(items: readonly KeptItem[]): number {
  return items.reduce((sum, { item, kids }) => sum + 1 + (item.open ? visible(kids) : 0), 0);
}

/**
 * Writes `items` as `parent`'s children: `/Parent`, `/Prev`, `/Next`, the parent's `/First` and `/Last`, and every
 * `/Count`. An open item's count is its visible descendants; a closed one's is that number negated (ISO 32000-1 §12.3.3).
 */
function relink(parent: mupdf.PDFObject, items: readonly KeptItem[]): void {
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) {
    parent.delete('First');
    parent.delete('Last');
    parent.delete('Count');
    return;
  }
  parent.put('First', first.item.object);
  parent.put('Last', last.item.object);
  items.forEach(({ item, kids }, at) => {
    const object = item.object;
    object.put('Parent', parent);
    const before = items[at - 1];
    const after = items[at + 1];
    if (before === undefined) object.delete('Prev');
    else object.put('Prev', before.item.object);
    if (after === undefined) object.delete('Next');
    else object.put('Next', after.item.object);
    relink(object, kids);
    if (kids.length > 0) object.put('Count', item.open ? visible(kids) : -visible(kids));
  });
}
