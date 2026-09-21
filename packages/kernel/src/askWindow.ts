import { type AskSent, MAX_ASK_CONTEXT, askPageMarker } from '@monstera/contract';

/**
 * The text an assistant ask carries about a document, and the instruction it travels in
 * ([ADR-0088](../../../docs/DECISIONS/0088-an-ask-about-a-document-carries-a-bounded-window-read-in-main.md)).
 *
 * ## A window, read one page at a time
 *
 * `main` may not hold a document's text (ADR-0035). This reads pages through the caller's
 * `read`, one at a time, appending each until the window is full — so what is resident is the
 * window plus the page being read, whatever the document's length. The caller holds the lane;
 * this holds no document.
 *
 * ## A page that does not fit is cut, and the answer says so
 *
 * A whole page is kept or the window stops, except when the FIRST page alone overflows it: a
 * window that stopped before its first page would send nothing, and a person asking about a
 * dense page would be answered from no text at all. That page is cut at the bound and the
 * answer is `truncated`.
 */

/** A window, and what it covered. */
export interface AskWindow {
  readonly text: string;
  readonly sent: AskSent;
}

/** What the window reads a page's text through — the lane's own read, from the caller. */
export type ReadPageText = (page: number) => Promise<string>;

/**
 * Reads `pages`, in order, into a window of at most `bound` characters.
 *
 * @param pages zero-based indices, as every page index crossing the contract is
 * @param pageCount the document's, reported in the answer rather than implied by `pages`
 */
export async function readAskWindow(
  pages: readonly number[],
  pageCount: number,
  read: ReadPageText,
  bound: number = MAX_ASK_CONTEXT,
): Promise<AskWindow> {
  let text = '';
  let firstPage: number | null = null;
  let lastPage: number | null = null;
  let truncated = false;

  for (const page of pages) {
    const piece = `${askPageMarker(page)}\n${(await read(page)).trim()}\n\n`;
    if (text.length + piece.length <= bound) {
      text += piece;
      firstPage ??= page;
      lastPage = page;
      continue;
    }
    truncated = true;
    if (firstPage === null) {
      text = piece.slice(0, bound);
      firstPage = page;
      lastPage = page;
    }
    break;
  }

  return { text, sent: { firstPage, lastPage, pageCount, characters: text.length, truncated } };
}

/** A selection as a window: the page it was taken from, and the text a person selected. */
export function selectionWindow(page: number, selected: string, pageCount: number): AskWindow {
  const text = `${askPageMarker(page)}\n${selected}`;
  return { text, sent: { firstPage: page, lastPage: page, pageCount, characters: text.length, truncated: false } };
}

/**
 * The instruction a window travels in.
 *
 * It names the page frame the markers use and asks for citations in the one form
 * `citationsIn` reads — so the answer's links go to the pages the text came from. It says
 * when the window stopped early, because a model told nothing will summarise twelve pages of
 * forty as though they were all of it.
 */
export function askInstruction(window: AskWindow, scope: 'selection' | 'page' | 'document'): string {
  const { firstPage, lastPage, pageCount, truncated } = window.sent;
  const covered =
    firstPage === null || lastPage === null
      ? 'The document has no text to show.'
      : firstPage === lastPage
        ? `It is from page ${String(firstPage + 1)} of ${String(pageCount)}.`
        : `It covers pages ${String(firstPage + 1)} to ${String(lastPage + 1)} of ${String(pageCount)}.`;
  const what =
    scope === 'selection'
      ? 'Below is text the person selected in a PDF document.'
      : 'Below is text from a PDF document the person has open.';
  const stopped = truncated
    ? ' The text stops before the end of what was asked about; say so if the answer may lie beyond it.'
    : '';
  return (
    `${what} ${covered}${stopped} Each page begins with a marker such as [Page 3]. ` +
    'When you rely on a page, cite it as [p. 3]. If the answer is not in the text, say so rather than guessing.' +
    `\n\n${window.text}`
  );
}
