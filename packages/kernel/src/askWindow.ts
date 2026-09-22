import {
  type AskAbout,
  type AskSent,
  type AskSide,
  MAX_ASK_CONTEXT,
  askCitation,
  askPageMarker,
} from '@monstera/contract';

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
  side?: AskSide,
): Promise<AskWindow> {
  let text = '';
  let firstPage: number | null = null;
  let lastPage: number | null = null;
  let truncated = false;

  for (const page of pages) {
    const piece = `${askPageMarker(page, side)}\n${(await read(page)).trim()}\n\n`;
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

/**
 * Text the renderer sent with the ask — a selection or a comment — as a window: the page it
 * belongs to, and the text itself.
 */
export function carriedWindow(page: number, carried: string, pageCount: number): AskWindow {
  const text = `${askPageMarker(page)}\n${carried}`;
  return { text, sent: { firstPage: page, lastPage: page, pageCount, characters: text.length, truncated: false } };
}

/**
 * What the instruction says the text is, one sentence per scope. A `Record` over the contract's
 * scopes, so a scope added there is a compile error here until it has its own words — a comment
 * was once described as "text the person selected" because it borrowed the selection's.
 */
const WHAT: Readonly<Record<AskAbout['scope'], string>> = {
  selection: 'Below is text the person selected in a PDF document.',
  comment: 'Below is the text of a comment left on a PDF document.',
  page: 'Below is text from a PDF document the person has open.',
  document: 'Below is text from a PDF document the person has open.',
  comments:
    'Below are the comments left on a PDF document the person has open, each under the page it is on; ' +
    'a reply is marked as one, and each comment says what kind of mark carries it.',
  'page-image': 'Attached is a picture of one page of a PDF document the person has open.',
};

/**
 * What a picture ask covers (ADR-0090): one page, no text, and the `picture` flag the turn's line
 * reads, so it says *a picture of page N* rather than a count of characters.
 */
export function pictureSent(page: number, pageCount: number): AskSent {
  return { firstPage: page, lastPage: page, pageCount, characters: 0, truncated: false, picture: true };
}

/**
 * The instruction a picture travels with: which page it is, and the same citation form every
 * other ask asks for, so a link in the answer goes to the page that was pictured.
 */
export function askPictureInstruction(sent: AskSent): string {
  const page = sent.firstPage ?? 0;
  return (
    `${WHAT['page-image']} It is page ${String(page + 1)} of ${String(sent.pageCount)}. ` +
    `Read it as it appears, including any table, handwriting or figure; when you give a table, give it as a ` +
    `Markdown table. When you rely on the page, cite it as ${askCitation(page)}. ` +
    'If the answer is not on the page, say so rather than guessing.'
  );
}

/** One annotation's words, as the comments window lists them. */
export interface CommentLine {
  /** Zero-based. */
  readonly page: number;
  /** What kind of mark carries it, in the contract's closed union — `note`, `highlight`, `other`. */
  readonly kind: string;
  readonly contents: string;
  readonly reply: boolean;
}

/**
 * The comments window: each page's annotations with words in them, one per line, read through
 * {@link readAskWindow} so the bound, the markers and the cut are the ones every other scope has.
 * A mark with no words is left out — there is nothing in it to summarise.
 *
 * @param listCut whether the annotation list itself stopped at its bound, which the answer must
 *   say as surely as a window that filled
 */
export async function commentsWindow(
  lines: readonly CommentLine[],
  pageCount: number,
  listCut: boolean,
  bound: number = MAX_ASK_CONTEXT,
): Promise<AskWindow> {
  const byPage = new Map<number, string[]>();
  for (const line of lines) {
    const words = line.contents.trim();
    if (words === '') continue;
    const text = `(${line.reply ? `reply, ${line.kind}` : line.kind}) ${words}`;
    byPage.set(line.page, [...(byPage.get(line.page) ?? []), text]);
  }
  const pages = [...byPage.keys()].sort((a, b) => a - b);
  const window = await readAskWindow(pages, pageCount, (page) => Promise.resolve((byPage.get(page) ?? []).join('\n')), bound);
  // A comment counts as sent when its whole line is in the window; one the cut went through is not.
  const lineStarts = window.text.split('\n');
  const comments = [...byPage.values()].flat().filter((line) => lineStarts.includes(line)).length;
  return { text: window.text, sent: { ...window.sent, truncated: window.sent.truncated || listCut, comments } };
}

/**
 * The instruction a window travels in.
 *
 * It names the page frame the markers use and asks for citations in the one form
 * `citationsIn` reads — so the answer's links go to the pages the text came from. It says
 * when the window stopped early, because a model told nothing will summarise twelve pages of
 * forty as though they were all of it.
 */
export function askInstruction(window: AskWindow, scope: AskAbout['scope']): string {
  const reach = scope === 'comments' ? commentsCoverage(window.sent) : coverage(window.sent, 'It');
  return (
    `${WHAT[scope]} ${reach} Each page begins with a marker such as ${askPageMarker(2)}. ` +
    `When you rely on a page, cite it as ${askCitation(2)}. ${NOT_IN_TEXT}` +
    `\n\n${window.text}`
  );
}

/**
 * The instruction for two documents side by side (ADR-0089): each window under its side's name,
 * with markers and citations that say which document a page is in — `[p. 3]` from a paired answer
 * would name two pages.
 */
export function askPairInstruction(left: AskWindow, right: AskWindow, scope: 'page' | 'document'): string {
  return (
    `${PAIR_WHAT[scope]} The Left document is the one on the left of the screen and the Right document the one ` +
    `on the right. ${coverage(left.sent, 'The Left text')} ${coverage(right.sent, 'The Right text')} ` +
    `Each page begins with a marker naming its side, such as ${askPageMarker(2, 'left')} or ${askPageMarker(2, 'right')}. ` +
    `When you rely on a page, cite it with its side, as ${askCitation(2, 'left')} or ${askCitation(2, 'right')}. ${NOT_IN_TEXT}` +
    `\n\n${left.text}\n${right.text}`
  );
}

const PAIR_WHAT: Readonly<Record<'page' | 'document', string>> = {
  page: 'Below is text from the page on screen in each of two PDF documents the person has open side by side.',
  document: 'Below is text from each of two PDF documents the person has open side by side.',
};

const NOT_IN_TEXT = 'If the answer is not in the text, say so rather than guessing.';

/**
 * The comments window's reach. Its pages are the pages that CARRY a comment, so the page sentence
 * every other scope uses — *it is from page 1 of 3* — told the model it had seen one page of three,
 * and a live run's answer asked for pages 2 and 3 when there was nothing on them to send.
 */
function commentsCoverage(sent: AskSent): string {
  const pages = `The document has ${String(sent.pageCount)} ${sent.pageCount === 1 ? 'page' : 'pages'}`;
  const all =
    `${pages}, and these are all ${String(sent.comments ?? 0)} of its comments with words in them; ` +
    'a page with no comments is not listed, so do not ask for other pages.';
  return sent.truncated
    ? `${pages}. These are the first ${String(sent.comments ?? 0)} of its comments; the list stops before the end, so say that the summary may be incomplete.`
    : all;
}

/** One window's reach as a sentence, and whether it stopped early. */
function coverage(sent: AskSent, subject: string): string {
  const { firstPage, lastPage, pageCount, truncated } = sent;
  const covered =
    firstPage === null || lastPage === null
      ? `${subject} has no text to show.`
      : firstPage === lastPage
        ? `${subject} is from page ${String(firstPage + 1)} of ${String(pageCount)}.`
        : `${subject} covers pages ${String(firstPage + 1)} to ${String(lastPage + 1)} of ${String(pageCount)}.`;
  return truncated
    ? `${covered} It stops before the end of what was asked about; say so if the answer may lie beyond it.`
    : covered;
}
