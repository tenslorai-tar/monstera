import { MAX_AFFIX_BYTES, MAX_DICTIONARY_BYTES, SPELLING_LANGUAGES } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { readSpellingDictionary } from './spellingDictionaries.js';

/**
 * THE REAL PACKAGE, resolved and read.
 *
 * ## Found by the audit of `3d87cee..HEAD`, and it is the gap the pair leaves
 *
 * Spell check shipped with a kernel-shaped half (`checker.test.ts`, on a
 * three-word fixture) and a UI-shaped half (`checkSpelling.test.ts`, on an
 * injected `readDictionary`). Both pass against a build where
 * `readSpellingDictionary` resolves nothing at all — because neither of them
 * calls it. The one function whose whole job is *find the files on disk* was
 * the one function nothing pointed at.
 *
 * That is `the-helper-hides-the-caller` with the roles swapped: here the caller
 * is thoroughly tested and the thing it delegates to is not, because every case
 * hands in a substitute for it.
 *
 * ## So these cases deliberately use no fixture
 *
 * A fixture would reintroduce exactly the substitution the gap is made of. What
 * is being asserted is that the resolution works against the package as
 * installed: `dictionary-en`'s `exports` field is the bare string
 * `"./index.js"`, so neither `index.aff` nor `index.dic` has a subpath a
 * resolver will answer for, and this module reaches them by resolving the root
 * export and joining. If that idiom ever stops working — a package layout
 * change, a bundler that rewrites the resolution — these fail and nothing else
 * in the suite would.
 */
describe('reading a spelling dictionary', () => {
  it('RESOLVES AND READS the real package, for every declared language', async () => {
    for (const language of SPELLING_LANGUAGES) {
      const read = await readSpellingDictionary(language);

      // NOT NULL is the load-bearing half. `null` is the `unknown-dictionary`
      // refusal, and a build whose resolution is broken answers it for every
      // language — which the channel reports as a decided outcome and a reader
      // sees as "the dictionary could not be loaded".
      expect(read).not.toBeNull();
      expect(read?.affix.byteLength).toBeGreaterThan(0);
      expect(read?.words.byteLength).toBeGreaterThan(0);
    }
  });

  it('answers a HUNSPELL affix file and word list, not two arbitrary blobs', async () => {
    const read = await readSpellingDictionary('en');
    const decoder = new TextDecoder();

    // ASSERTS THE FORMAT, because "two files were read" is satisfied by reading
    // the wrong two — a licence and a readme are also non-empty. An affix file
    // opens with directives and a Hunspell word list opens with its count.
    expect(decoder.decode(read?.affix).startsWith('SET ')).toBe(true);
    expect(/^\d+\r?\n/u.test(decoder.decode(read?.words))).toBe(true);
  });

  it('comes in UNDER the bounds the channel refuses on, with the figures stated', async () => {
    const read = await readSpellingDictionary('en');

    // The bound is L11 and not tuning, and this is the reading behind it:
    // measured 2026-09-08, the affix file is 3,086 bytes and the word list
    // 551,762 for 49,568 words. Asserting the relation rather than the numbers,
    // because a dictionary update moves them and neither should approach a
    // bound — a case pinned to 551,762 would fail on a spelling correction.
    expect(read?.affix.byteLength).toBeLessThan(MAX_AFFIX_BYTES);
    expect(read?.words.byteLength).toBeLessThan(MAX_DICTIONARY_BYTES);
  });
});
