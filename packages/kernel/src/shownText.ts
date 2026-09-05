import { mupdfWriter, withDocument } from './mupdfWriter.js';

/**
 * What a page **shows**, read back with MuPDF — the one implementation.
 *
 * ## Why this is a module rather than three copies
 *
 * `pageWatermark.test.ts` wrote it, `pageStamp.test.ts` copied it verbatim, and
 * `pageToc.test.ts` was about to be the third. B3a's rule is that *the finding
 * is the second opinion, not the wrong one*: both copies are correct today, and
 * patching whichever is failing leaves the next caller free to write a fourth
 * that agrees with them most of the time.
 *
 * The question these answer — *what strings does this page's content stream
 * actually display* — has one answer, and the two hard parts of it are both
 * measured facts about libraries rather than choices:
 *
 * - **pdf-lib emits text as a hex string.** `<4452414654> Tj`, so
 *   `content.includes('DRAFT')` is false for a page carrying a `DRAFT`
 *   watermark — measured while writing `pageWatermark.test.ts`, where it would
 *   have made every `not.toContain` pass for every implementation.
 * - **`/Contents` is one stream or an array of them**, and pdf-lib appends
 *   rather than replacing, so drawn text lands in a stream that is not the
 *   first. Reading only the first is the same silent zero.
 *
 * ## It is a SEARCH, so every way of breaking it reports the reassuring answer
 *
 * A wrong pattern, a hex form it does not recognise, a page it never reached:
 * all of them return the empty array that a page with nothing drawn returns.
 * Every negative assertion in all three test files rests on that difference, so
 * each of them carries a **positive control** — a case decoding a string the
 * fixture is known to show. The control lives with the caller rather than here
 * because what is known-present differs per fixture, and a control asserting a
 * constant this module wrote would be this module marking its own work.
 *
 * ## Not on the barrel
 *
 * Nothing outside a test imports it, and it reaches `mupdfWriter.ts` → the
 * native library, so exporting it from `index.ts` would bind MuPDF in `main`
 * (ADR-0026, measured at +40.1 MB). It sits beside the modules it reads about
 * for the same reason `filesystemProbe.ts` does.
 */

/**
 * One page's content-stream text.
 *
 * A page that has never been drawn on carries **no `/Contents` at all** — read
 * from a fixture rather than assumed — so absence answers with the empty string
 * rather than throwing.
 */
export async function contentOf(bytes: Uint8Array, page: number): Promise<string> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      // `isNull()` ALONE. MuPDF's `get` answers with a null object rather than
      // `undefined` for a key a dictionary does not have, so an `=== undefined`
      // beside this is a branch the type says cannot run — and lint says so.
      const contents = document.findPage(page).get('Contents');
      if (contents.isNull()) return '';
      const streams = contents.isArray()
        ? Array.from({ length: contents.length }, (_unused, index) => contents.get(index))
        : [contents];
      return streams
        .filter((stream) => stream.isStream())
        .map((stream) => new TextDecoder().decode(stream.readStream().asUint8Array()))
        .join('\n');
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * The strings a content stream actually shows, decoded.
 *
 * Both spellings are read — the hex form pdf-lib emits and the literal form a
 * hand-written stream may carry — because a decoder that knew only one would
 * report the reassuring empty array for the other.
 *
 * Decoding is also the stronger assertion than a substring search: a search
 * cannot tell a drawn `DRAFT` from the letters appearing in a font name or a
 * resource key, and this reads what the page shows.
 */
export function shownStringsOf(content: string): readonly string[] {
  const shown: string[] = [];
  for (const [, hex] of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/gu)) {
    const pairs = (hex ?? '').match(/../gu) ?? [];
    shown.push(pairs.map((pair) => String.fromCharCode(Number.parseInt(pair, 16))).join(''));
  }
  for (const [, literal] of content.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/gu)) {
    shown.push(literal ?? '');
  }
  return shown;
}

/** The strings one page of a document shows. */
export async function shownOn(bytes: Uint8Array, page: number): Promise<readonly string[]> {
  return shownStringsOf(await contentOf(bytes, page));
}
