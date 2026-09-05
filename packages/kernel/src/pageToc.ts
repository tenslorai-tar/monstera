import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import type { CommandOfKind, OutlineEntry } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { Apply, ByteImage, Invert } from './engineSeam.js';

/**
 * A table of contents composed from the document's own outline.
 *
 * ## The entries are HANDED IN, and that is ADR-0040's extension existing
 *
 * `docs/ARCHITECTURE.md:381` puts *"new document generation
 * (markdown/CSV/TOC/image-to-PDF)"* on `@cantoo/pdf-lib` — **TOC** is the item
 * this command is; the row above it
 * puts *"Metadata, outline/bookmarks"* on MuPDF, and `destinations.ts`'
 * `readDestinations` is the module that answers *what are this document's
 * bookmarks*. A byte-image `apply` is `(image, command)` with **no session**,
 * so a TOC written here would have to walk `/Outlines` itself — a second
 * opinion about a question one module already owns (B3a), agreeing with it on
 * every ordinary outline and differing on the ones that matter: a cycle, a
 * destination resolved through the name tree, an entry with no reachable page.
 *
 * So the command declares `reads: 'outline'` and the bus resolves the entries
 * inside the document's lane, immediately before this runs. This module never
 * asks what the outline is; it is told.
 *
 * ## THE GENERATED PAGES MOVE THE PAGES THEY POINT AT
 *
 * This is the whole arithmetic of the feature and the one thing a naive
 * implementation gets wrong. The entries arrive numbered against the document
 * **as it stands**, and inserting the table at the front pushes every page down
 * by however many pages the table takes. A TOC that printed the numbers it was
 * handed would therefore be wrong by exactly its own length for every entry
 * after the insertion point — silently, and looking entirely correct.
 *
 * {@link tocPageCount} is computed **before** any number is drawn, which is
 * what makes the offset available. It can be, because the count depends only on
 * how many entries there are and not on what they say: one row per entry, a
 * fixed row height, so the page count is settled by arithmetic rather than by
 * laying the text out and seeing where it lands.
 *
 * ## Standard-14 Helvetica, and what that costs
 *
 * `pageStamp.ts`' font, for its reason: a standard-14 face is named rather than
 * embedded, so there is no font program whose bytes could differ between runs
 * and no binary in this repository (B10).
 *
 * What it costs is the 256 glyphs WinAnsi has. Measured 2026-09-05 against
 * `@cantoo/pdf-lib` in this tree: a title outside that set — CJK, emoji — does
 * **not** throw and does not fail the save; it draws through whatever WinAnsi
 * byte the character maps to, so the row is present, the page number is right,
 * and the title is not legible. That is a real limit and it is the row's, with
 * the trigger written there: the day this build embeds a font, this reads the
 * same and renders correctly.
 *
 * The alternative — refusing a document whose outline is not Latin — was
 * rejected. It would turn a cosmetic limit into a document this build cannot
 * process at all, and it would refuse on the basis of a check this file would
 * have to invent about a question the font owns.
 */

/**
 * The page's inset, in points.
 *
 * Not a design token, and `pageBackground.ts` states the rule this follows:
 * §10.2 is about components, and this is geometry written into a document
 * another application will open.
 */
const MARGIN_POINTS = 56;

/** The type size every row is set at. */
const FONT_SIZE = 11;

/**
 * The baseline-to-baseline distance.
 *
 * Larger than the type size by about half again, which is what a list of
 * headings needs to be readable — a table of contents is scanned rather than
 * read, and rows set solid are the ones a reader loses their place in.
 */
const LINE_HEIGHT = 16;

/** How far one level of nesting indents. */
const DEPTH_INDENT = 14;

/** The gap kept clear between the longest title and the page number. */
const NUMBER_GUTTER = 12;

/**
 * The page size a document with none is given.
 *
 * US Letter, and it is reachable only for a document that has no pages at all —
 * every other case takes its size from a page this document actually has, which
 * is what stops a table of contents arriving in a shape none of its neighbours
 * are. A zero-page PDF is legal and rare, and giving it a stated default is
 * more honest than a refusal that names no rule.
 */
