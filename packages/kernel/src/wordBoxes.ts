import { type WalkedWordLine, tokensOf } from '@monstera/shared';

import type { MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import type { Quad, Rect } from './mupdfRaw.js';
import { pageInDocument } from './pageScope.js';
import { WORD_BOX_READ_OPTIONS } from './textStructure.js';
import { ENGINE_WORD_BOXES_LINES_MAX, ENGINE_WORD_BOXES_MAX, ENGINE_WORD_LINE_MAX } from './host/engineChannels.js';

/**
 * Each word's box on a page, from the engine's characters
 * ([ADR-0137](../../../docs/DECISIONS/0137-a-words-box-is-the-engines-read-on-request.md)).
 *
 * The text layer carries line boxes only, because MuPDF's structured-text JSON prints lines and not characters; a
 * word's box guessed from its share of a line's characters is off by the difference between narrow and wide letters.
 * This walks the page's characters and boxes each token the shared segmenter cuts from each line. The walk cannot enter
 * the structure blocks the shared read's segmentation makes, so it reads without segmentation
 * ({@link WORD_BOX_READ_OPTIONS}) and answers each line's text and box with its tokens, for the consumer to pair with
 * the text layer's line by the shared rule (`pairWordBoxes`).
 */

export interface PageWordBoxes {
  readonly lines: readonly WalkedWordLine[];
  /** Whether a line's boxes were left out for the bound, so its tokens keep the estimate. */
  readonly truncated: boolean;
}

/** A line as the walk hands it: its box, and each character's text and quad, in the page's display space. */
export interface WalkedLine {
  readonly bbox: Rect;
  readonly characters: readonly { readonly text: string; readonly quad: Quad }[];
}

/** Hundredths of a point: finer than any mark is drawn, and a quarter the digits of a double. */
function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The token boxes of walked lines — the pure half, so its rule is tested without an engine.
 *
 * A token's box is the UNION of its characters' quads rather than a span along x, so a word on a turned page or in a
 * vertical line is boxed where it is printed.
 */
export function wordBoxesOf(lines: readonly WalkedLine[], max: number = ENGINE_WORD_BOXES_MAX): PageWordBoxes {
  let boxed = 0;
  let truncated = lines.length > ENGINE_WORD_BOXES_LINES_MAX;
  const answered = lines.slice(0, ENGINE_WORD_BOXES_LINES_MAX).map(({ bbox, characters }): WalkedWordLine => {
    // EACH WALKED CHARACTER IS ONE OR MORE CODE UNITS of the line's text, in order; a token's indices map back to them.
    // CUT WHERE THE TEXT LAYER CUTS ITS OWN, so a long line's cut text is the text layer's and its tokens are the same.
    const whole = characters.map((character) => character.text).join('');
    const text = whole.length > ENGINE_WORD_LINE_MAX ? whole.slice(0, ENGINE_WORD_LINE_MAX) : whole;
    const unitOwner: number[] = [];
    characters.forEach((character, at) => {
      unitOwner.push(...new Array<number>(character.text.length).fill(at));
    });
    const tokens = [...tokensOf(text)];
    const box = { x0: rounded(bbox[0]), y0: rounded(bbox[1]), x1: rounded(bbox[2]), y1: rounded(bbox[3]) };
    if (boxed + tokens.length > max) {
      truncated = true;
      return { text, box, boxes: [] };
    }
    boxed += tokens.length;
    const boxes: number[] = [];
    for (const token of tokens) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const first = unitOwner[token.index] ?? 0;
      const last = unitOwner[token.index + token.text.length - 1] ?? first;
      for (let at = first; at <= last; at += 1) {
        const quad = characters[at]?.quad;
        if (quad === undefined) continue;
        for (let corner = 0; corner < 8; corner += 2) {
          const x = quad[corner] ?? 0;
          const y = quad[corner + 1] ?? 0;
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      }
      boxes.push(rounded(x0), rounded(y0), rounded(x1), rounded(y1));
    }
    return { text, box, boxes };
  });
  return { lines: answered, truncated };
}

/**
 * Reads one page's word boxes from a live session. The page index is validated in full first, for `readPageText`'s
 * reason: an out-of-range page is a `RangeError`, never an empty page.
 */
export function readPageWordBoxes(session: MupdfSession, page: number): Promise<PageWordBoxes> {
  return withDocument(session, (document) => {
    pageInDocument(page, document.countPages());
    const structured = document.loadPage(page).toStructuredText(WORD_BOX_READ_OPTIONS);
    try {
      const lines: WalkedLine[] = [];
      let characters: { readonly text: string; readonly quad: Quad }[] = [];
      let bbox: Rect = [0, 0, 0, 0];
      structured.walk({
        beginLine: (box) => {
          characters = [];
          bbox = box;
        },
        onChar: (text, _origin, _font, _size, quad) => {
          characters.push({ text, quad });
        },
        endLine: () => {
          lines.push({ bbox, characters });
        },
      });
      return wordBoxesOf(lines);
    } finally {
      structured.destroy();
    }
  });
}
