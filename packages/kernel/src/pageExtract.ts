import type { PageSet } from '@monstera/contract/host';

import type { PDFDocument, PDFGraftMap, PDFObject } from './mupdfRaw.js';

import type { ByteImage, MupdfSession } from './engineSeam.js';
import { keepFieldsOnPages } from './formFields.js';
import { bufferBytes, newDocument, withDocument } from './mupdfWriter.js';
import { graftingWithoutPageTree } from './pageGraft.js';
import { pagesOf } from './pageScope.js';

/**
 * Building a NEW document out of some of another one's pages — the operation
 * under D2's *extract to new PDF*, and the one Track C's other four rows reuse.
 *
 * ## A rebuild is the operation here, which is why ADR-0006's ban does not decide it
 *
 * Invariant L6 rewrites the OPEN document's page tree in place, because
 * ADR-0006 measured a rebuild dropping `/AcroForm`, `/Outlines`, `/Names` and
 * `/OCProperties`. An extract's output is a document that did not exist, so
 * there is nothing to rewrite in place. What survives from that measurement is
 * the **failure class to look for**, and looking is what this module is built
 * on rather than assumption.
 *
 * ## THREE ROUTES WERE MEASURED, and two of them are defects
 *
 * `scripts/research/extractGraft.mjs`, run 2026-09-04 against a four-page
 * fixture carrying all four catalog entries and a text field on page 1:
 *
 * | route | the page's `/Annots` | the four catalog entries | pdf-lib reads the field |
 * |---|---|---|---|
 * | `graftPage(to, src, page)` | **dropped** | **dropped** | no |
 * | `graftObject` + `insertPage` | kept | **dropped** | no |
 * | the second, plus grafting the catalog entries | kept | kept | **yes** |
 *
 * MuPDF's own `graftPage` looked like the obvious primitive and drops the
 * annotations outright — so a form's widgets would vanish along with its field
 * tree, and an extracted page would render without its markup.
 *
 * The middle route is worse in the way ADR-0006 named: the widget stays on the
 * page and `/AcroForm` does not, which is a document whose fields render and
 * whose field tree is orphaned. **A fixture carrying only `/AcroForm` would
 * have left three of the four axes assumed**, so the probe's fixture carries
 * all four.
 *
 * ## What the new file holds of the pages it did NOT take: nothing (item 12b, 2026-10-03)
 *
 * `/AcroForm`, `/Names` and `/Outlines` are grafted **whole**, and a graft
 * follows every reference. Measured 2026-10-03: extracting page 1 of a filled
 * four-page form wrote the answer from page 4 and page 4 itself, pulled in by
 * that widget's `/P`; and a named destination naming a page left behind
 * brought that page in too. So after the graft, `keepFieldsOnPages` keeps only
 * the fields whose widgets sit on the new file's pages, `cutPagesLeftBehind`
 * nulls every reference to a page outside its tree, and the file is saved
 * collecting (ADR-0151). A bookmark or link to a page not taken stays and goes
 * nowhere, because its target is not in this file; retargeting it is the remap
 * contract's question and is not answered here.
 */

/**
 * The catalog entries a page tree does not carry, and that a rebuild drops.
 *
 * Derived from ADR-0006's own list rather than from what this module's probe
 * happened to test — the four are what that decision measured, and a fifth
 * appearing in the format is a change to that list rather than to this one.
 */
const CATALOG_ENTRIES = ['AcroForm', 'Outlines', 'Names', 'OCProperties'] as const;

/** Attributes a leaf may inherit from an ancestor `/Pages` node. */
const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate'] as const;

/**
 * Writes `pages` of `session`'s document into a new PDF and returns its bytes.
 *
 * ## It runs where the SESSION is
 *
 * Taking a session rather than bytes is what keeps this available to the engine
 * host without change: the host holds the document, so a channel that asked for
 * an extract would call exactly this. Main never holds a second image
 * (ADR-0021) because the bytes it gets back are the output, not a copy of the
 * input.
 *
 * ## The source is READ and never written
 *
 * One exception, and it is why this is stated: the inheritable push-down writes
 * `/MediaBox` and friends onto the source's own leaves before they are grafted,
 * exactly as the in-document duplicate does. It changes what the leaf
 * *declares* and not what it *resolves to*, so the open document renders
 * identically — but it is a write, it lands in the session, and a save
 * afterwards carries it. The alternative is a copy that resolves its geometry
 * against the new document's root, which is a portrait page where a landscape
 * one was.
 *
 * @param session the document to take pages from
 * @param set the pages, in the order they should appear, as a page set: *every page* of a document of any length is
 *   one run (JOURNAL, *No document-size refusals*; it was a list capped at 4,096)
 * @throws RangeError for an empty set or a page the document does not have
 */
