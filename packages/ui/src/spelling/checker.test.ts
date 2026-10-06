import { type ContractClient, channels, createClient } from '@monstera/contract';
import { err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { buildChecker } from './checker.js';

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

describe('the dictionary is built once and held', () => {
  /** A client that counts how often it is asked for the dictionary, answering `answers` in turn. */
  function counting(answers: readonly ('dictionary' | 'unknown')[]): { client: ContractClient; asked: () => number } {
    let asked = 0;
    const client = createClient(channels, (id) => {
      if (id !== 'spelling.dictionary') throw new Error(`unexpected channel ${id}`);
      const answer = answers[Math.min(asked, answers.length - 1)];
      asked += 1;
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
    return { client, asked: () => asked };
  }

  it('ASKS ONCE for two checkers, and each keeps its own personal words', async () => {
    // ASSERTS THE CALL, not the answer: the two checkers answer alike either way, so only the count separates a held
    // dictionary from one built 401 ms at a time.
    const { client, asked } = counting(['dictionary']);
    const first = await buildChecker(client, 'en', ['Monstera']);
    const second = await buildChecker(client, 'en', []);
    expect(asked()).toBe(1);
    expect(first?.correct('Monstera')).toBe(true);
    expect(second?.correct('Monstera')).toBe(false);
  });

  it('ASKS AGAIN after a dictionary that would not load, so a later check can still find one', async () => {
    const { client, asked } = counting(['unknown', 'dictionary']);
    expect(await buildChecker(client, 'en', [])).toBeNull();
    expect((await buildChecker(client, 'en', []))?.correct('document')).toBe(true);
    expect(asked()).toBe(2);
  });
});