const FALLBACK_SIZE = { width: 612, height: 792 } as const;

/** What one row of the table says, after the shift has been applied. */
interface TocRow {
  readonly title: string;
  readonly depth: number;
  /** The number to print, one-based — or `null` when the entry resolves to no page. */
  readonly shown: number | null;
}

/**
 * How many pages the table takes.
 *
 * Exported because the proof asserts the shift, and a proof computing this for
 * itself would be a second implementation of the arithmetic under test — it
 * would then agree with a broken one (B3a, and item 4's rule about mutating
 * towards disagreement).
 *
 * **At least one**, so a table with fewer rows than fit still occupies a page.
 * Zero would make the shift zero and produce a document that gained nothing
 * while claiming to.
 */
export function tocPageCount(entries: number, rowsPerPage: number): number {
  if (rowsPerPage < 1) return 1;
  return Math.max(1, Math.ceil(entries / rowsPerPage));
}

/**
 * How many rows fit on a page of this height.
 *
 * **At least one**, and the clamp is not defensive: a page can be shorter than
 * one row's margins allow — PDF permits a 3×3 point page — and a floor of zero
 * would divide the entry count by nothing and give a table of infinite length.
 */
export function rowsPerPage(height: number): number {
  return Math.max(1, Math.floor((height - 2 * MARGIN_POINTS) / LINE_HEIGHT));
}

/**
 * Where an original page index lands once the table is inserted.
 *
 * Exported for the proof, and separate from the drawing for the reason the
 * module note gives: this is the arithmetic the feature is about, and a
 * function is something a case can name.
 *
 * @param page the entry's index against the document as it stands, zero-based
 * @param at the index the first generated page occupies afterwards
 * @param inserted how many pages the table takes
 * @returns the number to print, one-based
 */
export function shownPageNumber(page: number, at: number, inserted: number): number {
  return (page >= at ? page + inserted : page) + 1;
}

/**
 * Builds the table and inserts it.
 *
 * ## Empty is refused rather than drawn
 *
 * A document with no outline has no table of contents, and generating a blank
 * page for it is a control that appears to work. This throws, and the throw is
 * a **defect guard rather than the user-facing refusal**: the command is not
 * offered for a document with no bookmarks, which the renderer establishes by
 * asking `document.destinations` before dispatching. The narrow window this
 * closes is the one where the outline was emptied between that read and this
 * apply — a race the renderer cannot close, because only this side is in the
 * lane.
 *
 * ## `at` is clamped to the end, not refused
 *
 * `pageImage.ts`' clamp and its reason: `at` is in the destination frame, so
 * the one value past the end it can name is *after the last page*, which is a
 * real request rather than a mistake.
 */
