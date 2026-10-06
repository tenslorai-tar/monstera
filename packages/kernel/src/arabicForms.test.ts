import { describe, expect, it } from 'vitest';

import { arabicForms, lettersOfForms } from './arabicForms.js';

const points = (text: string): string => Array.from(text, (character) => (character.codePointAt(0) ?? 0).toString(16)).join(' ');

describe('arabicForms', () => {
  it('sets each letter of مرحبا in the shape its neighbours give it', () => {
    // meem initial, reh final (it joins only backwards), hah initial (reh does not reach it), beh medial, alef final.
    expect(points(arabicForms('مرحبا'))).toBe('fee3 feae fea3 fe92 fe8e');
  });

  it('sets a lone letter and a letter after one that does not join forwards in its isolated form', () => {
    expect(points(arabicForms('ب'))).toBe('fe8f');
    // alef joins backwards only, so the beh after it begins a new run and, with nothing after it, is isolated
    expect(points(arabicForms('اب'))).toBe('fe8d fe8f');
    // and a beh before an alef reaches it: initial, then the alef's final form
    expect(points(arabicForms('با'))).toBe('fe91 fe8e');
    // a space ends a run
    expect(points(arabicForms('ب ب'))).toBe('fe8f 20 fe8f');
  });

  it('leaves a letter with no forms, a digit and Latin text as they are', () => {
    expect(arabicForms('Hello 123')).toBe('Hello 123');
    // hamza joins neither way
    expect(points(arabicForms('ءب'))).toBe('621 fe8f');
  });

  it('does not let a mark interrupt the joining of the letters round it', () => {
    // beh, fatha, beh: the fatha is transparent, so the first beh is initial and the second final
    expect(points(arabicForms('بَب'))).toBe('fe91 64e fe90');
  });

  it('sets a lam followed by an alef as the one ligature glyph, isolated or final by what joins the lam from before', () => {
    expect(points(arabicForms('لا'))).toBe('fefb');
    // a beh before the lam reaches it, so the ligature takes its final shape
    expect(points(arabicForms('بلا'))).toBe('fe91 fefc');
    // the alef variants have their own ligatures
    expect(points(arabicForms('لأ'))).toBe('fef7');
    expect(points(arabicForms('لإ'))).toBe('fef9');
    expect(points(arabicForms('لآ'))).toBe('fef5');
  });

  // THE CONTROL: a lam NOT followed by an alef is a letter of four forms and no ligature, so the table is not matching every lam
  it('leaves a lam before any other letter as a letter', () => {
    expect(points(arabicForms('لب'))).toBe('fedf fe90');
  });

  it('reads a ligature back as the two letters, lam then alef', () => {
    expect(lettersOfForms(arabicForms('الله'))).toBe('الله');
    expect(lettersOfForms(arabicForms('لا'))).toBe('لا');
  });

  it('is its own fixed point: a form is not a letter, so a second pass changes nothing', () => {
    const once = arabicForms('السلام عليكم');
    expect(arabicForms(once)).toBe(once);
  });

  it('is undone, letter for letter, by what a text page reads', () => {
    for (const word of ['مرحبا', 'بالعالم', 'السلام', 'ذهب']) {
      expect(lettersOfForms(arabicForms(word))).toBe(word);
    }
  });

  // THE CONTROL: the forms are not the letters, so a writer that left the letters alone would draw isolated shapes.
  it('differs from the letters it was given, which is the whole point', () => {
    expect(arabicForms('مرحبا')).not.toBe('مرحبا');
  });
});
