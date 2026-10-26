// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { RunFonts } from '../commands/documentCommands.js';
import type { TextBlock } from '../textBlock.js';
import { useRunFaces } from './runFaces.js';

const STYLE = { size: 11, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false };
const BOX = { x0: 72, y0: 686, x1: 300, y1: 700 };
const BLOCK: TextBlock = {
  box: BOX,
  lines: [{ runs: [{ index: 1, text: 'words', style: STYLE }], box: BOX, soft: false, baseline: 689 }],
  style: STYLE,
  shape: { align: 'left', firstIndent: 0 },
  push: { below: [], room: 0 },
};
const NONE: RunFonts = { fonts: [], runs: new Map() };

describe('the faces an open block is drawn in', () => {
  it('belong to the READ that gave them: the same block opened again is not settled until its own read answers', async () => {
    // THE CONTROL is the hook before this: keyed by the block, the second opening was handed the first's answer at once.
    const first = (): Promise<RunFonts> => Promise.resolve(NONE);
    let answer: (fonts: RunFonts) => void = () => undefined;
    const second = (): Promise<RunFonts> =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const { result, rerender } = renderHook(({ read }: { read: (() => Promise<RunFonts>) | undefined }) => useRunFaces(BLOCK, read, 'v1-0-0'), {
      initialProps: { read: first },
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
});
