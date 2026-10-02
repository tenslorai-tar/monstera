import type { PDFDocument, PDFObject } from './mupdfRaw.js';

/**
 * Runs a graft out of `source` with its page TREE out of the graft's reach.
 *
 * ## A graft follows every reference, and a page leaf's `/Parent` reaches every page
 *
 * MuPDF's `graftObject` is a deep copy: it follows each indirect reference it
 * meets and copies what it finds. A page leaf names its `/Pages` node in
 * `/Parent`, that node names every leaf in `/Kids`, and each leaf names its
 * content and resources — so grafting ONE leaf copies the whole document.
 * Measured with `scripts/research/extractGraftScale.mjs`, 2026-10-02, on
 * sources of 10, 40 and 160 pages carrying a square annotation each:
 *
 * | source objects | extract of 2 pages | after duplicating page 1 |
 * |---|---|---|
 * | 34 | 66 | 66 |
 * | 124 | 246 | 246 |
 * | 484 | 966 | 966 |
 *
 * A two-page extract carried every page of its source, unreferenced and
 * readable by anything that walks the file's objects; one duplicate doubled
 * the document. And an extract grafts each page through a map of its own, so
 * the copy was made once PER PAGE: a 4,100-page *every page* extract asked
 * MuPDF for about seventeen million objects and was refused, *"too many
 * objects stored in pdf"*.
 *
 * The leaf is not the only door. An annotation's `/P`, an outline's `/Dest` and
 * a widget reached through `/AcroForm` all name a leaf, so dropping `/Parent`
 * from the one object being grafted would close one door of four.
 *
 * ## Why the tree is DETACHED rather than the copy filtered
 *
 * A filtered copy — every key but `/Parent`, grafted one by one — would be a
 * second opinion about what copying a PDF object means, beside MuPDF's (B3a),
 * and it would still let an annotation's `/P` walk the original leaf back into
 * the tree. MuPDF's graft map cannot be seeded with *this source object is that
 * destination object*, so the one way to keep the authority's copy and stop it
 * at the tree is to take the tree's edge away while it runs: every leaf's
 * `/Parent` is removed, the graft runs, and each is put back as the same
 * reference it was.
 *
 * Nothing between the two writes can observe them — `withDocument` holds the
 * session for the whole synchronous body — and the leaves are collected before
 * any is detached, because MuPDF's page lookup reads `/Parent`.
 *
 * ## What it does NOT close
 *
 * A leaf the operation is not copying is still copied when something grafted
 * names it — a widget of a dropped page reached through `/AcroForm`, an outline
 * pointing at a dropped page. It arrives as one page dictionary and what that
 * page draws, rather than as the whole document. Which references survive a
 * page operation at all is the remap contract's question (`pageExtract.ts`).
 *
 * @param source the document grafted FROM
 * @param body the graft, run with every leaf of `source` detached from its tree
 * @returns what `body` returns
 */
export function graftingWithoutPageTree<T>(source: PDFDocument, body: () => T): T {
  const leaves: PDFObject[] = [];
  const count = source.countPages();
  for (let index = 0; index < count; index += 1) leaves.push(source.findPage(index));

  const parents = leaves.map((leaf) => leaf.get('Parent'));
  for (const leaf of leaves) leaf.delete('Parent');
  try {
    return body();
  } finally {
    leaves.forEach((leaf, index) => {
      const parent = parents[index];
      if (parent !== undefined && !parent.isNull()) leaf.put('Parent', parent);
    });
  }
}
