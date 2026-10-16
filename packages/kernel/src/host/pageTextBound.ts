// THE HOST'S ENTRY, never the root: the root builds the renderer's channel map at load, which no host serves.
import { ENGINE_ANSWER_FILE_MAX_BYTES } from '@monstera/contract/host';

import { ANSWER_ENVELOPE_ROOM } from './answerFit.js';

/**
 * One page's structured-text JSON cut to what one answer carries, and whether it was cut.
 *
 * ## Why the host cuts it
 *
 * `engine/page-text` answers through a file (ADR-0125), and a file answer over
 * {@link ENGINE_ANSWER_FILE_MAX_BYTES} is replaced by `answer-too-large`. The ceiling counts the answer as written —
 * the page's JSON as a string INSIDE the answer's JSON, where every quote and backslash is escaped — so a page whose own
 * JSON was well under 8 MiB was refused: measured 2026-10-14, textWalk's L6 dense page (39,201 runs) is 7,051,845 bytes
 * of MuPDF's JSON and over the ceiling once escaped, and the refusal reached the person as an error dialog. A denser page
 * is over it however it is carried, so the answer is bounded where it is made, and a page past the bound is answered
 * with the part of it that fits and says so, never refused.
 *
 * ## The cut keeps MuPDF's format
 *
 * Every array in the tree is cut at the same place in reading order: the elements are counted depth first, the way the
 * JSON lists them, and the first `kept` of them are kept with everything they hold up to that count. The result is the
 * same format with fewer blocks and lines, so `parsePageText` stays the one reader of it and no second shape exists; a
 * block whose lines run past the count keeps the ones before it. How many are kept is the largest count that fits,
 * found by halving, so the part answered is as much of the page as one answer can carry.
 */
export interface BoundedPageText {
  readonly json: string;
  readonly truncated: boolean;
}

/** Room for the rest of the answer around the page's JSON: the lists' room (`answerFit.ts`), one definition. */
const ENVELOPE_ROOM = ANSWER_ENVELOPE_ROOM;

/** How many bytes `json` takes once written as a string inside another JSON document. */
function writtenBytes(json: string): number {
  return Buffer.byteLength(JSON.stringify(json), 'utf8');
}

/** `value` with only the first `kept` array elements, counted depth first, and what they hold. */
function prefix(value: unknown, kept: number): unknown {
  let counted = 0;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      const out: unknown[] = [];
      for (const element of node) {
        if (counted >= kept) break;
        counted += 1;
        out.push(walk(element));
      }
      return out;
    }
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
    }
    return node;
  };
  return walk(value);
}

/** How many array elements `value` holds at every depth. */
function elementCount(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((total, element) => total + 1 + elementCount(element), 0);
  if (value !== null && typeof value === 'object') return Object.values(value).reduce<number>((total, child) => total + elementCount(child), 0);
  return 0;
}

/**
 * `json` as it is where it fits one answer, else the longest prefix of it that does.
 *
 * @param json MuPDF's structured-text JSON for one page
 * @param maxAnswerBytes the file-answer ceiling; {@link ENGINE_ANSWER_FILE_MAX_BYTES} in the product, smaller in a test
 */
export function boundPageText(json: string, maxAnswerBytes: number = ENGINE_ANSWER_FILE_MAX_BYTES): BoundedPageText {
  const budget = maxAnswerBytes - ENVELOPE_ROOM;
  if (writtenBytes(json) <= budget) return { json, truncated: false };
  const tree: unknown = JSON.parse(json);
  // THE LARGEST COUNT THAT FITS: none kept always fits (an empty block list), and the whole tree does not.
  let fits = 0;
  let over = elementCount(tree);
  while (over - fits > 1) {
    const middle = Math.floor((fits + over) / 2);
    if (writtenBytes(JSON.stringify(prefix(tree, middle))) <= budget) fits = middle;
    else over = middle;
  }
  return { json: JSON.stringify(prefix(tree, fits)), truncated: true };
}