export const applyGenerateToc: Apply<'pdf-lib', 'generateToc', 'none', 'outline'> = async (
  image: ByteImage,
  command: CommandOfKind<'generateToc'>,
  outline: readonly OutlineEntry[],
): Promise<ByteImage> => {
  if (outline.length === 0) {
    throw new Error(
      'generateToc was given an empty outline, so there is nothing to tabulate. The renderer ' +
        'reads document.destinations before offering this command, so reaching here means the ' +
        'outline was emptied between that read and this apply.',
    );
  }

  const document = await PDFDocument.load(image);
  const existing = document.getPages();
  const at = Math.min(command.at, existing.length);

  // THE SIZE OF A PAGE THIS DOCUMENT ALREADY HAS. The page at the insertion
  // point is the one the table will sit next to, and the last page is the
  // neighbour when the table is appended. Neither is a preference: a table of
  // contents in a shape none of its neighbours share is the artefact a reader
  // notices first.
  const neighbour = existing[at] ?? existing[existing.length - 1];
  const { width, height } = neighbour === undefined ? FALLBACK_SIZE : neighbour.getSize();

  const perPage = rowsPerPage(height);
  const inserted = tocPageCount(outline.length, perPage);

  // COMPUTED BEFORE ANYTHING IS DRAWN, which is what the module note is about:
  // the numbers are the post-insertion ones, so every row is written once and
  // no pass re-numbers what an earlier pass got wrong.
  const rows: readonly TocRow[] = outline.map((entry) => ({
    title: entry.title,
    depth: entry.depth,
    shown: entry.page === null ? null : shownPageNumber(entry.page, at, inserted),
  }));

  const font = await document.embedFont(StandardFonts.Helvetica);

  for (let sheet = 0; sheet < inserted; sheet += 1) {
    // INSERTED IN ORDER at successive indices, so the table reads front to back
    // wherever it was placed. Inserting each at `at` would build it backwards.
    const page = document.insertPage(at + sheet, [width, height]);
    let baseline = height - MARGIN_POINTS - FONT_SIZE;

    for (const row of rows.slice(sheet * perPage, (sheet + 1) * perPage)) {
      const indent = MARGIN_POINTS + row.depth * DEPTH_INDENT;
      const number = row.shown === null ? '' : String(row.shown);
      const numberWidth = number === '' ? 0 : font.widthOfTextAtSize(number, FONT_SIZE);
      // The width a title may take before it would run into the number. A
      // negative one is possible on a very narrow page and `fit` treats it as
      // room for nothing, which is why it is not clamped here.
      const room = width - MARGIN_POINTS - indent - numberWidth - NUMBER_GUTTER;

      page.drawText(fit(row.title, room, (text) => font.widthOfTextAtSize(text, FONT_SIZE)), {
        x: indent,
        y: baseline,
        size: FONT_SIZE,
        font,
      });

      if (number !== '') {
        // RIGHT-ALIGNED against the margin rather than set at a column, so a
        // three-digit number and a one-digit number end in the same place —
        // which is the only alignment a page-number column has.
        page.drawText(number, {
          x: width - MARGIN_POINTS - numberWidth,
          y: baseline,
          size: FONT_SIZE,
          font,
        });
      }

      baseline -= LINE_HEIGHT;
    }
  }

  return document.save();
};

/**
 * The longest prefix of `text` that fits in `room`, with an ellipsis when it
 * had to be cut.
 *
 * **Three periods and not `…`**, because the single character is outside
 * ASCII and this build sets the table in a standard-14 face — see the module
 * note on what WinAnsi does with a character it does not have. A truncation
 * marker that may not render is worse than no marker.
 *
 * Measured character by character rather than estimated: a proportional face
 * has no average width that holds for both `illi` and `WWWW`, and the failure
 * of an estimate is a title that overlaps its own page number.
 *
 * @param measure the width of a string at the row's size, injected so this is
 *   testable without a document
 */
export function fit(text: string, room: number, measure: (text: string) => number): string {
  if (measure(text) <= room) return text;

  const marker = '...';
  const markerWidth = measure(marker);
  let kept = '';

  for (const character of text) {
    if (measure(kept + character) + markerWidth > room) break;
    kept += character;
  }

  // NOT `kept + marker` UNCONDITIONALLY: on a page too narrow for even the
  // marker, appending it would put three periods over the page number, which is
  // the overlap this function exists to prevent. An empty row is the honest
  // rendering of *there is no room for this title*.
  return kept === '' && markerWidth > room ? '' : `${kept}${marker}`;
}

/**
 * Reports that prior state cannot be recorded, always.
 *
 * `pageImage.ts`' capture and its reason, with one more page than that command
 * adds: undoing this means removing however many pages the table took, and a
 * removed page's prior state is the page and everything it reaches.
 */
export const captureGenerateToc = (): Promise<CaptureResult<never>> =>
  Promise.resolve({
    captured: false,
    reason:
      'generating a table of contents has no recordable prior state: undoing it means removing ' +
      'the pages it added, and a removed page carries everything it reaches',
  });

/**
 * Unreachable, and it exists because the seam's shape requires it.
 *
 * `CommandPrior['generateToc']` is `never`, so no value of the parameter type
 * can be constructed and nothing can call this. Returning the image unchanged
 * is the only honest body — see `invertInsertImagePage`, which says why a throw
 * would claim a failure state that cannot occur.
 */
export const invertGenerateToc: Invert<'pdf-lib', 'generateToc'> = (
  image: ByteImage,
): Promise<ByteImage> => Promise.resolve(image);
