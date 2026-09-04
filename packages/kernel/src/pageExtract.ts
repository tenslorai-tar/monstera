import type { PDFDocument, PDFObject } from 'mupdf';

import type { ByteImage, MupdfSession } from './engineSeam.js';
import { newDocument, withDocument } from './mupdfWriter.js';

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
 * ## What is NOT established, and it belongs to the remap contract
 *
 * `/Names` and `/Outlines` are grafted **whole**, and the probe's fixture had
 * its one named destination pointing at a page the extract kept. A destination
 * naming a page the extract dropped is therefore unmeasured — it is a dangling
 * reference, and *what a page operation does to a reference that no longer
 * resolves* is the remap contract's question rather than this module's. Stated
 * here so the gap is not rediscovered as a bug.
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
 * @param pages zero-based indices, in the order they should appear
 * @throws RangeError for an empty list or a page the document does not have
 */
export function extractPages(
  session: MupdfSession,
  pages: readonly number[],
): Promise<ByteImage> {
  return withDocument(session, (source) => {
    const count = source.countPages();
    // REFUSED, both of them. An empty extract writes a PDF with no pages, which
    // is not one a reader opens — the same rule `deletePages` states from the
    // other side, and it needs the count for the second half exactly as that
    // one does.
    if (pages.length === 0) {
      throw new RangeError('an extract with no pages would write a document nothing can open');
    }
    for (const page of pages) {
      if (page < 0 || page >= count) {
        throw new RangeError(
          `page ${String(page)} is outside a document of ${String(count)} page(s)`,
        );
      }
    }

    const out = newDocument();
    for (const page of pages) {
      out.insertPage(out.countPages(), out.graftObject(pushInheritablesDown(source, page)));
    }
    carryCatalog(source, out);
    out.setPageTreeCache(true);

    // `asUint8Array` rather than the Buffer itself: the seam's `ByteImage` is a
    // plain view, and handing out MuPDF's buffer would tie the bytes' lifetime
    // to a native object this function is about to drop.
    return out.saveToBuffer().asUint8Array();
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
function pushInheritablesDown(document: PDFDocument, page: number): PDFObject {
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
function carryCatalog(source: PDFDocument, out: PDFDocument): void {
  const from = source.getTrailer().get('Root');
  const to = out.getTrailer().get('Root');
  for (const key of CATALOG_ENTRIES) {
    const entry = from.get(key);
    if (!entry.isNull()) to.put(key, out.graftObject(entry));
  }
}
