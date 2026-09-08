import { type ContractClient, channels, createClient } from '@monstera/contract';
import { err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { type Misspelling, buildChecker, collectMisspellings } from './checker.js';

/** A dictionary small enough for a case to state in full. */
const AFFIX = 'SET UTF-8\n';
const WORDS = '4\ndocument\npage\nspelling\nannotation\n';

/**
 * A client answering `spelling.dictionary` from a fixture, or refusing.
 *
 * The bytes are encoded here rather than taken from `dictionary-en`, so every
 * case below can name the whole vocabulary — a case asserting that `qqqzzz` is
 * wrong against 49,568 real words is asserting that one word is missing from a
 * list nobody read.
 */
function clientWith(answer: 'dictionary' | 'unknown' | 'refused'): ContractClient {
  return createClient(channels, (id) => {
    if (id !== 'spelling.dictionary') throw new Error(`unexpected channel ${id}`);
    // `internal` WITH AN INCIDENT ID, which is the only refusal this channel
    // can make: it declares no failure codes, so a handler that threw is the
    // whole of its error surface.
    if (answer === 'refused') {
      return Promise.resolve(err({ code: 'internal', incident: 'incident-1' }));
    }
    if (answer === 'unknown') return Promise.resolve(ok({ kind: 'unknown-dictionary' }));
    return Promise.resolve(
      ok({
        kind: 'dictionary',
        language: 'en',
        affix: new TextEncoder().encode(AFFIX),
        words: new TextEncoder().encode(WORDS),
      }),
    );
  });
}

describe('building a checker', () => {
  it('SEPARATES a word in the dictionary from one that is not', async () => {
    const checker = await buildChecker(clientWith('dictionary'), 'en', []);

    expect(checker).not.toBeNull();
    // BOTH DIRECTIONS IN ONE CASE, deliberately. A checker that agreed with
    // everything passes any assertion about a correct word, and one that
    // refused everything passes any assertion about a wrong one — so neither
    // half alone says the thing under test works. This is the control the
    // scratch-tree probe carried on 2026-09-08 and it belongs here too.
    expect(checker?.correct('document')).toBe(true);
    expect(checker?.correct('documnet')).toBe(false);
  });

  it('accepts a word from the personal dictionary that the dictionary refuses', async () => {
    const plain = await buildChecker(clientWith('dictionary'), 'en', []);
    const withPersonal = await buildChecker(clientWith('dictionary'), 'en', ['Monstera']);

    // THE SAME WORD THROUGH BOTH, which is what makes this about the personal
    // list rather than about the dictionary happening to hold it. Asserting
    // only the second would pass against a build that ignores the argument and
    // ships a dictionary containing the word.
    expect(plain?.correct('Monstera')).toBe(false);
    expect(withPersonal?.correct('Monstera')).toBe(true);
  });

  it('matches a personal word whatever case it was added in', async () => {
    const checker = await buildChecker(clientWith('dictionary'), 'en', ['Monstera']);

    expect(checker?.correct('monstera')).toBe(true);
    expect(checker?.correct('MONSTERA')).toBe(true);
  });

  it('answers null when this build ships no such dictionary', async () => {
    expect(await buildChecker(clientWith('unknown'), 'en', [])).toBeNull();
  });

  it('answers null when the channel refuses', async () => {
    expect(await buildChecker(clientWith('refused'), 'en', [])).toBeNull();
  });
});

describe('collecting misspellings', () => {
  /** A checker with a stated vocabulary, so a case need not build one. */
  const checker = {
    correct: (word: string) => ['document', 'page', 'the', 'on'].includes(word.toLowerCase()),
    suggest: (word: string) => [`${word}!`],
  };

  function collect(lines: readonly string[], page = 0): Misspelling[] {
    const found = new Map<string, Misspelling>();
    collectMisspellings(checker, lines, page, found);
    return [...found.values()];
  }

  it('reports a word the checker refuses and not one it accepts', () => {
    expect(collect(['the documnet']).map((entry) => entry.word)).toEqual(['documnet']);
  });

  it('counts one word seen twice ONCE, and keeps the first spelling', () => {
    const [entry] = collect(['Documnet and documnet']);

    expect(entry?.word).toBe('Documnet');
    expect(entry?.occurrences).toBe(2);
  });

  it('JOINS the lines with a space, so a wrapped sentence invents no word', () => {
    // WITHOUT THE JOIN the two lines concatenate into `pagedocument`, which is
    // in no document and would be reported as a misspelling the reader never
    // wrote. That is louder than the word count's version of the same defect,
    // where it is only a total that is short.
    expect(collect(['page', 'document'])).toEqual([]);
  });

  it('SKIPS numbers and single letters, which no dictionary can judge', () => {
    // A page of figures would otherwise report every number on it, and a
    // mathematical document every variable — a list of real problems becomes a
    // list nobody reads. `3rd` is here because ANY digit disqualifies, not all.
    expect(collect(['2026 x 3rd H2O'])).toEqual([]);
  });

  it('records the FIRST page a word appeared on, not the last', () => {
    const found = new Map<string, Misspelling>();
    collectMisspellings(checker, ['documnet'], 2, found);
    collectMisspellings(checker, ['documnet'], 7, found);

    expect(found.get('documnet')?.firstPage).toBe(2);
    expect(found.get('documnet')?.occurrences).toBe(2);
  });

  it('suggests once, for the first occurrence', () => {
    let asked = 0;
    const counting = {
      correct: () => false,
      suggest: (word: string) => {
        asked += 1;
        return [word];
      },
    };
    const found = new Map<string, Misspelling>();
    collectMisspellings(counting, ['zzzq zzzq zzzq'], 0, found);

    // ASSERTS THE CALL, not the answer. The suggestions are identical either
    // way, so a case reading only the result would pass against a build that
    // recomputed them for every occurrence — which is the expensive half of the
    // library run three times for one entry.
    expect(asked).toBe(1);
  });
});
