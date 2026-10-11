import { describe, expect, it } from 'vitest';

import { fontFamiliesOf } from './fontFamilies.js';

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

  it('CONTROL: a document’s own face and a face with no family name are not families a picker offers', () => {
    expect(fontFamiliesOf([face({ origin: 'own' }), face({ origin: 'sibling' }), face({ family: '  ' })])).toStrictEqual([]);
  });
});
