import { SIGNATURE_FONTS, outlinedSignatureMarkSchema, outlinePointsOf } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { loadFace, loadFaces, missingCharacters, outlinePath, setName } from './signatureFaces.js';

/**
 * The fifteen faces, read from the bundle as the renderer reads them (ADR-0150). Every case runs on the REAL font
 * files, because what is being proven is what those files answer: a stub would agree with any mistake in the reading.
 */

describe('the signature faces, read from the bundle', () => {
  it('every face loads, and draws a plain Latin name', async () => {
    const faces = await loadFaces();
    expect(faces.map((face) => face.face)).toStrictEqual([...SIGNATURE_FONTS]);
    for (const face of faces) {
      expect(face.fonts.length, face.face).toBeGreaterThan(0);
      expect(missingCharacters(face, 'Ada Lovelace'), face.face).toStrictEqual([]);
    }
  }, 60_000);

  it('says which characters a face cannot draw, each once, in the order typed', async () => {
    const face = await loadFace('sacramento');
    // The space is drawn; each Cyrillic letter is listed at its first use, and the Chinese one last.
    expect(missingCharacters(face, 'Жанна Жукова 王')).toStrictEqual(['Ж', 'а', 'н', 'у', 'к', 'о', 'в', '王']);
  });

  it('CONTROL: the same Cyrillic name IS drawn by a face whose files carry Cyrillic', async () => {
    expect(missingCharacters(await loadFace('source-sans'), 'Жанна Жукова')).toStrictEqual([]);
    expect(missingCharacters(await loadFace('caveat'), 'Жанна Жукова')).toStrictEqual([]);
  });

  it('finds the precomposed letter for an accent typed as a combining mark', async () => {
    const face = await loadFace('dancing-script');
    // "e" followed by COMBINING ACUTE ACCENT: no face here maps the combining mark, and NFC makes it "é", which it does.
    expect(missingCharacters(face, 'Renée')).toStrictEqual([]);
  });
});

describe('setName: a name as the outline it crosses as', () => {
  it('in EVERY face, answers an outline the contract takes', async () => {
    for (const face of await loadFaces()) {
      const set = setName(face, 'Jonathan Smithson');
      if (set.kind !== 'outline') throw new Error(`${face.face} answered ${set.kind}`);
      const mark = { kind: 'outlined', text: 'Jonathan Smithson', font: face.face, outline: set.outline };
      const parsed = outlinedSignatureMarkSchema.safeParse(mark);
      expect(parsed.success, `${face.face}: ${JSON.stringify(parsed.error?.issues.slice(0, 2))}`).toBe(true);
    }
  }, 60_000);

  it('sets the name LEFT TO RIGHT: each letter’s ink starts after the one before', async () => {
    const face = await loadFace('courier-prime');
    // A MONOSPACED face, so each glyph's ink is in its own cell: the first move of the outline of "l" in "ll" is to the
    // left of the second's. A layout that put every glyph at the origin would draw both in one place.
    const set = setName(face, 'll');
    if (set.kind !== 'outline') throw new Error(set.kind);
    const moves: number[] = [];
    let next = 0;
    for (const code of set.outline.ops) {
      if (code === 0) moves.push(set.outline.points[next] ?? -1);
      next += 2 * outlinePointsOf([code]);
    }
    expect(moves).toHaveLength(2);
    expect(moves[1] ?? 0).toBeGreaterThan((moves[0] ?? 0) + 1000);
  });

  it('keeps the face’s line box: a name with no descender is framed as tall as one with them', async () => {
    const face = await loadFace('source-sans');
    const plain = setName(face, 'ace');
    const tall = setName(face, 'Jgy');
    if (plain.kind !== 'outline' || tall.kind !== 'outline') throw new Error('no outline');
    // THE FRAME is the line box, whatever the ink: on the grid, its height over its width is the line box's.
    const ratio = (frame: readonly number[]): number => ((frame[3] ?? 0) - (frame[1] ?? 0)) / ((frame[2] ?? 0) - (frame[0] ?? 0));
    expect(ratio(plain.outline.frame)).toBeGreaterThan(0);
    // Same width class of three letters each, so the line box over the advance is within a factor of two.
    expect(ratio(plain.outline.frame) / ratio(tall.outline.frame)).toBeGreaterThan(0.5);
    expect(ratio(plain.outline.frame) / ratio(tall.outline.frame)).toBeLessThan(2);
  });

  it('REFUSES a character the face cannot draw, naming it, and draws nothing in its place', async () => {
    expect(setName(await loadFace('mr-dafoe'), 'Ada 王')).toStrictEqual({ kind: 'missing', characters: ['王'] });
  });

  it('answers BLANK for a name of spaces, rather than an outline with nothing in it', async () => {
    expect(setName(await loadFace('allura'), '   ')).toStrictEqual({ kind: 'blank' });
  });

  it('REFUSES a name past the outline’s bound, and CONTROL: the same face takes a name of ordinary length', async () => {
    const face = await loadFace('sacramento');
    expect(setName(face, 'Wolfgang '.repeat(40)).kind).toBe('too-long');
    expect(setName(face, 'Wolfgang Amadeus Mozart').kind).toBe('outline');
  });
});

describe('outlinePath: what the dialog shows', () => {
  it('draws the outline’s own operators, and boxes the frame and the ink', async () => {
    const set = setName(await loadFace('great-vibes'), 'Ada');
    if (set.kind !== 'outline') throw new Error(set.kind);
    const { d, viewBox } = outlinePath(set.outline);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toMatch(/Q/u);
    const [, , wide, tall] = viewBox.split(' ').map(Number);
    expect(wide).toBeGreaterThan(0);
    expect(tall).toBeGreaterThan(0);
  });
});
