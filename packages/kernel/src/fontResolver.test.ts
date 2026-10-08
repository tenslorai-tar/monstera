import { describe, expect, it } from 'vitest';

import { type CandidateFace, type FontRequest, familyClass, normaliseFamily, resolveRuns } from './fontResolver.js';

/**
 * The resolver's order and its unit, on synthetic catalogues (ADR-0172 Decision 1). Each face carries exactly the
 * characters named, so every case says which face a word must land in and which it must not.
 */
function face(id: string, origin: CandidateFace['origin'], family: string, characters: string, extra: Partial<CandidateFace> = {}): CandidateFace {
  return {
    id,
    origin,
    family,
    weight: 400,
    italic: false,
    embedding: 'subset',
    unicodes: new Set(Array.from(characters, (character) => character.codePointAt(0) ?? 0)),
    weights: null,
    ...extra,
  };
}

/** ZERO WIDTH JOINER, built from its number so no invisible character sits in this file (guardFiles.mjs refuses one). */
const JOINER = String.fromCodePoint(0x200d);

const LATIN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,!';
const ACCENTED = `${LATIN}éèàüñ`;

const OWN = face('own', 'own', 'ABCDEF+ArialMT', LATIN);
const ARIMO = face('arimo', 'bundled', 'Arimo', `${ACCENTED}ΩПשם□`, { weights: { min: 400, max: 700 } });
const TINOS = face('tinos', 'bundled', 'Tinos', ACCENTED);
const NASKH = face('naskh', 'bundled', 'Noto Naskh Arabic', 'سلام ');
const CATALOGUE = [ARIMO, TINOS, NASKH];

function request(extra: Partial<FontRequest> = {}): FontRequest {
  return { family: 'ArialMT', bold: false, italic: false, own: [OWN], ...extra };
}

function summary(text: string, asked: FontRequest, catalogue: readonly CandidateFace[] = CATALOGUE): [string, string | null, string][] {
  return resolveRuns(text, asked, catalogue).map((run) => [run.text, run.face?.id ?? null, run.missing.join('')]);
}

describe('resolveRuns: the order', () => {
  it('keeps text in its own font when the font carries it, spaces included, as one run', () => {
    expect(summary('Hello world, again.', request())).toStrictEqual([['Hello world, again.', 'own', '']]);
  });

  it('sends the WHOLE word its font lacks a letter of to the stand-in, and leaves the rest of the line', () => {
    // CONTROL in the same line: "Hello" and "again" stay in the document's font.
    expect(summary('Hello café again', request())).toStrictEqual([
      ['Hello ', 'own', ''],
      ['café ', 'arimo', ''],
      ['again', 'own', ''],
    ]);
  });

  it('prefers an installed font of the asked family to the bundled stand-in', () => {
    const arial = face('arial', 'installed', 'Arial', ACCENTED);
    expect(summary('café', request(), [arial, ...CATALOGUE])).toStrictEqual([['café', 'arial', '']]);
  });

  // CONTROL for the case above: the same installed font licensed preview-and-print only is never chosen (Q2).
  it('skips an installed font its licence does not let a document carry', () => {
    const locked = face('arial', 'installed', 'Arial', ACCENTED, { embedding: 'never' });
    expect(summary('café', request(), [locked, ...CATALOGUE])).toStrictEqual([['café', 'arimo', '']]);
  });

  it('takes the bundled face of the family class when the family has no stand-in', () => {
    expect(summary('café', request({ family: 'Georgia-Bold', own: [] }))).toStrictEqual([['café', 'tinos', '']]);
    // CONTROL: a sans family with no stand-in lands in the sans face, so the class decided it.
    expect(summary('café', request({ family: 'Verdana', own: [] }))).toStrictEqual([['café', 'arimo', '']]);
  });

  it('takes any face carrying a script the asked family does not', () => {
    expect(summary('سلام', request())).toStrictEqual([['سلام', 'naskh', '']]);
  });
});

describe('resolveRuns: characters no face carries', () => {
  it('boxes a character no source carries and keeps it in its word’s face', () => {
    expect(summary('box 𓀀 end', request())).toStrictEqual([
      ['box ', 'own', ''],
      ['𓀀', 'own', '𓀀'],
      [' end', 'own', ''],
    ]);
  });

  it('splits a word only for a character another face carries, never boxing what a face can draw', () => {
    // No face carries "aΩ" with "س" whole: Arimo carries a and Ω, Naskh carries س.
    const runs = summary('aΩس', request({ own: [] }));
    expect(runs.map(([, id, missing]) => [id, missing])).toStrictEqual([
      ['arimo', ''],
      ['naskh', ''],
    ]);
    // CONTROL: a character no face carries in the same position IS boxed.
    expect(summary('aΩ𓀀', request({ own: [] })).at(-1)).toStrictEqual(['𓀀', 'arimo', '𓀀']);
  });

  it('needs no glyph for a default-ignorable character', () => {
    const joined = `ab${JOINER}cd`;
    expect(summary(joined, request())).toStrictEqual([[joined, 'own', '']]);
  });
});

