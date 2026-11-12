import type { FontFamilyEntry } from '@monstera/contract';
import { STAND_INS, normaliseFamily, withoutSubsetTag } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { familyIndexOf, listedFamiliesFor, previewFamilyOf } from './familyFaces.js';

/**
 * Which face a name the font picker shows is drawn in (ADR-0250 Decision 3): the resolver's own stand-in table, read
 * through `@monstera/shared`, so the picker and the writer agree. Which families are drawable is stated per case, since
 * happy-dom measures every font alike.
 */
const entry = (name: string, origin: 'installed' | 'bundled'): FontFamilyEntry => ({ name, origin, embedding: 'subset', bold: true, italic: true });
const LIST = [entry('Times New Roman', 'installed'), entry('Calibri', 'installed'), entry('Tinos', 'bundled'), entry('Arimo', 'bundled')];
const everything = (): boolean => true;

describe('previewFamilyOf', () => {
  it('draws a listed family as itself, a subset tag dropped', () => {
    expect(previewFamilyOf('ABCDEF+Calibri', LIST, everything)).toBe('Calibri');
  });

  it('draws a PostScript name as the listed family it normalises to', () => {
    expect(previewFamilyOf('TimesNewRomanPS-BoldMT', LIST, everything)).toBe('Times New Roman');
  });

  it('draws a standard font’s name in the bundled stand-in the writer sets it in', () => {
    expect(previewFamilyOf('Helvetica-Bold', LIST, everything)).toBe('Arimo');
    expect(previewFamilyOf('Times-Roman', LIST, everything)).toBe('Tinos');
  });

  it('passes over a listed family that cannot be drawn, to the next that can', () => {
    // CALIBRI LISTED BUT NOT DRAWN (its face never loaded): its stand-in, Carlito, is not listed here, so nothing is left.
    expect(previewFamilyOf('Calibri', LIST, (family) => family !== 'Calibri')).toBeUndefined();
    // AND A BUNDLED FACE STILL ARRIVING is passed over the same way, never drawn by a name that falls to the default.
    expect(previewFamilyOf('Times-Roman', LIST, (family) => family !== 'Tinos')).toBeUndefined();
  });

  it('draws a name nothing here can draw in the interface font (the owner’s locked decision 6)', () => {
    expect(previewFamilyOf('ABCDEF+MysterySerif', LIST, everything)).toBeUndefined();
  });
});

describe('listedFamiliesFor, through the list indexed once', () => {
  /** The rule as it was written before the index, a linear search per ask: the reference the index must agree with. */
  const linear = (name: string, families: readonly FontFamilyEntry[]): string[] => {
    const plain = withoutSubsetTag(name);
    const key = normaliseFamily(name);
    const standIn = STAND_INS[key];
    return [
      families.find((family) => family.name.toLowerCase() === plain.toLowerCase())?.name,
      families.find((family) => normaliseFamily(family.name) === key)?.name,
      standIn === undefined ? undefined : families.find((family) => family.name === standIn)?.name,
    ].filter((family): family is string => family !== undefined);
  };
  // EVERY KEY COLLIDES SOMEWHERE: two names one lower-case apart, two that normalise alike, and the stand-in listed
  // twice, so an index that kept the LAST family instead of the first answers differently from the search.
  const CROWDED = [
    entry('Times New Roman', 'installed'),
    entry('TimesNewRoman', 'installed'),
    entry('calibri', 'installed'),
    entry('Calibri', 'installed'),
    entry('Tinos', 'bundled'),
    entry('Tinos', 'installed'),
    entry('Arimo', 'bundled'),
  ];
  const ASKED = ['Times New Roman', 'TimesNewRomanPS-BoldMT', 'ABCDEF+TimesNewRoman', 'Calibri', 'CALIBRI', 'Times-Roman', 'Helvetica', 'Arimo-Regular-wght700', 'Nothing Listed', ''];

  it('answers every name as the linear search did, the first family in the list winning a shared key', () => {
    for (const name of ASKED) expect(listedFamiliesFor(name, CROWDED), name).toEqual(linear(name, CROWDED));
  });

  it('CONTROL: the list separates first from last, so the case above could see an index that kept the last', () => {
    // The search's answers are the FIRST of each colliding pair; reversed, the list's first is the old last, and the
    // answers change. Were they the same, the case above would pass for an index keeping either.
    const reversed = [...CROWDED].reverse();
    expect(linear('TimesNewRomanPS-BoldMT', CROWDED)).not.toEqual(linear('TimesNewRomanPS-BoldMT', reversed));
    expect(linear('Calibri', CROWDED)).not.toEqual(linear('Calibri', reversed));
    expect(listedFamiliesFor('Calibri', reversed)).toEqual(linear('Calibri', reversed));
  });

  it('indexes a list once, and a new read, a new list, from its own families', () => {
    const read = [entry('Calibri', 'installed')];
    expect(familyIndexOf(read)).toBe(familyIndexOf(read));
    // A LATER READ that lists one more family is answered from its own list, never the earlier read's index.
    const later = [...read, entry('Georgia', 'installed')];
    expect(familyIndexOf(later)).not.toBe(familyIndexOf(read));
    expect(listedFamiliesFor('Georgia', read)).toEqual([]);
    // LISTED ONCE PER KEY IT MATCHES, by name and by its normalised name, as the search listed it.
    expect(listedFamiliesFor('Georgia', later)).toEqual(['Georgia', 'Georgia']);
    expect(listedFamiliesFor('Georgia', later)).toEqual(linear('Georgia', later));
  });
});
