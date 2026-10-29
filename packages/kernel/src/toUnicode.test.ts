import { describe, expect, it } from 'vitest';

import { JOINED_LETTERS, type ToUnicode, codesFor, lettersOf, readToUnicode } from './toUnicode.js';

/** `fi` joined, U+FB01, by its code point so the source shows what it is. */
const FI = String.fromCodePoint(0xfb01);

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A CMap these cases know reads, read; one that does not is the case's own failure, named. */
function read(cmap: Uint8Array): ToUnicode {
  const answer = readToUnicode(cmap);
  if (!answer.ok) throw new Error(`the fixture's CMap did not read: ${answer.error}`);
  return answer.value;
}

/** The ToUnicode of the committed Chromium print's Type 3 heading font, as read from the fixture 2026-10-06. */
const CHROMIUM = bytes(
  '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) ' +
    '/Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <00> <FF> ' +
    'endcodespacerange 6 beginbfchar <03> <0020> <11> <002E> <24> <0041> <30> <004D> <44> <0061> <5B> <0078> endbfchar ' +
    '3 beginbfrange <46> <4C> <0063> <50> <52> <006D> <55> <58> <0072> endbfrange endcmap CMapName currentdict /CMap ' +
    'defineresource pop end end',
);

describe('readToUnicode', () => {
  it('reads a Chromium Type 3 font’s CMap: single codes, incremented ranges, one-byte codes', () => {
    const map = read(CHROMIUM);
    expect(map.bytes).toBe(1);
    expect([0x30, 0x52, 0x51, 0x56, 0x57, 0x48, 0x55, 0x44].map((code) => map.text.get(code)).join('')).toBe('Monstera');
    // THE RANGE'S LAST CODE is inside it, and the code after it is not.
    expect([map.text.get(0x4c), map.text.get(0x4d)]).toStrictEqual(['i', undefined]);
  });

  it('reads an array range, a two-byte codespace and a character past the BMP as one', () => {
    const map = read(
      bytes('1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0001> <0003> [<0041> <D83D DE00> <0063>] endbfrange'),
    );
    expect(map.bytes).toBe(2);
    expect([1, 2, 3].map((code) => map.text.get(code))).toStrictEqual(['A', '\u{1F600}', 'c']);
  });

  it('CONTROL: refuses a range that runs backwards, rather than reading nothing from it', () => {
    expect(readToUnicode(bytes('1 beginbfrange <10> <05> <0041> endbfrange'))).toStrictEqual({
      ok: false,
      error: 'a range that runs from 16 to 5',
    });
    expect(readToUnicode(bytes('1 beginbfchar <0G> <0041> endbfchar')).ok).toBe(false);
  });
});

describe('codesFor', () => {
  it('gives each character the code that draws it, and none where one character has no code', () => {
    const map = read(CHROMIUM);
    expect(codesFor(map, 'Max')).toStrictEqual([0x30, 0x44, 0x5b]);
    // CONTROL: one character the subset never drew makes the whole word have no codes in this font.
    expect(codesFor(map, 'Mbx')).toBeNull();
  });

  it('takes the lowest code where two draw one character, so the answer is the same every time', () => {
    const map = read(bytes('2 beginbfchar <09> <0041> <02> <0041> endbfchar'));
    expect(codesFor(map, 'A')).toStrictEqual([2]);
  });

  it('finds ONE code for two characters where neither has a code of its own: a glyph read as `=` and a mark', () => {
    const map: ToUnicode = { text: new Map([[0x01, 'a'], [0x02, '=ܼ']]), bytes: 1 };
    expect(codesFor(map, 'a=ܼ')).toStrictEqual([0x01, 0x02]);
  });

  it('CONTROL: characters with codes of their own are set with them, never a code naming them and a mark together', () => {
    const map: ToUnicode = { text: new Map([[0x01, '='], [0x02, 'ܼ'], [0x03, '=ܼ']]), bytes: 1 };
    expect(codesFor(map, '=ܼ')).toStrictEqual([0x01, 0x02]);
  });

  it('takes a joined-letter glyph over its letters, the longest first, as the producer drew the word (25b)', () => {
    // A SUBSET HOLDING `ffl`, `fl`, `f` and `l`: the print joined the three wherever they met. This case said the
    // opposite until cloud run 25 — letters first, `fi` as two codes — which set an untouched `affluent` again as `f`
    // and a joined `fl`.
    const map: ToUnicode = { text: new Map([[0x10, 'f'], [0x11, 'l'], [0x20, 'fl'], [0x30, 'ffl'], [0x12, 'u']]), bytes: 1 };
    expect(codesFor(map, 'fflu')).toStrictEqual([0x30, 0x12]);
    expect(codesFor(map, 'flu')).toStrictEqual([0x20, 0x12]);
    // AND WHERE THE LONGEST LEAVES THE REST UNDRAWABLE, the next: `ffl` then `x` has no code, so nothing draws it.
    expect(codesFor(map, 'fflx')).toBeNull();
    // A LETTER ALONE is still its own code.
    expect(codesFor(map, 'f')).toStrictEqual([0x10]);
  });

  it('finds a joined-letter glyph named by its presentation form by its letters, as a print names one (25b)', () => {
    // `fi` AS U+FB01, `ft` as its two letters, and no `f` alone: a browser's print of `fifty` in a drawn font.
    const print: ToUnicode = { text: new Map([[0x43, FI], [0x5b, 'ft'], [0x8b, 'y']]), bytes: 1 };
    expect(codesFor(print, 'fifty')).toStrictEqual([0x43, 0x5b, 0x8b]);
    // AND OVER THE LETTERS' OWN CODES, as a code naming the letters is.
    const both: ToUnicode = { text: new Map([[0x10, 'f'], [0x11, 'i'], [0x43, FI]]), bytes: 1 };
    expect(codesFor(both, 'fi')).toStrictEqual([0x43]);
    // A CODE THAT SAYS THE LETTERS ITSELF wins over one whose letters are only its form's.
    const named: ToUnicode = { text: new Map([[0x43, FI], [0x50, 'fi']]), bytes: 1 };
    expect(codesFor(named, 'fi')).toStrictEqual([0x50]);
  });

  it('CONTROL: only joined letters are spelt as their letters, never another compatibility form', () => {
    const forms = String.fromCodePoint(...Array.from({ length: 7 }, (_, at) => JOINED_LETTERS.first + at));
    expect(lettersOf(forms)).toBe('fffiflffifflstst');
    // A SUPERSCRIPT TWO is a different glyph from `2`, which NFKC would make it, and a full-width A from A.
    const superscript: ToUnicode = { text: new Map([[0x01, String.fromCodePoint(0xb2)], [0x02, String.fromCodePoint(0xff21)]]), bytes: 1 };
    expect(codesFor(superscript, '2')).toBeNull();
    expect(codesFor(superscript, 'A')).toBeNull();
  });
});