describe('resolveRuns: weight', () => {
  it('pins a variable face at the asked weight, inside its range', () => {
    const runs = resolveRuns('café', request({ bold: true }), CATALOGUE);
    expect(runs[0]?.face?.id).toBe('arimo');
    expect(runs[0]?.weight).toBe(700);
    // CONTROL: the same request not bold pins it at 400.
    expect(resolveRuns('café', request(), CATALOGUE)[0]?.weight).toBe(400);
  });

  it('prefers the static face nearest the asked weight and slope within a family', () => {
    const regular = face('tinos-r', 'bundled', 'Tinos', ACCENTED);
    const bold = face('tinos-b', 'bundled', 'Tinos', ACCENTED, { weight: 700 });
    const boldItalic = face('tinos-bi', 'bundled', 'Tinos', ACCENTED, { weight: 700, italic: true });
    const asked = request({ family: 'TimesNewRomanPS-BoldMT', own: [] });
    expect(summary('été', { ...asked, bold: true }, [regular, boldItalic, bold])[0]?.[1]).toBe('tinos-b');
    expect(summary('été', { ...asked, bold: true, italic: true }, [regular, bold, boldItalic])[0]?.[1]).toBe('tinos-bi');
    expect(summary('été', asked, [bold, boldItalic, regular])[0]?.[1]).toBe('tinos-r');
  });
});

describe('normaliseFamily and familyClass', () => {
  it('removes the subset tag and PostScript style suffixes', () => {
    expect(normaliseFamily('ABCDEF+TimesNewRomanPS-BoldItalicMT')).toBe('timesnewroman');
    expect(normaliseFamily('Arial-BoldMT')).toBe('arial');
    expect(normaliseFamily('Calibri,Bold')).toBe('calibri');
    expect(normaliseFamily('Courier New')).toBe('couriernew');
    // CONTROL: a family whose own name ends in a style word keeps the rest.
    expect(normaliseFamily('Helvetica')).toBe('helvetica');
  });

  it('reads a family’s class from its name', () => {
    expect(familyClass('Consolas')).toBe('mono');
    expect(familyClass('Garamond')).toBe('serif');
    expect(familyClass('Verdana')).toBe('sans');
    expect(familyClass(null)).toBe('sans');
  });

  /**
   * RRRRRRR-12: a family name is read as one run of letters, so a sans family whose name holds `serif` or a weight
   * named `Book` was read as serif. Each is a name Windows ships; CONTROL beside each, a serif family the narrower
   * pattern must still read as serif.
   */
  it('reads a sans family whose name holds "serif" or "book" as sans, and the serif ones as serif', () => {
    expect(familyClass('Microsoft Sans Serif')).toBe('sans');
    expect(familyClass('MS Sans Serif')).toBe('sans');
    expect(familyClass('Franklin Gothic Book')).toBe('sans');
    expect(familyClass('Book Antiqua')).toBe('serif');
    expect(familyClass('Bookman Old Style')).toBe('serif');
    expect(familyClass('Times New Roman')).toBe('serif');
  });
});

describe('resolveRuns: the stand-in step (RRRRRRR-12)', () => {
  /**
   * THE STAND-IN IS ITS OWN STEP, between the asked family installed and the family's class. Calibri's stand-in is
   * Carlito and its class is sans, so the class step alone would choose Arimo, which leads the catalogue: only the
   * stand-in step puts Carlito first. Deleting that step left every case green until this one.
   */
  it('takes the bundled stand-in for its family before the class face, and before a face earlier in the catalogue', () => {
    const carlito = face('carlito', 'bundled', 'Carlito', ACCENTED);
    const caladea = face('caladea', 'bundled', 'Caladea', ACCENTED);
    const catalogue = [ARIMO, TINOS, carlito, caladea];
    expect(summary('café', request({ family: 'Calibri', own: [] }), catalogue)).toStrictEqual([['café', 'carlito', '']]);
    expect(summary('café', request({ family: 'Cambria-Bold', own: [] }), catalogue)).toStrictEqual([['café', 'caladea', '']]);
    // CONTROL: a sans family with no stand-in takes the class face, so the stand-in, not the order, chose Carlito.
    expect(summary('café', request({ family: 'Verdana', own: [] }), catalogue)).toStrictEqual([['café', 'arimo', '']]);
  });
});

describe('resolveRuns: the grapheme is the unit when a word is split (RRRRRRR-12)', () => {
  /** COMBINING ACUTE ACCENT, built from its number so no combining mark sits loose in this file. */
  const ACUTE = String.fromCodePoint(0x301);

  /**
   * A MARK STAYS WITH ITS LETTER. No face carries the whole word: the word's face carries `x` and `e` but not the
   * accent, and another face carries `e` with it. Split by code point, the `e` stayed in the word's face and the accent
   * went alone into the other, where HarfBuzz has no letter to place it on; by grapheme, `e` and its accent go together.
   */
  it('sends a letter and its combining mark to one face together', () => {
    const plain = face('plain', 'bundled', 'Arimo', 'xyzeq');
    const marks = face('marks', 'bundled', 'Tinos', `e${ACUTE}`);
    const runs = summary(`xye${ACUTE}q`, request({ own: [], family: 'Arial' }), [plain, marks]);
    expect(runs).toStrictEqual([
      ['xy', 'plain', ''],
      [`e${ACUTE}`, 'marks', ''],
      ['q', 'plain', ''],
    ]);
  });

  // CONTROL: a grapheme NO face carries whole is the box, in the word's face, with every code point of it named.
  it('boxes a grapheme no face carries whole, and names each of its code points', () => {
    const plain = face('plain', 'bundled', 'Arimo', 'xyzeq');
    expect(summary(`xye${ACUTE}q`, request({ own: [], family: 'Arial' }), [plain])).toStrictEqual([
      ['xy', 'plain', ''],
      [`e${ACUTE}`, 'plain', `e${ACUTE}`],
      ['q', 'plain', ''],
    ]);
  });
});
