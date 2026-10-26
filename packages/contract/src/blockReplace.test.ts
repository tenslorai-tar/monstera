import { compileQuery, replaceMatches } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { type ReplacedBlock, blocksReplaced } from './blockReplace.js';

/** A block of one line per text, each line one run numbered from `first`. */
function block(texts: readonly string[], first: number): ReplacedBlock {
  return { lines: texts.map((text, at) => ({ runs: [{ index: first + at, text }], soft: false })) };
}

const matcher = (query: string, options: { wholeWord?: boolean; caseSensitive?: boolean } = {}) => {
  const compiled = compileQuery(query, { ...options, normalise: 'none' });
  if (!compiled.ok) throw new Error(compiled.error);
  return compiled.value.matchesIn;
};

describe('replaceMatches, the one splice (ADR-0267)', () => {
  it('replaces every match, from the end, and answers null where nothing changed', () => {
    expect(replaceMatches('a cat and a cat', matcher('cat')('a cat and a cat'), 'dog')).toBe('a dog and a dog');
    expect(replaceMatches('no match', matcher('cat')('no match'), 'dog')).toBeNull();
    expect(replaceMatches('cat', matcher('cat')('cat'), 'cat')).toBeNull();
  });

  it('takes OVERLAPPING matches left to right, skipping one that starts inside one already taken', () => {
    // "aa" IS FOUND TWICE IN "aaa", at 0 and at 1. Splicing both from the end wrote "b" into the "b" the first made.
    expect(matcher('aa')('aaa')).toHaveLength(2);
    expect(replaceMatches('aaa', matcher('aa')('aaa'), 'b')).toBe('ba');
  });
});

describe('blocksReplaced, a page’s replacement as block edits (ADR-0267 Decision 2)', () => {
  const page = [block(['the teh', 'teh'], 0), block(['a line below'], 2), block(['teh too'], 3)];

  it('writes every block holding the word and NO OTHER: an unchanged block below a changed one is not in the edit', () => {
    const edits = blocksReplaced(page, matcher('teh', { wholeWord: true }), 'the');
    // THE BLOCK BELOW THAT DID NOT CHANGE stays out of the edit: a block that grows overlaps it (ADR-0271 section 11.1).
    expect(edits).toStrictEqual([
      { lines: [[0], [1]], soft: [false, false], text: 'the the\nthe' },
      { lines: [[3]], soft: [false], text: 'the too' },
    ]);
  });

  it('ONE occurrence of one block, for a spelling replacement of one word', () => {
    const edits = blocksReplaced(page, matcher('teh', { wholeWord: true }), 'the', { block: 0, occurrence: 1 });
    // THE SECOND `teh` of the first block, on its second line; the first and the third block's are left.
    expect(edits[0]).toStrictEqual({ lines: [[0], [1]], soft: [false, false], text: 'the teh\nthe' });
    expect(edits.every((each) => !each.text.startsWith('the too'))).toBe(true);
  });

  it('answers nothing for a page with no match, so no command is sent', () => {
    expect(blocksReplaced(page, matcher('absent'), 'x')).toStrictEqual([]);
  });
});
