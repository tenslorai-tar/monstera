import { type ContractClient, blocksReplaced, streamsOf, wordsOf } from '@monstera/contract';
import { type DocId, type TextMatchOptions, compileQuery, lineText, paragraphsOfLines } from '@monstera/shared';

import type { CommandProblem } from '../dialogs/problemMessages.js';
import { readWholeList } from '../readWholeList.js';
import {
  type DocumentCommandDeps,
  type PageBlocksRead,
  type UndoStep,
  commitReplacement,
} from './documentCommands.js';

/**
 * Page text replaced through the block writer
 * ([ADR-0267](../../../../docs/DECISIONS/0267-find-replace-and-spelling-write-through-the-block-writer.md)): the find
 * bar's Replace all and the spelling review's Replace and Replace all, never PDFium's whole-page rewrite.
 */

/** How a replacement ended: pages written, a pattern that does not compile, or a refusal with the pages written before it. */
export type ReplaceOutcome =
  | { readonly kind: 'replaced'; readonly pages: number }
  | { readonly kind: 'bad-pattern' }
  | { readonly kind: 'held'; readonly pages: number }
  | { readonly kind: 'refused'; readonly pages: number; readonly problem: CommandProblem };

/** A page's blocks read whole at one version (ADR-0130), as Edit text reads them. */
export async function readPageBlocks(client: ContractClient, docId: DocId, page: number) {
  const answer = await readWholeList(
    (from) => client['document.textBlocks']({ docId, page, from }),
    (part) => part.blocks,
  );
  if (!answer.ok) return answer;
  const { version, items, last } = answer.value;
  const read: PageBlocksRead = { version, blocks: items, rewrite: last.rewrite, ...(last.unpacked === true ? { unpacked: true as const } : {}) };
  return { ok: true as const, value: read };
}

/**
 * Every match of `find` on `pages` replaced by `replace`, a page at a time, the pages one undo step (Decision 1). The
 * matcher is the find bar's own, compiled with normalisation `none` so its offsets index a block's words.
 *
 * `pages` absent: every page of `pageCount` where the find bar's page search finds the query, so a page with no match
 * costs no read of its blocks.
 */
export async function replaceInDocument(
  deps: DocumentCommandDeps,
  docId: DocId,
  find: string,
  replace: string,
  options: Pick<TextMatchOptions, 'caseSensitive' | 'wholeWord' | 'regex'>,
  pages: readonly number[] | { readonly pageCount: number },
): Promise<ReplaceOutcome> {
  const compiled = compileQuery(find, { ...options, normalise: 'none' });
  if (!compiled.ok) return { kind: 'bad-pattern' };
  const step: UndoStep = { version: undefined };
  let written = 0;
  const searched = 'pageCount' in pages;
  const visit = 'pageCount' in pages ? Array.from({ length: pages.pageCount }, (_, at) => at) : pages;
  for (const page of visit) {
    // THE FIND BAR'S OWN SEARCH says whether the page holds the query at all, before its blocks are read.
    if (searched) {
      const found = await deps.client['document.searchPage']({ docId, page, query: find, limit: 1, ...options });
      if (found.ok && found.value.matches.length === 0) continue;
    }
    const read = await readPageBlocks(deps.client, docId, page);
    if (!read.ok) return { kind: 'refused', pages: written, problem: read.error };
    // ONE COMMAND PER STREAM (ADR-0269): the page's own blocks, then each form's, all in the same undo step.
    let changed = false;
    for (const stream of streamsOf(read.value.blocks)) {
      const entries = blocksReplaced(stream.blocks, compiled.value.matchesIn, replace);
      if (entries.length === 0) continue;
      const outcome = await commitReplacement(deps, docId, page, read.value, stream.form, entries, step);
      if (outcome === 'written') changed = true;
      else if (outcome === 'held') return { kind: 'held', pages: written };
      else if (outcome !== 'unchanged') return { kind: 'refused', pages: written, problem: outcome.refused };
    }
    if (changed) written += 1;
  }
  return { kind: 'replaced', pages: written };
}

/**
 * One occurrence of `word` replaced, the one at `at` on `page` in PDF user space (Decision 3): the block and line whose
 * boxes hold the point, and among the line's occurrences of the word the one nearest the point along the line. Answers
 * `not-found` where no block there holds the word.
 */
export async function replaceWordAt(
  deps: DocumentCommandDeps,
  docId: DocId,
  page: number,
  word: string,
  replacement: string,
  at: { readonly x: number; readonly y: number },
): Promise<ReplaceOutcome | { readonly kind: 'not-found' }> {
  const compiled = compileQuery(word, { caseSensitive: true, wholeWord: true, normalise: 'none' });
  if (!compiled.ok) return { kind: 'bad-pattern' };
  const read = await readPageBlocks(deps.client, docId, page);
  if (!read.ok) return { kind: 'refused', pages: 0, problem: read.error };
  const holds = (box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }) =>
    at.x >= box.x0 && at.x <= box.x1 && at.y >= box.y0 && at.y <= box.y1;
  const blockAt = read.value.blocks.findIndex((block) => holds(block.box));
  const block = read.value.blocks[blockAt];
  if (block === undefined) return { kind: 'not-found' };
  const lineAt = block.lines.findIndex((line) => holds(line.box));
  const line = block.lines[lineAt];
  if (line === undefined) return { kind: 'not-found' };
  // WHERE THE LINE'S WORDS START among the block's, by the one join the words are made with: everything up to and
  // including this line, less this line's own text.
  const own = lineText(line.runs);
  const start = paragraphsOfLines(block.lines.slice(0, lineAt + 1).map((each) => ({ text: lineText(each.runs), soft: each.soft }))).length - own.length;
  // THE POINT ALONG THE LINE, as a place among its characters.
  const along = start + ((at.x - line.box.x0) / Math.max(1, line.box.x1 - line.box.x0)) * own.length;
  const matches = compiled.value.matchesIn(wordsOf(block));
  let nearest = -1;
  let distance = Number.POSITIVE_INFINITY;
  matches.forEach((match, index) => {
    if (match.offset < start || match.offset >= start + own.length) return;
    const away = Math.abs(match.offset + match.length / 2 - along);
    if (away < distance) {
      distance = away;
      nearest = index;
    }
  });
  if (nearest === -1) return { kind: 'not-found' };
  // THE BLOCK'S OWN STREAM (ADR-0269), and the block's place among that stream's blocks.
  const stream = streamsOf(read.value.blocks).find((each) => each.blocks.includes(block));
  if (stream === undefined) return { kind: 'not-found' };
  const entries = blocksReplaced(stream.blocks, compiled.value.matchesIn, replacement, { block: stream.blocks.indexOf(block), occurrence: nearest });
  if (entries.length === 0) return { kind: 'not-found' };
  const outcome = await commitReplacement(deps, docId, page, read.value, stream.form, entries, { version: undefined });
  if (outcome === 'written') return { kind: 'replaced', pages: 1 };
  if (outcome === 'held') return { kind: 'held', pages: 0 };
  if (outcome === 'unchanged') return { kind: 'replaced', pages: 0 };
  return { kind: 'refused', pages: 0, problem: outcome.refused };
}
