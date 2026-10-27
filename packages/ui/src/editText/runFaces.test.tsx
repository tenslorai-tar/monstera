// @vitest-environment happy-dom
import { type FontFamilyEntry, channels, createClient } from '@monstera/contract';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { type BlockFontRead, NO_BLOCK_FACES } from '../commands/documentCommands.js';
import type { RunStyle } from '../editorKit/model.js';
import { noteFamilies } from '../familyFaces.js';
import type { TextBlock } from '../textBlock.js';
import { runStyleOf } from './blockModel.js';
import { type FaceRead, editorFacesOf, faceCssOf, runFacesOf, useRunFaces } from './runFaces.js';

const STYLE = { size: 11, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false };
const BOX = { x0: 72, y0: 686, x1: 300, y1: 700 };
const BLOCK: TextBlock = {
  box: BOX,
  lines: [
    {
      runs: [
        { index: 1, text: 'words', style: { ...STYLE, font: 'ABCDEF+Calibri' } },
        { index: 4, text: 'drawn', style: { ...STYLE, font: 'T3Font' } },
      ],
      box: BOX,
      soft: false,
      baseline: 689,
    },
  ],
  style: STYLE,
  shape: { align: 'left', firstIndent: 0 },
};
const NONE: FaceRead = { faces: NO_BLOCK_FACES, shown: new Map() };

const entry = (name: string): FontFamilyEntry => ({ name, origin: 'bundled', embedding: 'subset', bold: true, italic: true });
const face = (family: string): NonNullable<BlockFontRead['chosen']> => ({ family, weight: 400, italic: false, styles: ['regular', 'bold'] });
/** The read on open for the block: Calibri's font may carry new words, the Type 3 one may not; Carlito and Arimo chosen. */
const READ: FaceRead = {
  faces: {
    fonts: [
      { own: true, chosen: face('Carlito'), candidates: [face('Carlito'), face('Arimo')] },
      { own: false, chosen: face('Arimo'), candidates: [face('Arimo')] },
    ],
    runs: new Map([
      [1, 0],
      [4, 1],
    ]),
  },
  // PDF.js loaded a face for Calibri's subset and none for the Type 3 font.
  shown: new Map([[1, 'g_d0_f1']]),
};

const styleOfRun = (at: number): RunStyle => {
  const run = BLOCK.lines[0]?.runs[at];
  if (run === undefined) throw new Error('the fixture has two runs');
  return runStyleOf(run.style, run.index);
};

describe('the faces an open block is drawn in', () => {
  it('belong to the READ that gave them: the same block opened again is not settled until its own read answers', async () => {
    const first = (): Promise<FaceRead> => Promise.resolve(NONE);
    let answer: (read: FaceRead) => void = () => undefined;
    const second = (): Promise<FaceRead> =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const opening: { read: (() => Promise<FaceRead>) | undefined } = { read: first };
    const { result, rerender } = renderHook(({ read }: { read: (() => Promise<FaceRead>) | undefined }) => useRunFaces(BLOCK, read), {
      initialProps: opening,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.settled).toBe(true);
    // CLOSED, then OPENED AGAIN: a new read, still waiting.
    rerender({ read: undefined });
    rerender({ read: second });
    expect(result.current.settled).toBe(false);
    await act(async () => {
      answer(NONE);
      await Promise.resolve();
    });
    expect(result.current.settled).toBe(true);
  });

  it('draws a run in PDF.js’s face, then the chain’s, then its kind; a run PDF.js loaded nothing for, in the chain’s', () => {
    noteFamilies([entry('Carlito'), entry('Arimo')], createClient(channels, () => Promise.reject(new Error('no main here'))));
    const css = faceCssOf(runFacesOf(BLOCK, READ), BLOCK, 'sans', new Set(['carlito', 'arimo']));
    expect(css(styleOfRun(0))).toBe('"g_d0_f1", "Carlito", var(--m-face-sans)');
    // CONTROL: the Type 3 run has no face of its own, so a new word in it is drawn where the writer will write it.
    expect(css(styleOfRun(1))).toBe('"Arimo", var(--m-face-sans)');
    // AND WITHOUT THE READ, the chain's face is not guessed: the page's name, where the list has a family for it.
    expect(faceCssOf(runFacesOf(BLOCK, NONE), BLOCK, 'sans', new Set(['carlito', 'arimo']))(styleOfRun(1))).toBe('var(--m-face-sans)');
  });

  it('draws a family the block does not carry behind the person’s fallback kind (`editing.fallback-face`), and a page run behind its own', () => {
    const chosen: RunStyle = { ...styleOfRun(0), face: 'A Family Nowhere' };
    expect(faceCssOf(runFacesOf(BLOCK, NONE), BLOCK, 'serif')(chosen)).toBe('var(--m-face-serif)');
    expect(faceCssOf(runFacesOf(BLOCK, NONE), BLOCK, 'mono')(chosen)).toBe('var(--m-face-mono)');
    // CONTROL: a run the page says is sans stays sans whatever the setting says, so the cases above are the setting's.
    expect(faceCssOf(runFacesOf(BLOCK, NONE), BLOCK, 'serif')(styleOfRun(1))).toBe('var(--m-face-sans)');
  });

  it('offers the read’s faces to the picker by the face key, Monstera’s choice named', () => {
    const faces = editorFacesOf(runFacesOf(BLOCK, READ));
    expect(faces(styleOfRun(0).face)).toStrictEqual({
      closest: [
        { family: 'Carlito', styles: ['regular', 'bold'] },
        { family: 'Arimo', styles: ['regular', 'bold'] },
      ],
      chosen: 'Carlito',
    });
    expect(faces('a family the person chose')).toBeUndefined();
  });
});
