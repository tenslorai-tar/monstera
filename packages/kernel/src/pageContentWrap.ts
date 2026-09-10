import type { PDFDocument, PDFObject } from 'mupdf';

/**
 * Bracketing a page's existing content in a transform — one owner, with callers
 * (B3a).
 *
 * ## What this is, and why it is not *drawing*
 *
 * A command that changes the coordinate system the existing marks are read in
 * adds two streams and rewrites `/Contents` to `[transform, ...original,
 * restore]`. It puts no marks on the page: it sets no colour, paints nothing,
 * and appends to none of the page's own streams — which is what makes such a
 * command **invertible** where every drawing command here takes a checkpoint.
 * `watermarkPages`' argument for a checkpoint is *drawing appends to the
 * stream, so the prior state is the stream*; the premise is false for a wrap,
 * so the conclusion does not follow.
 *
 * ## THE PRIOR STATE IS THE ARRAY'S SHAPE, RECORDED POSITIONALLY
 *
 * The originals are untouched and still referenced, so what an inverse needs is
 * *where they sit* — how many, and whether they were an array to begin with.
 * Two numbers and a boolean per page, whatever the document weighs.
 *
 * Never by object number: MuPDF renumbers objects when it garbage-collects on
 * write, so a prior naming object 8 names something else afterwards, while *the
 * middle of the array* keeps meaning the middle of the array.
 *
 * ## Why it is a module rather than a second copy
 *
 * `pageResize.ts` wrote this first and `pageDeskew.ts` needs it byte for byte —
 * the same array shape, the same refusal, the same `q`/`Q` pair and the same
 * argument for invertibility. Two hand-written answers to *what did this page's
 * `/Contents` look like* is B3a's shape, and the dangerous half is that they
 * would agree on every document either command had a fixture for.
 */

/**
 * A page's `/Contents` **shape** before a wrap ran.
 *
 * Not its value. The entries themselves are left in place and still referenced
 * by the array the wrap writes, so what an inverse needs is where they are.
 *
 * **`wasArray` is not cosmetic**, and it is the member most likely to be read
 * as such. A bare stream reference and a one-element array render identically,
 * which is precisely `setPageTransition`'s argument for restoring absence: two
 * documents that show a reader the same thing are still two documents, and the
 * next command to read `/Contents` sees the difference even though no viewer
 * does.
 */
export type PriorContents =
  | { readonly present: false }
  | { readonly present: true; readonly wasArray: boolean; readonly length: number };

/**
 * The closing stream.
 *
 * A leading newline because content streams in an array are concatenated with
 * no separator inserted, so a page whose last stream ends mid-token would
 * otherwise have `Q` welded onto it.
 */
export const WRAP_CLOSE = '\nQ\n';

/**
 * Whether this page's `/Contents` is a shape a wrap can describe positionally.
 *
 * A `/Contents` that is neither a stream nor an array of them is the case an
 * inverse would silently mis-rebuild, so a capture refuses rather than
 * recording a shape it invented.
 */
export function contentsAreWrappable(contents: PDFObject): boolean {
  return contents.isNull() || contents.isArray() || contents.isStream();
}

/** One page's `/Contents` shape, for the inverse. */
export function contentsPrior(contents: PDFObject): PriorContents {
  if (contents.isNull()) return { present: false };
  return {
    present: true,
    wasArray: contents.isArray(),
    length: contents.isArray() ? contents.length : 1,
  };
}

/** Bytes for a content stream. */
function streamBytes(operators: string): Uint8Array {
  return new TextEncoder().encode(operators);
}

/**
 * Wraps one page's content in `opening` … {@link WRAP_CLOSE}.
 *
 * **`opening` must open with `q`**, so the existing content is bracketed rather
 * than followed. Without the `q`/`Q` pair the matrix is concatenated into
 * whatever the page left in the graphics state, and anything appended later — a
 * watermark, a header — would be transformed too.
 *
 * **The one shape this cannot survive is a stream with more `Q` than `q`**, in
 * which case an unmatched `Q` pops the state the wrap opened and the remainder
 * of the page renders untransformed. That is a malformed content stream by
 * §8.4.4 and nothing here can repair it; it is stated because it is the failure
 * that renders rather than throws.
 *
 * **AN EMPTY PAGE IS NOT WRAPPED**, and the answer says so rather than the
 * caller checking: there is nothing to transform, so adding two streams to
 * bracket nothing would leave a page whose `/Contents` shape the inverse then
 * has to restore for no effect.
 *
 * @returns whether the page was wrapped
 */
export function wrapContents(
  document: PDFDocument,
  object: PDFObject,
  opening: string,
): boolean {
  const existing = object.get('Contents');
  if (existing.isNull()) return false;

  const opened = document.addStream(streamBytes(opening), document.newDictionary());
  const closed = document.addStream(streamBytes(WRAP_CLOSE), document.newDictionary());
  const contents = document.newArray();
  contents.push(opened);
  if (existing.isArray()) {
    for (let at = 0; at < existing.length; at += 1) contents.push(existing.get(at));
  } else {
    contents.push(existing);
  }
  contents.push(closed);
  object.put('Contents', contents);
  return true;
}

/**
 * Rebuilds one page's `/Contents` from the array a wrap wrote.
 *
 * The array is `[transform, ...original, restore]`, so the originals are the
 * entries between the first and the last. **A shape that does not match is
 * refused rather than guessed at**: rebuilding from an array of the wrong
 * length would produce a page holding some other command's streams, and a
 * refused undo is `applyCropPages`' stated preference over a half-restore.
 */
export function restoreWrappedContents(
  document: PDFDocument,
  object: PDFObject,
  page: number,
  prior: PriorContents,
): void {
  if (!prior.present) return;
  const current = object.get('Contents');
  const expected = prior.length + 2;
  if (!current.isArray() || current.length !== expected) {
    throw new Error(
      `page ${String(page)} does not carry the /Contents this command wrote — expected an array ` +
        `of ${String(expected)} entries and found ` +
        `${current.isArray() ? `${String(current.length)} entries` : 'no array'}. Its content ` +
        `has been changed since, so restoring the recorded shape would rebuild the page from ` +
        `the wrong streams.`,
    );
  }
  if (prior.wasArray) {
    const rebuilt = document.newArray();
    for (let at = 1; at <= prior.length; at += 1) rebuilt.push(current.get(at));
    object.put('Contents', rebuilt);
    return;
  }
  // A BARE REFERENCE COMES BACK BARE. It renders identically to a one-element
  // array, and it is a different document — `setPageTransition`'s rule.
  object.put('Contents', current.get(1));
}