export function extractPages(session: MupdfSession, set: PageSet): Promise<ByteImage> {
  return withDocument(session, (source) => {
    const count = source.countPages();
    // REFUSED, both of them. An empty extract writes a PDF with no pages, which
    // is not one a reader opens — the same rule `deletePages` states from the
    // other side, and it needs the count for the second half exactly as that
    // one does.
    if (set.length === 0) {
      throw new RangeError('an extract with no pages would write a document nothing can open');
    }
    // LISTED BY THE ONE EXPANDER, which refuses a page past the document before any is listed.
    const pages = pagesOf(set, count);

    // PUSHED DOWN BEFORE THE TREE IS DETACHED: `getInheritable` reads up `/Parent`.
    const leaves = pages.map((page) => pushInheritablesDown(source, page));

    const out = newDocument();
    graftingWithoutPageTree(source, () => {
      // ONE MAP FOR THE PAGES AND THE CATALOG, so a resource two pages share is one object, and an outline, a named
      // destination or a widget's `/P` naming a kept page lands on that page's copy rather than on a second one.
      const map = out.newGraftMap();
      const placed = new Set<number>();
      leaves.forEach((leaf, index) => {
        const page = pages[index] ?? 0;
        // A PAGE NAMED TWICE is two pages, and one map answers a second graft of a leaf with the first copy — the same
        // object listed twice in `/Kids`, which is not a page tree. A map of its own makes the repeat a page.
        const copy = placed.has(page) ? out.newGraftMap().graftObject(leaf) : map.graftObject(leaf);
        placed.add(page);
        out.insertPage(out.countPages(), copy);
      });
      carryCatalog(map, source, out);
    });
    out.setPageTreeCache(true);

    // THE NEW FILE HOLDS WHAT ITS PAGES HOLD, and nothing of the pages left behind (the owner's item 12b). The
    // catalog was grafted whole, so the form held every field and answer of the source, and a widget's `/P` or a
    // destination naming a page not taken grafted that page in as an object of its own, content and all.
    keepFieldsOnPages(out);
    cutPagesLeftBehind(out);
    // COLLECTED, as every full save is (ADR-0151): what the two steps above unlinked is not written.
    //
    // THE CALLER'S BYTES, never MuPDF's buffer, whose native memory this function
    // is about to drop: `mupdfWriter.ts`' `bufferBytes` says where the one copy is
    // made and which case asserts it.
    return bufferBytes(out.saveToBuffer('garbage'));
  });
}

/**
 * Gives a leaf its inherited geometry outright, and returns it.
 *
 * The ordering is the whole of the correctness and it is easy to lose: a leaf
 * still inheriting its `/MediaBox` from an intermediate node grafts **without**
 * one, and the copy then resolves against the destination's root — a portrait
 * page where a landscape one was, with the page count and the order both
 * correct. `pageOrder.ts` carries the same step for the same reason.
 */
export function pushInheritablesDown(document: PDFDocument, page: number): PDFObject {
  const leaf = document.findPage(page);
  for (const key of INHERITABLE) {
    if (leaf.get(key).isNull()) {
      const inherited = leaf.getInheritable(key);
      if (!inherited.isNull()) leaf.put(key, inherited);
    }
  }
  return leaf;
}

/**
 * Cuts every reference to a page that is not in this document's page tree.
 *
 * A graft follows a reference wherever it goes, so an outline entry, a named destination or a link on a kept page
 * that names a page the extract did not take arrived with a copy of that page, its content stream included —
 * measured 2026-10-03, a one-page extract of `pageExtract.test.ts`' fixture held three page objects. The reference is
 * replaced by null, so the bookmark or link stays and goes nowhere, because its target is not in this file; the copy is
 * then unreferenced and the collecting save drops it.
 *
 * **A walk of the whole object graph from the trailer**, because the class is *any reference*, not a list of the
 * keys known to hold one. Each indirect object is visited once.
 */
function cutPagesLeftBehind(document: PDFDocument): void {
  const kept = new Set<number>();
  for (let page = 0; page < document.countPages(); page += 1) kept.add(document.findPage(page).asIndirect());
  const leftBehind = (value: PDFObject): boolean =>
    value.isIndirect() &&
    !kept.has(value.asIndirect()) &&
    value.isDictionary() &&
    value.get('Type').isName() &&
    value.get('Type').asName() === 'Page';
  const seen = new Set<number>();
  const visit = (object: PDFObject): void => {
    if (object.isIndirect()) {
      const number = object.asIndirect();
      if (seen.has(number)) return;
      seen.add(number);
    }
    if (!object.isDictionary() && !object.isArray()) return;
    object.forEach((value, key) => {
      if (leftBehind(value)) object.put(key, null);
      else visit(value);
    });
  };
  visit(document.getTrailer());
}

/**
 * Copies the four catalog entries a page tree does not carry.
 *
 * **This is the whole difference between the measured defect and the measured
 * correct result.** Without it the extracted page keeps its widget annotation
 * and the document keeps no `/AcroForm`, which is ADR-0006's orphaned field
 * tree arriving through a different operation.
 *
 * Absent entries are skipped rather than written as null: a document with an
 * empty `/Outlines` is not the same as one with none, and readers differ on
 * which they tolerate.
 */
function carryCatalog(map: PDFGraftMap, source: PDFDocument, out: PDFDocument): void {
  const from = source.getTrailer().get('Root');
  const to = out.getTrailer().get('Root');
  for (const key of CATALOG_ENTRIES) {
    const entry = from.get(key);
    if (!entry.isNull()) to.put(key, map.graftObject(entry));
  }
}
