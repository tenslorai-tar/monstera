import { describe, expect, it } from 'vitest';

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

describe('fontFamiliesOf, the one list a font picker shows', () => {
  it('makes one family of a family’s faces, with its bold and italic, sorted as a person reads', () => {
    expect(
      fontFamiliesOf([
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
      fontFamiliesOf([
        face({ family: 'Carlito', origin: 'bundled', weights: { min: 400, max: 700 } }),
        face({ family: 'Carlito', origin: 'installed' }),
      ]),
    ).toStrictEqual([{ name: 'Carlito', origin: 'installed', embedding: 'subset', bold: true, italic: false }]);
  });

  it('takes the least restricted licence of a family’s faces, and keeps a family no face may embed, to be said so', () => {
    expect(fontFamiliesOf([face({ embedding: 'never' }), face({ embedding: 'whole', weight: 700 })])[0]?.embedding).toBe('whole');
    expect(fontFamiliesOf([face({ family: 'Locked', embedding: 'never' })])).toStrictEqual([
      { name: 'Locked', origin: 'installed', embedding: 'never', bold: false, italic: false },
    ]);
  });

  it('says which family a BUNDLED one looks like, and never of an installed one of the same name', () => {
    expect(fontFamiliesOf([face({ family: 'Carlito', origin: 'bundled' }), face({ family: 'Tinos', origin: 'bundled' })])).toStrictEqual([
      { name: 'Carlito', origin: 'bundled', embedding: 'subset', bold: false, italic: false, looksLike: 'Calibri' },
      { name: 'Tinos', origin: 'bundled', embedding: 'subset', bold: false, italic: false, looksLike: 'Times New Roman' },
    ]);
    expect(fontFamiliesOf([face({ family: 'Carlito', origin: 'installed' })])[0]?.looksLike).toBeUndefined();
  });

  it('LOOKS_LIKE is STAND_INS read the other way: each named family stands in for the one it looks like', () => {
    // THE ONE AUTHORITY is the resolver's table; a pair here that it did not hold would label a font as looking like a
    // family the resolver never sets it for.
    for (const [bundled, like] of Object.entries(LOOKS_LIKE)) expect(STAND_INS[normaliseFamily(like)], like).toBe(bundled);
    // CONTROL: the check can fail, on a pair the table does not hold.
    expect(STAND_INS[normaliseFamily('Georgia')]).toBeUndefined();
  });

  it('CONTROL: a document’s own face and a face with no family name are not families a picker offers', () => {
    expect(fontFamiliesOf([face({ origin: 'own' }), face({ origin: 'sibling' }), face({ family: '  ' })])).toStrictEqual([]);
  });
});
