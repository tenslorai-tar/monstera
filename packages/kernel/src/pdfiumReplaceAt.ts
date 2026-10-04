import { compileQuery } from '@monstera/shared';
import type { CommandOfKind } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { ByteImage } from './engineSeam.js';
import { objectRuns, pdfiumWriter, replaceTextObjects } from './pdfiumFfi.js';
import type { PriorTextObjects } from './pdfiumTextEdit.js';
import { TextNotInPlaceError } from './textEditRefusals.js';

/**
 * One occurrence of a word replaced where it is on the page (ADR-0156 Decision 4).
 *
 * ## The point names the occurrence; the word confirms it
 *
 * The renderer found the word in MuPDF's reading of the page and sends its centre in PDF user space. This walks
 * PDFium's own runs, one per text object as `replaceAllText`'s walk does, and takes the run whose bounds hold the point
 * — then requires that run to hold the word, whole and exactly as written, exactly once. A run at the point that holds
 * it twice is not guessed between: the point is inside the run, not inside a character, and PDFium's runs carry no
 * character positions here. So everything but one run with one match is {@link TextNotInPlaceError}, and nothing is
 * written.
 *
 * ## The matching rule is `@monstera/shared`'s, for `replaceAllText`'s reason
 *
 * `compileQuery` with `wholeWord` and `caseSensitive` on and `normalise: 'none'`, so the offsets index the string being
 * spliced (`applyReplaceAllText` says why normalisation would move them).
 */

/** The one object an occurrence names, and the string it becomes — or `undefined` where no single object holds it. */
export function occurrenceAt(
  runs: readonly {
    readonly index: number;
    readonly text: string;
    readonly left: number;
    readonly right: number;
    readonly bottom: number;
    readonly top: number;
  }[],
  command: Pick<CommandOfKind<'replaceTextAt'>, 'find' | 'replace' | 'at'>,
): { readonly index: number; readonly before: string; readonly after: string } | undefined {
  const compiled = compileQuery(command.find, { caseSensitive: true, wholeWord: true, normalise: 'none' });
  if (!compiled.ok) return undefined;
  const { x, y } = command.at;
  const holding = runs.filter(
    (run) =>
      x >= Math.min(run.left, run.right) &&
      x <= Math.max(run.left, run.right) &&
      y >= Math.min(run.bottom, run.top) &&
      y <= Math.max(run.bottom, run.top) &&
      compiled.value.matchesIn(run.text).length > 0,
  );
  // ONE RUN, AND THE WORD ONCE IN IT. Two runs at the point holding the word are overlapping objects, and one run
  // holding it twice has no character positions to choose by; either way a pick would be a guess.
  const [only] = holding;
  if (only === undefined || holding.length > 1) return undefined;
  const matches = compiled.value.matchesIn(only.text);
  const [match] = matches;
  if (match === undefined || matches.length > 1) return undefined;
  const after = only.text.slice(0, match.offset) + command.replace + only.text.slice(match.offset + match.length);
  return { index: only.index, before: only.text, after };
}

/** Runs `work` against a session opened from `image`, closing it however it ends — the sibling modules' four lines. */
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
 * Records the string the picked object held, so the replacement undoes as `replaceTextObject`'s does.
 *
 * The same pick the apply makes, on the same bytes, so the prior names the object the apply will write. Where nothing
 * is picked there is no prior and the apply refuses; the capture says so rather than recording an object it would not
 * touch.
 */
export async function captureReplaceTextAt(
  image: ByteImage,
  command: CommandOfKind<'replaceTextAt'>,
): Promise<CaptureResult<PriorTextObjects>> {
  return onImage(image, async (session) => {
    const { runs } = await objectRuns(session, command.page);
    const picked = occurrenceAt(runs, command);
    if (picked === undefined) {
      return {
        captured: false,
        reason: `no single text object on page ${String(command.page)} holds the word at that point, so nothing will be replaced`,
      };
    }
    return { captured: true, prior: { page: command.page, objects: [{ index: picked.index, text: picked.before }] } };
  });
}

/** Replaces the one occurrence, or refuses with {@link TextNotInPlaceError} and writes nothing. */
export async function applyReplaceTextAt(
  image: ByteImage,
  command: CommandOfKind<'replaceTextAt'>,
): Promise<ByteImage> {
  return onImage(image, async (session) => {
    const { runs } = await objectRuns(session, command.page);
    const picked = occurrenceAt(runs, command);
    if (picked === undefined) throw new TextNotInPlaceError();
    // A REPLACEMENT THAT CHANGES NOTHING — the word for itself — writes nothing and generates nothing, `replacedIn`'s
    // rule: the page is not regenerated for an edit that leaves it as it was.
    if (picked.after === picked.before) return pdfiumWriter.serialise(session);
    await replaceTextObjects(session, command.page, [{ index: picked.index, text: picked.after }]);
    return pdfiumWriter.serialise(session);
  });
}
