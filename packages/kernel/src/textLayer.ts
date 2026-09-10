import { type PageKind, pageKindOf } from './pageKind.js';
import type { PageText, TextLine } from './textStructure.js';
import { linesOf } from './textStructure.js';

/**
 * One page's text as a selectable layer: the lines, bounded, in reading order.
 *
 * ## Why this is separate from the substrate and from the search
 *
 * `textStructure.ts` owns MuPDF's format and answers with whatever the page
 * holds. `textSearch.ts` answers with the matches for a query. Neither is what a
 * text layer needs, which is *every line, in order, small enough to cross a
 * channel* — and the bounding is the whole of the difference.
 *
 * It is a pure function over a parsed page so it needs no engine and no session:
 * `documentCommands.ts` already holds a `PageText` inside the document's lane
 * for `searchPage`, and this runs on the same value.
 *
 * ## The boxes are DISPLAY space and stay that way
 *
 * They are not converted here. `PageGeometry` deliberately carries rotations and
 * **not** the crop box, because a page's box is `/MediaBox`, `/CropBox` and
 * their intersection rules, which PDF.js owns (B3a, §3). Converting here would
 * mean deriving a crop box in the kernel — a second opinion about the question
 * that rule assigns elsewhere — so the renderer converts, with the box it
 * already holds from the page it drew.
 *
 * See `textStructure.ts`'s `DisplayedRect`: measured at all four turns, these
 * are display space with `/Rotate` already applied, and the conversion is
 * `toPdf`, not `fromFitz`.
 */
export interface TextLayerLine {
  /** The line's text, in reading order. */
  readonly text: string;
  /** Its box in the page's display space at scale 1. */
  readonly box: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
}

/** One page's selectable text. */
export interface TextLayer {
  readonly lines: readonly TextLayerLine[];
  /**
   * Whether anything was left out — **either bound**, not only the line count.
   *
   * One flag for two limits, deliberately. A caller's question is *is this the
   * whole page*, and answering it separately for "there were more lines" and
   * "one line was longer than the cap" would let a consumer handle the first and
   * silently ship the second. A clipped line that reports nothing is the
   * export-escaping defect one layer over: the copy succeeds and is missing
   * characters nobody can see.
   */
  readonly truncated: boolean;
  /**
   * What the page is made of, so an empty layer can say why it is empty.
   *
   * It rides on this answer rather than on a channel of its own because the two
   * questions have one reading: *what text is on this page* and *why is there
   * none* are the same walk of the same structured text, and a second channel
   * would parse the page twice to disagree with itself on a version boundary.
   *
   * See {@link pageKindOf}, which is the rule and the only place it is written.
   */
  readonly kind: PageKind;
}

/**
 * Flattens a parsed page into a bounded layer.
 *
 * ## Both bounds are the caller's, and neither is optional
 *
 * A page's line count and a line's length are both chosen by whoever made the
 * document, so an unbounded answer is a payload a hostile file sets — L11's
 * shape, and the one `document.searchPage` already refuses by taking a `limit`.
 * Defaulting them here would put the decision in a module that cannot see the
 * channel it crosses.
 *
 * @param page the parsed page, in MuPDF's reading order
 * @param limit the most lines to return
 * @param maxLineLength the most characters to return per line
 */
export function textLayerOf(
  page: PageText,
  limit: number,
  maxLineLength: number,
): TextLayer {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError(
      `A text layer's line limit must be a positive integer; got ${String(limit)}. A limit of ` +
        'zero would answer with an empty layer, which is what a page with no text looks like.',
    );
  }
  if (!Number.isInteger(maxLineLength) || maxLineLength <= 0) {
    throw new RangeError(
      `A text layer's line length cap must be a positive integer; got ${String(maxLineLength)}.`,
    );
  }

  const all = linesOf(page);
  const kept = all.slice(0, limit);
  // DERIVED FROM THE LINES, not accumulated while mapping them. A flag mutated
  // inside a callback is invisible to TypeScript's control-flow analysis, which
  // narrows it to `false` at the return and makes the `||` below read as dead
  // code — the lint rule says so, and it is right that the code cannot be
  // checked rather than that it is wrong. This states the same fact where a
  // reader and the compiler can both see it.
  const clipped = kept.some((line) => line.text.length > maxLineLength);

  const lines = kept.map((line: TextLine): TextLayerLine => {
    const text = line.text.length > maxLineLength ? line.text.slice(0, maxLineLength) : line.text;
    return {
      text,
      box: {
        x0: line.box.topLeft.x,
        y0: line.box.topLeft.y,
        x1: line.box.bottomRight.x,
        y1: line.box.bottomRight.y,
      },
    };
  });

  // THE KIND IS THE WHOLE PAGE'S, never the bounded slice's. A layer clipped at
  // its line limit still came from a page with text on it, and deriving the
  // attribution from `kept` would answer `'empty'` for a `limit` of one on a
  // page whose first line is blank.
  return { lines, truncated: clipped || all.length > limit, kind: pageKindOf(page) };
}
