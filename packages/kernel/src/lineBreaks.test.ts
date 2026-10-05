import { describe, expect, it } from 'vitest';

import { breakOpportunities, graphemeBoundaries } from './lineBreaks.js';

/** `text` cut at every opportunity, which a case can read. */
function pieces(text: string, at: readonly number[] = breakOpportunities(text)): string[] {
  const out: string[] = [];
  let from = 0;
  for (const index of [...at, text.length]) {
    out.push(text.slice(from, index));
    from = index;
  }
  return out;
}

describe('breakOpportunities', () => {
  it('breaks after spaces, and never inside a spaced word or before its punctuation', () => {
    expect(pieces('Hello, world! don’t stop.')).toStrictEqual(['Hello, ', 'world! ', 'don’t ', 'stop.']);
  });

  it('breaks THAI between its words, which carry no spaces', () => {
    const thai = 'ภาษาไทยไม่มีการเว้นวรรค';
    const cut = pieces(thai);
    expect(cut.length).toBeGreaterThan(3);
    expect(cut.join('')).toBe(thai);
    // CONTROL: every piece is a whole word, so no piece begins with a vowel sign or tone mark cut from its consonant.
    for (const piece of cut) expect(piece).not.toMatch(/^\p{M}/u);
  });

  it('breaks Chinese and Japanese between words, never before a closing mark nor after an opening one', () => {
    const chinese = pieces('中文没有空格。（括号）完');
    expect(chinese.length).toBeGreaterThan(3);
    for (const piece of chinese.slice(1)) expect(piece).not.toMatch(/^[。）]/u);
    for (const piece of chinese.slice(0, -1)) expect(piece).not.toMatch(/（$/u);
    expect(pieces('日本語の文章です。').length).toBeGreaterThan(2);
  });

  it('breaks between an unspaced word and a spaced one only where either side asks it', () => {
    // CONTROL: two Latin words joined by nothing are one word; the same join beside a Han character is a break.
    expect(pieces('abcdef')).toStrictEqual(['abcdef']);
    expect(pieces('abc中')).toStrictEqual(['abc', '中']);
  });
});

describe('graphemeBoundaries', () => {
  it('keeps a combining mark and a Thai vowel sign on the letter they belong to', () => {
    const accented = 'e\u{301}a';
    expect(pieces(accented, graphemeBoundaries(accented))).toStrictEqual(['e\u{301}', 'a']);
    const thai = 'กี่';
    expect(pieces(thai, graphemeBoundaries(thai))).toStrictEqual(['กี่']);
    // CONTROL: by code points the same text is three pieces, which is what a cut by characters would do.
    expect(Array.from(thai)).toHaveLength(3);
  });
});
