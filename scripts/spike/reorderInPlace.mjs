// @ts-check
/**
 * Reference implementation of the page reorder the matrix now assigns to MuPDF.
 *
 * Spike evidence, not shipped code — the kernel's command will be written
 * against this having been proven, not by importing it.
 *
 * Invariant L6 requires the page tree to be rewritten **in place**, because
 * rebuilding into a new document drops `/AcroForm`, `/Outlines`, `/Names` and
 * `/OCProperties`. MuPDF's own `rearrangePages` is banned for the same family of
 * reason: it drops `/AcroForm` even for an identity permutation.
 *
 * Two steps here are not obvious and were both established by a test that
 * failed first:
 *
 * 1. **Inheritable attributes are pushed down before the tree is flattened.**
 *    A page tree may nest, and an intermediate `/Pages` node can carry
 *    `/Resources`, `/MediaBox`, `/CropBox` or `/Rotate` that its leaves inherit
 *    rather than declare. Flattening without pushing those down silently
 *    changes how those pages render — a landscape page becomes portrait — and
 *    nothing about the page order looks wrong afterwards.
 *
 * 2. **The root `/Pages` object is mutated, never replaced.** Everything the
 *    catalog points at hangs off identity; assigning a new `/Pages` object is a
 *    rebuild wearing an in-place costume.
 *
 * The first version of this reversed the root `/Kids` array directly. That is
 * correct only for a flat tree, and on a nested one it permutes *subtrees*: a
 * six-page document in two branches of three came back as 4 5 6 1 2 3 rather
 * than 6 5 4 3 2 1.
 */

/** Attributes a leaf may inherit from an ancestor `/Pages` node (PDF 32000-1 §7.7.3.4). */
const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];

/**
 * @param {import('mupdf').PDFDocument} doc
 * @param {readonly number[]} permutation Source index for each destination slot.
 */
export function reorderPagesInPlace(doc, permutation) {
  const count = doc.countPages();

  if (permutation.length !== count) {
    throw new Error(
      `Expected a full permutation of ${String(count)} pages, received ${String(permutation.length)}. ` +
        `A short list would delete the omitted pages rather than reorder them.`,
    );
  }
  const seen = new Set(permutation);
  if (seen.size !== count || [...seen].some((i) => i < 0 || i >= count)) {
    throw new Error('Permutation must contain each page index exactly once.');
  }

  // Resolve every leaf first, pushing inherited attributes onto it while the
  // tree that carries them is still intact.
  const leaves = [];
  for (let index = 0; index < count; index += 1) {
    const page = doc.findPage(index);
    for (const key of INHERITABLE) {
      if (page.get(key).isNull()) {
        const inherited = page.getInheritable(key);
        if (!inherited.isNull()) page.put(key, inherited);
      }
    }
    leaves.push(page);
  }

  const root = doc.getTrailer().get('Root').get('Pages');
  const kids = doc.newArray();
  for (const source of permutation) kids.push(leaves[source]);

  root.put('Kids', kids);
  root.put('Count', count);
  for (const leaf of leaves) leaf.put('Parent', root);

  // MuPDF memoises the page tree; without this, loadPage still returns the old
  // order and the change appears not to have happened.
  doc.setPageTreeCache(true);
}
