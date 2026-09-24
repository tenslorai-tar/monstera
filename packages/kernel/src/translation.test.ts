import { describe, expect, it } from 'vitest';

import { readTranslation, translationInstruction, translationRequest } from './translation.js';

describe('readTranslation', () => {
  it('reads an array of exactly the blocks sent, in order', () => {
    expect(readTranslation('["Bonjour", "Deux\\nlignes"]', 2)).toStrictEqual(['Bonjour', 'Deux\nlignes']);
  });

  it('tolerates the code fence a model adds when told not to', () => {
    expect(readTranslation('```json\n["Un", "Deux"]\n```', 2)).toStrictEqual(['Un', 'Deux']);
    expect(readTranslation('```\n["Un"]\n```', 1)).toStrictEqual(['Un']);
  });

  it('refuses a DIFFERENT COUNT, which could not be matched to the blocks', () => {
    // The case that matters most: one block merged or split by the model would put every later
    // translation into the block above or below its own.
    expect(readTranslation('["Un", "Deux", "Trois"]', 2)).toBeUndefined();
    expect(readTranslation('["Un"]', 2)).toBeUndefined();
  });

  it('refuses what is not an array of strings', () => {
    expect(readTranslation('{"0": "Un"}', 1)).toBeUndefined();
    expect(readTranslation('[1, 2]', 2)).toBeUndefined();
    expect(readTranslation('I cannot translate this.', 1)).toBeUndefined();
  });

  it('drops characters that draw nothing, which no standard font carries and no reader sees', () => {
    expect(readTranslation('["Bon\\u200Bjour", "\\uFEFFFacture\\u2060"]', 2)).toStrictEqual(['Bonjour', 'Facture']);
    // CONTROL: a visible character next to them is kept, so the rule is not stripping everything odd.
    expect(readTranslation('["caf\\u00e9\\u200B"]', 1)).toStrictEqual(['café']);
  });

  it('does not dig an array out of prose — an array inside an apology is a guess', () => {
    expect(readTranslation('Here it is: ["Un"] — hope that helps', 1)).toBeUndefined();
  });

  it('CONTROL: the request it would read back is the one it builds', () => {
    // Round trip through the module's own two halves, so a change to one that the other does not
    // follow — an escaped line break, a different container — reddens here.
    const blocks = ['First line\nsecond line', 'Café “quoted” — dash'];
    expect(readTranslation(translationRequest(blocks), blocks.length)).toStrictEqual(blocks);
  });
});

describe('translationInstruction', () => {
  it('names the language and asks for the same count', () => {
    const instruction = translationInstruction('French');
    expect(instruction).toContain('into French');
    expect(instruction).toContain('exactly the same number of strings');
  });
});
