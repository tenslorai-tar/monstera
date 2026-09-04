import { createHash } from 'node:crypto';

import type { PDFDocument, PDFObject } from 'mupdf';

import type { MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';

/**
 * Finding pages that are the same page — D2's *find duplicate pages*.
 *
 * ## A MEASUREMENT before it is a command, which decides its error direction
 *
 * Nothing here writes. What it produces is a list a person acts on, and the
 * action they take is deleting pages — so the two ways of being wrong are not
 * equal. Reporting two different pages as duplicates ends with the user
 * deleting content; missing a real duplicate leaves the document as it was.
 *
 * **So this errs towards missing them**, and every part of the identity below
 * is chosen for that: two pages are duplicates only when their content bytes
 * are equal AND they resolve the same `/Resources` object. Pages that render
 * identically from independently built resources are not reported, and that is
 * a false negative by design rather than an oversight.
 *
 * ## The common case is exact, not approximate
 *
 * `duplicatePage` grafts the page dictionary and leaves `/Contents` shared —
 * measured 2026-09-04, the same indirect object on both pages — so a document's
 * own duplicates are found by identity rather than by resemblance. So are the
 * duplicates a merge produces from one source.
 *
 * ## What it does NOT do, stated rather than left to be discovered
 *
 * Two pages differing only in an annotation are reported as duplicates: an
 * annotation is not content, and `/Annots` is not read here. That is the right
 * answer for a *page* comparison and the wrong one for a person who has
 * commented on one of the two, so the surface has to say what it compared.
 */

/**
 * One group of pages that are the same page, in ascending order.
 *
 * A group always has at least two members — a page is not a duplicate of
 * itself, and a singleton in this list would be a group a reader has to filter
 * out and a caller has to remember to.
 */
export interface DuplicatePageGroup {
  readonly pages: readonly number[];
}

/**
 * The identity a page is compared by, or `null` when it cannot be computed.
 *
 * `null` is not "this page is unique" — it is *this page was not compared*, and
 * the difference matters because the two produce the same output. A page whose
 * `/Contents` cannot be read is left out of every group rather than joining the
 * group of pages that also could not be read, which is the pairing an
 * empty-string identity would silently create.
 */
function identityOf(document: PDFDocument, page: number): string | null {
  const object = document.findPage(page);
  const contents = object.get('Contents');
  const streams = contents.isArray() ? arrayEntries(contents) : [contents];

  const digest = createHash('sha256');
  for (const stream of streams) {
    if (!stream.isStream()) return null;
    digest.update(stream.readStream().asUint8Array());
    // A SEPARATOR BETWEEN STREAMS, so `['ab', 'c']` and `['a', 'bc']` are
    // different identities. Concatenating without one makes two pages whose
    // operators are split differently look identical — which they may well be,
    // and *may well be* is exactly what this must not decide.
    digest.update(SEPARATOR);
  }

  const resources = object.getInheritable('Resources');
  // THE RESOURCE OBJECT'S IDENTITY, not its contents. Comparing the graph would
  // find more duplicates and could find false ones; comparing the reference
  // finds fewer and cannot. A page with no resources at all is distinguished
  // from one whose resources are object 0.
  digest.update(resources.isNull() ? 'none' : `obj:${String(resources.asIndirect())}`);
  return digest.digest('hex');
}

/** A byte no content stream ends with, marking where one stream stops. */
const SEPARATOR = Uint8Array.from([0]);

/** A PDF array's entries, as objects. */
function arrayEntries(array: PDFObject): PDFObject[] {
  const entries: PDFObject[] = [];
  for (let index = 0; index < array.length; index += 1) entries.push(array.get(index));
  return entries;
}

/**
 * Groups the document's pages by identity, keeping only the groups with more
 * than one member.
 *
 * The groups come back in the order of their **first** page, and each group's
 * pages ascend. A caller rendering them needs an order and the document's own
 * is the only one that means anything to a reader.
 */
export function findDuplicatePages(session: MupdfSession): Promise<readonly DuplicatePageGroup[]> {
  return withDocument(session, (document) => {
    const byIdentity = new Map<string, number[]>();
    for (let page = 0; page < document.countPages(); page += 1) {
      const identity = identityOf(document, page);
      // NOT GROUPED, rather than grouped under a shared "unreadable" key. See
      // `identityOf`: those two produce the same list and mean opposite things.
      if (identity === null) continue;
      const group = byIdentity.get(identity);
      if (group === undefined) byIdentity.set(identity, [page]);
      else group.push(page);
    }

    return [...byIdentity.values()]
      .filter((pages) => pages.length > 1)
      .map((pages) => ({ pages }));
  });
}
