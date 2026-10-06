import { describe, expect, it } from 'vitest';

import { codesFor, readToUnicode } from './toUnicode.js';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

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
    const map = readToUnicode(CHROMIUM);
    expect(map.bytes).toBe(1);
    expect([0x30, 0x52, 0x51, 0x56, 0x57, 0x48, 0x55, 0x44].map((code) => map.text.get(code)).join('')).toBe('Monstera');
    // THE RANGE'S LAST CODE is inside it, and the code after it is not.
    expect([map.text.get(0x4c), map.text.get(0x4d)]).toStrictEqual(['i', undefined]);
  });

  it('reads an array range, a two-byte codespace and a character past the BMP as one', () => {
    const map = readToUnicode(
      bytes('1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0001> <0003> [<0041> <D83D DE00> <0063>] endbfrange'),
    );
    expect(map.bytes).toBe(2);
    expect([1, 2, 3].map((code) => map.text.get(code))).toStrictEqual(['A', '\u{1F600}', 'c']);
  });

  it('CONTROL: refuses a range that runs backwards, rather than reading nothing from it', () => {
    expect(() => readToUnicode(bytes('1 beginbfrange <10> <05> <0041> endbfrange'))).toThrow(/runs from 16 to 5/u);
  });
});

describe('codesFor', () => {
  it('gives each character the code that draws it, and none where one character has no code', () => {
    const map = readToUnicode(CHROMIUM);
    expect(codesFor(map, 'Max')).toStrictEqual([0x30, 0x44, 0x5b]);
    // CONTROL: one character the subset never drew makes the whole word have no codes in this font.
    expect(codesFor(map, 'Mbx')).toBeNull();
  });

  it('takes the lowest code where two draw one character, so the answer is the same every time', () => {
    const map = readToUnicode(bytes('2 beginbfchar <09> <0041> <02> <0041> endbfchar'));
    expect(codesFor(map, 'A')).toStrictEqual([2]);
  });
});
