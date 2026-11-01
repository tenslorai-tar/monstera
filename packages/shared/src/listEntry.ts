/**
 * A LIST ENTRY'S MARKER, the one rule the grouping, the editor and the writer read (the owner's C5, 2026-11-01): a line
 * that begins with a bullet, or with a dash, a star or a number or letter and its stop, then a space. The grouping ends
 * a paragraph before a line that begins one (`textLines.ts`' soft ends); the editor and the writer hang an item's wrapped
 * lines where its words begin after the marker ({@link listEntryOf}), so a one-line item that wraps sets its second line
 * under its text and not under its bullet.
 *
 * A bullet need not be followed by a space, but must be followed by something: a line that is a bullet alone is the
 * marker of an item whose words are another run, and has no words of its own to begin.
 */
export const LIST_ENTRY = /^(?:[•◦▪▫‣⁃●○■□](?!\s*$)|(?:[–—*-]|\(?(?:\d{1,3}|[a-z])[.)])\s)/u;

/** Where a list entry's own words begin in a line's text. */
export interface ListEntry {
  /** The offset in the text where the item's words begin: after the leading spaces, the marker and the spaces after it. */
  readonly wordsAt: number;
  /**
   * How many of the marker's UTF-16 units are inked (not white space): what a writer counts its glyphs' text by, in the
   * same unit, so a marker's glyphs are walked past whatever spaces the page drew or PDFium generated beside them.
   */
  readonly markerInk: number;
}

/** `text`'s list entry, or `undefined` where it begins none ({@link LIST_ENTRY}), or where nothing follows its marker. */
export function listEntryOf(text: string): ListEntry | undefined {
  const leading = text.length - text.trimStart().length;
  const match = LIST_ENTRY.exec(text.slice(leading));
  if (match === null) return undefined;
  const marker = match[0];
  const after = text.slice(leading + marker.length);
  const wordsAt = leading + marker.length + (after.length - after.trimStart().length);
  if (wordsAt >= text.length) return undefined;
  return { wordsAt, markerInk: marker.replace(/\s/gu, '').length };
}
