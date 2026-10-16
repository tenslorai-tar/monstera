import type { FontFamilyEntry } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { previewFamilyOf } from './familyFaces.js';

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
