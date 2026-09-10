import { compileQuery } from '@monstera/shared';
import type { CommandOfKind } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { ByteImage } from './engineSeam.js';
import { pageCount, pdfiumWriter, replaceTextObjects, textRuns } from './pdfiumFfi.js';

/**
 * Document-wide replace-all, as the bus calls it.
 *
 * ## The occurrences are found HERE, in the editing engine's own text
 *
 * The payload carries two strings because a list of occurrences scales with the
 * document, so something has to find them — and that something cannot be
 * `document.searchPage`. That channel matches against MuPDF's structured text,
 * and `proof:lineagreement` scored **52.9%** agreement between the two engines'
 * readings of one page: handing its matches to PDFium would name the wrong run
 * about half the time. So this walks PDFium's own runs.
 *
 * ## But the MATCHING RULE is not re-implemented, and that is B3a
 *
 * How a query compares — case, whole words, a pattern — is
 * `@monstera/shared`'s `textMatch.ts`, which the find bar and
 * `document.searchPage` already go through. A second implementation here would
 * be a second opinion about the same question, agreeing with the first on
 * nearly every input a developer tries and differing on the ones somebody chose
 * deliberately. `compileQuery` answers `matchesIn(text)`, which is exactly the
 * per-string matcher this needs.
 *
 * ## ONE TEXT OBJECT AT A TIME, and the limitation is stated rather than hidden
 *
 * `FPDFText_SetText` replaces an object's whole string, and a visual line is
 * several objects — measured, PDFium answers one rect per run. So an occurrence
 * that straddles two objects is **not found**: the word is in the page's text
 * and in neither object's string.
 *
 * That is not a bug to fix with a wider search. Replacing across a boundary
 * means deciding which object keeps the new characters and rewriting the other,
 * which is `lineEdit.ts`' cross-boundary rule — and applying it without a person
 * confirming the grouping is what ADR-0049 refuses. A person who needs that edit
 * has the line dialog, where they can see what they are changing.
 *
 * ## A page is regenerated ONCE, and only if it changed
 *
 * Generation is the whole cost of an edit and is paid per call (ADR-0047
 * Decision 2, 13.7× over forty replacements). So this collects a page's
 * replacements and makes one `replaceTextObjects` call for it — and makes none
 * at all for a page with no match, because an untouched page must not pay a
 * regeneration for a command that found nothing on it.
 */

/**
 * Runs `work` against a session opened from `image`, closing it however it ends.
 *
 * The third copy of these four lines in this package, and they stay copied:
 * sharing them would put an import edge between three modules that have no
 * other reason to know about each other, and the shared thing would be a
 * `try`/`finally`.
 */
async function onImage<T>(
  image: ByteImage,
  work: (session: Awaited<ReturnType<typeof pdfiumWriter.open>>) => Promise<T>,
): Promise<T> {
  const session = await pdfiumWriter.open(image);
  try {
    return await work(session);
  } finally {
    await pdfiumWriter.close(session);
  }
}

/**
 * Says why a replace-all has no prior, so the bus takes a checkpoint.
 *
 * `captureDeletePageObjects`' shape and a third distinct reason. That one
 * refuses because no prior exists; `captureFlattenFormFields` because the prior
 * is unbounded and unserialisable; this one because the prior **exists, is
 * serialisable, and is document-scaled** — every object this would change, with
 * the string it held. `CommandLog.trimTo`'s rule is that an invertible entry
 * retains no document-scaled bytes, so keeping it would put a thousand pages of
 * strings in the log for ever where a checkpoint is one image.
 */
export function captureReplaceAllText(): Promise<CaptureResult<never>> {
  return Promise.resolve({
    captured: false,
    reason:
      'a document-wide replacement cannot be recorded as prior state: the prior is every object ' +
      'it changed, which scales with the document, and an invertible entry may retain nothing ' +
      'document-scaled',
  });
}

/**
 * Unreachable, and required by {@link CommandSpec}'s shape.
 *
 * `CommandPrior` is `never` here, so nothing can construct an argument, and
 * throwing rather than resolving keeps a widened type from landing as an undo
 * that did nothing.
 */
