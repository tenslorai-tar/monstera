/**
 * A name a document gives something, shortened to fit the bound it crosses under.
 *
 * ## One long name made the whole list unreadable
 *
 * A layer's `/Name` and an outline entry's title are a stranger's strings, so the wire bounds them (256 and 512
 * UTF-16 units). The readers handed them over whole, and the answer's schema then refused the ANSWER: one CAD layer
 * or one heading past the bound, and the panel said *"could not be read"* for every other entry the document has
 * (JOURNAL, *No document-size refusals*, table A row 6). A person is never refused because of their document.
 *
 * So a name past the bound is shown shortened, ending in an ellipsis, which is the mark a person reads as *there is
 * more*. Only what is SHOWN is shortened: the document's own name is untouched, and every command addresses the item
 * by its index, never by this text.
 *
 * ## A surrogate pair is never split
 *
 * The bound counts UTF-16 units, as `z.string().max` does. Cutting between the two halves of a pair would leave a
 * lone surrogate, which renders as a replacement character, so a cut that would land there takes one unit less.
 *
 * @param name the name as the document gives it
 * @param max the most UTF-16 units the wire admits
 * @returns `name` when it fits; otherwise its start and an ellipsis, within `max`
 */
export function shownName(name: string, max: number): string {
  if (name.length <= max) return name;
  let end = max - ELLIPSIS.length;
  const last = name.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return name.slice(0, end) + ELLIPSIS;
}

const ELLIPSIS = '…';
