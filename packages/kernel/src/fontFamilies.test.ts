import { describe, expect, it } from 'vitest';

import { MAX_FONT_FAMILIES } from '@monstera/contract/host';

import { fontFamiliesOf } from './fontFamilies.js';
import { LOOKS_LIKE, STAND_INS, normaliseFamily } from './fontResolver.js';

type Face = Parameters<typeof fontFamiliesOf>[0][number];

const face = (over: Partial<Face>): Face => ({
  family: 'Arial',
  origin: 'installed',
  embedding: 'subset',
  weight: 400,
  italic: false,
  weights: null,
  ...over,
});

/** The families listed, for the cases about what a family is; the bound's own cases read `more` too. */
const familiesOf = (faces: readonly Face[]) => fontFamiliesOf(faces).families;

describe('fontFamiliesOf, the one list a font picker shows', () => {
  it('COUNTS the families past the list’s bound, the last by name, rather than dropping them without a word', () => {
    // NAMED so the last by name is known: `Family 0000` … `Family 4097`, two past the bound.
    const names = Array.from({ length: MAX_FONT_FAMILIES + 2 }, (_, at) => `Family ${String(at).padStart(4, '0')}`);
    const listed = fontFamiliesOf([...names].reverse().map((family) => face({ family })));
    expect(listed.more).toBe(2);
    expect(listed.families).toHaveLength(MAX_FONT_FAMILIES);
    expect(listed.families.at(-1)?.name).toBe(names[MAX_FONT_FAMILIES - 1]);
    // CONTROL: a list exactly at the bound has nothing more to say, so the count above is the overflow and not a size.
    expect(fontFamiliesOf(names.slice(0, MAX_FONT_FAMILIES).map((family) => face({ family }))).more).toBe(0);
  });

  it('never lists the LAST face, which draws only what no other face does (ADR-0270)', () => {
    expect(familiesOf([face({ family: 'Unifont', origin: 'last' }), face({ family: 'Arimo', origin: 'bundled' })]).map((family) => family.name)).toStrictEqual([
      'Arimo',
    ]);
    // CONTROL: the same face as bundled is listed, so it is the origin that keeps it out and not its name.
    expect(familiesOf([face({ family: 'Unifont', origin: 'bundled' })]).map((family) => family.name)).toStrictEqual(['Unifont']);
  });

  it('names an installed family for `local()` by its face nearest an upright regular (ADR-0250 Decision 1)', () => {
    const [family] = familiesOf([
      face({ family: 'Sitka', weight: 700, localNames: ['SitkaText-Bold'] }),
      face({ family: 'Sitka', italic: true, localNames: ['SitkaTextItalic', 'Sitka Text Italic'] }),
      face({ family: 'Sitka', localNames: ['SitkaText', 'Sitka Text'] }),
    ]);
    expect(family?.locals).toStrictEqual(['SitkaText', 'Sitka Text']);
  });

  it('offers no name the wire would refuse, and none for a bundled family, which crosses as bytes', () => {
    // A NAME THAT COULD CLOSE THE CSS STRING is left out; the other name of the same face is kept.
    const [quoted] = familiesOf([face({ family: 'Odd', localNames: ['Odd") , url(x', 'Odd Regular'] })]);
    expect(quoted?.locals).toStrictEqual(['Odd Regular']);
    // CONTROL: a family whose every name is refused is listed with none, never with a name the list's schema refuses.
    const [none] = familiesOf([face({ family: 'Odd', localNames: ['"'] })]);
    expect(none !== undefined && !('locals' in none)).toBe(true);
    const [bundled] = familiesOf([face({ family: 'Tinos', origin: 'bundled', localNames: ['Tinos-Regular'] })]);
    expect(bundled !== undefined && !('locals' in bundled)).toBe(true);
  });

  it('makes one family of a family’s faces, with its bold and italic, sorted as a person reads', () => {
    expect(
      familiesOf([
        face({ family: 'Times New Roman' }),
        face({ family: 'Arial' }),
        face({ family: 'Arial', weight: 700 }),
        face({ family: 'Arial', italic: true }),
        face({ family: 'calibri' }),
      ]),
    ).toStrictEqual([
      { name: 'Arial', origin: 'installed', embedding: 'subset', bold: true, italic: true },
      { name: 'calibri', origin: 'installed', embedding: 'subset', bold: false, italic: false },
      { name: 'Times New Roman', origin: 'installed', embedding: 'subset', bold: false, italic: false },
    ]);
  });

  it('lists a family the computer has as installed even where Monstera bundles it too, and a variable face’s range as bold', () => {
    expect(
      familiesOf([
        face({ family: 'Carlito', origin: 'bundled', weights: { min: 400, max: 700 } }),
        face({ family: 'Carlito', origin: 'installed' }),
      ]),
    ).toStrictEqual([{ name: 'Carlito', origin: 'installed', embedding: 'subset', bold: true, italic: false }]);
  });

  it('takes the least restricted licence of a family’s faces, and keeps a family no face may embed, to be said so', () => {
    expect(familiesOf([face({ embedding: 'never' }), face({ embedding: 'whole', weight: 700 })])[0]?.embedding).toBe('whole');
    expect(familiesOf([face({ family: 'Locked', embedding: 'never' })])).toStrictEqual([
      { name: 'Locked', origin: 'installed', embedding: 'never', bold: false, italic: false },
    ]);
  });

  it('says which family a BUNDLED one looks like, and never of an installed one of the same name', () => {
    expect(familiesOf([face({ family: 'Carlito', origin: 'bundled' }), face({ family: 'Tinos', origin: 'bundled' })])).toStrictEqual([
      { name: 'Carlito', origin: 'bundled', embedding: 'subset', bold: false, italic: false, looksLike: 'Calibri' },
      { name: 'Tinos', origin: 'bundled', embedding: 'subset', bold: false, italic: false, looksLike: 'Times New Roman' },
    ]);
    expect(familiesOf([face({ family: 'Carlito', origin: 'installed' })])[0]?.looksLike).toBeUndefined();
  });

  it('LOOKS_LIKE is STAND_INS read the other way: each named family stands in for the one it looks like', () => {
    // THE ONE AUTHORITY is the resolver's table; a pair here that it did not hold would label a font as looking like a
    // family the resolver never sets it for.
    for (const [bundled, like] of Object.entries(LOOKS_LIKE)) expect(STAND_INS[normaliseFamily(like)], like).toBe(bundled);
    // CONTROL: the check can fail, on a pair the table does not hold.
    expect(STAND_INS[normaliseFamily('Georgia')]).toBeUndefined();
  });

  it('CONTROL: a document’s own face and a face with no family name are not families a picker offers', () => {
    expect(familiesOf([face({ origin: 'own' }), face({ origin: 'sibling' }), face({ family: '  ' })])).toStrictEqual([]);
  });
});