export function invertReplaceAllText(): Promise<ByteImage> {
  throw new Error(
    'a document-wide replacement has no inverse; undo restores the checkpoint the bus took (ADR-0037)',
  );
}

/**
 * Applies a compiled query's replacements to one string.
 *
 * Splices from the END so no surviving offset has moved — `removeObjects`'
 * renumbering hazard on characters instead of indices, and here there is no
 * handle to resolve first, so the ordering is the mechanism rather than a second
 * one.
 *
 * @returns the new string, or `null` when nothing matched
 */
function replacedIn(
  text: string,
  matches: readonly { offset: number; length: number }[],
  replacement: string,
): string | null {
  if (matches.length === 0) return null;
  let next = text;
  for (const match of [...matches].reverse()) {
    next = next.slice(0, match.offset) + replacement + next.slice(match.offset + match.length);
  }
  // A REPLACEMENT MAY PRODUCE THE ORIGINAL — replacing `a` with `a` matches
  // everywhere and changes nothing. Answering `null` for it means the page is
  // not regenerated, which is the same rule the surface applies one layer up.
  return next === text ? null : next;
}

/**
 * Replaces every occurrence across the document, and answers the new bytes.
 *
 * ## Every page is walked, and the pages with no match cost no generation
 *
 * The walk is the command's scope and cannot be narrowed: *document-wide* is
 * what was asked. What is avoidable is the generation, which is the expensive
 * part — so a page whose objects hold no match is read and left alone.
 *
 * ## An unparseable pattern is a THROW, which the bus turns into a refusal
 *
 * `compileQuery` answers `err('invalid-pattern')` for `(` on the way to `(a)`.
 * The boundary deliberately does not compile the pattern — `document.searchPage`
 * records why: a schema rejecting it would answer `internal` plus an incident id
 * for a person mid-keystroke. Here it is a thrown error with the reason in it,
 * and the surface is where a person meets it.
 */
export async function applyReplaceAllText(
  image: ByteImage,
  command: CommandOfKind<'replaceAllText'>,
): Promise<ByteImage> {
  const compiled = compileQuery(command.find, {
    ...(command.caseSensitive === undefined ? {} : { caseSensitive: command.caseSensitive }),
    ...(command.wholeWord === undefined ? {} : { wholeWord: command.wholeWord }),
    ...(command.regex === undefined ? {} : { regex: command.regex }),
    // `'none'`, AND IT IS THE WHOLE REASON THE PAYLOAD HAS NO `normalise`.
    // `compileQuery` matches against normalised text and answers offsets into
    // it; normalisation changes length, so an offset from a normalised match
    // does not index the string being spliced. Passing `'none'` keeps the
    // offsets and the text in one frame — which is the same class of mistake as
    // a page index in two numbering schemes, one alphabet down.
    normalise: 'none',
  });
  if (!compiled.ok) {
    throw new Error(
      `the replacement's pattern could not be compiled (${compiled.error}), so nothing was changed`,
    );
  }

  return onImage(image, async (session) => {
    const pages = await pageCount(session);
    for (let page = 0; page < pages; page += 1) {
      // SEQUENTIALLY, and per page. PDFium's page handles are not safe to work
      // through concurrently, and each page's generation is its own cost — so
      // this is a walk rather than a `Promise.all` over a document.
      // `.runs` ALONE, and the field beside it is deliberately ignored here.
      // `unaddressable` counts text inside a Form XObject that no command can
      // name; a replace-all cannot reach it, and reporting it per page would be
      // a count nothing on this path could carry back — the command answers a
      // version. `document.textLines` is where a person is told, because that is
      // the read a surface makes before offering an edit.
      const { runs } = await textRuns(session, page);
      const replacements = runs.flatMap((run) => {
        const next = replacedIn(run.text, compiled.value.matchesIn(run.text), command.replace);
        return next === null ? [] : [{ index: run.index, text: next }];
      });
      // NO CALL FOR A PAGE WITH NO MATCH. `replaceTextObjects` throws on an
      // empty list precisely so this decision is made here rather than there.
      if (replacements.length === 0) continue;
      await replaceTextObjects(session, page, replacements);
    }
    return pdfiumWriter.serialise(session);
  });
}
