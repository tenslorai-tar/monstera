import { lineText, paragraphsOfLines, replaceMatches } from '@monstera/shared';

import type { EditedBlock } from './commands.js';

/** A block as `document.textBlocks` answers it, as far as a replacement reads it. */
export interface ReplacedBlock {
  readonly lines: readonly { readonly runs: readonly { readonly index: number; readonly text: string }[]; readonly soft: boolean }[];
  /** The blocks below it in its column, by their place among the page's, and the room they may move down (ADR-0249). */
  readonly push: { readonly below: readonly number[]; readonly room: number };
}

/** A block's words as the editor shows them and the writer diffs them (ADR-0179): soft wraps are spaces. */
export function wordsOf(block: ReplacedBlock): string {
  return paragraphsOfLines(block.lines.map((line) => ({ text: lineText(line.runs), soft: line.soft })));
}

/**
 * The block entries one page's replacement sends to the block writer
 * ([ADR-0267](../../../docs/DECISIONS/0267-find-replace-and-spelling-write-through-the-block-writer.md) Decision 2):
 * every block whose words `matchesIn` finds something in, its words spliced by the one `replaceMatches`; then each
 * block below a changed one in its column that the replacement did not change, pushed by the first changed block above
 * it by what that block grew (ADR-0249). Empty where nothing on the page changes.
 *
 * `matchesIn` is the find bar's own compiled query, compiled with normalisation `none` so its offsets index the words.
 * A match that crosses two blocks is not reached, as a match crossing two of PDFium's objects was not.
 *
 * `only`, where given, limits the blocks replaced in to those places: a spelling replacement of one word names its
 * block, and then names the one occurrence by `occurrence`, its place among the block's matches in order.
 */
export function blocksReplaced(
  blocks: readonly ReplacedBlock[],
  matchesIn: (text: string) => readonly { readonly offset: number; readonly length: number }[],
  replacement: string,
  only?: { readonly block: number; readonly occurrence: number },
): EditedBlock[] {
  const changed = new Map<number, string>();
  blocks.forEach((block, at) => {
    if (only !== undefined && only.block !== at) return;
    const words = wordsOf(block);
    const matches = matchesIn(words);
    const chosen = only === undefined ? matches : matches.slice(only.occurrence, only.occurrence + 1);
    const next = replaceMatches(words, chosen, replacement);
    if (next !== null) changed.set(at, next);
  });
  const entries: EditedBlock[] = [];
  /** Each changed block's place in the edit, which a pushed block names as the one that moves it. */
  const placeOf = new Map<number, number>();
  for (const [at, text] of changed) {
    const block = blocks[at];
    if (block === undefined) continue;
    placeOf.set(at, entries.length);
    entries.push({ lines: block.lines.map((line) => line.runs.map((run) => run.index)), soft: block.lines.map((line) => line.soft), text });
  }
  const pushed = new Set<number>();
  for (const [at] of changed) {
    const block = blocks[at];
    const by = placeOf.get(at);
    // A BLOCK THAT CANNOT MOVE pushes nothing, as an edit by hand sends none where `main` measured no room.
    if (block === undefined || by === undefined || block.push.room <= 0) continue;
    for (const below of block.push.below) {
      // NOT A BLOCK THAT CHANGED, which is written rather than moved, and not one already pushed by a block above.
      if (changed.has(below) || pushed.has(below)) continue;
      const under = blocks[below];
      if (under === undefined) continue;
      pushed.add(below);
      entries.push({
        lines: under.lines.map((line) => line.runs.map((run) => run.index)),
        soft: under.lines.map((line) => line.soft),
        text: wordsOf(under),
        push: { by, room: block.push.room },
      });
    }
  }
  return entries;
}
