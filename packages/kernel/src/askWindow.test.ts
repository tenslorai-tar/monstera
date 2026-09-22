import { describe, expect, it } from 'vitest';

import { askInstruction, askPairInstruction, carriedWindow, readAskWindow } from './askWindow.js';

/** A reader over fixed page texts that records every page it was asked for. */
function pagesOf(texts: readonly string[]): { read: (page: number) => Promise<string>; asked: number[] } {
  const asked: number[] = [];
  return {
    asked,
    read: (page) => {
      asked.push(page);
      return Promise.resolve(texts[page] ?? '');
    },
  };
}

describe('the window an ask carries', () => {
  it('marks each page as a person reads it and reports the pages it covered', async () => {
    const { read } = pagesOf(['alpha', 'beta', 'gamma']);
    const window = await readAskWindow([0, 1, 2], 3, read);

    expect(window.text).toBe('[Page 1]\nalpha\n\n[Page 2]\nbeta\n\n[Page 3]\ngamma\n\n');
    expect(window.sent).toStrictEqual({ firstPage: 0, lastPage: 2, pageCount: 3, characters: window.text.length, truncated: false });
  });

  it('STOPS READING once the window is full, and says it stopped', async () => {
    // Each piece is 22 characters ("[Page N]\n" + 11 + "\n\n"), so a bound of 50 holds two.
    const { read, asked } = pagesOf(['x'.repeat(11), 'y'.repeat(11), 'z'.repeat(11), 'w'.repeat(11)]);
    const window = await readAskWindow([0, 1, 2, 3], 4, read, 50);

    expect(window.sent).toMatchObject({ firstPage: 0, lastPage: 1, truncated: true });
    expect(window.text.length).toBeLessThanOrEqual(50);
    // THE DECISION IS THE READ NOT MADE: a window that read every page and kept two would
    // hold the document in `main` on the way to the same answer (ADR-0035).
    expect(asked).toStrictEqual([0, 1, 2]);
  });

  it('cuts a first page that alone overflows, rather than sending nothing', async () => {
    const { read } = pagesOf(['q'.repeat(500)]);
    const window = await readAskWindow([0], 1, read, 40);

    expect(window.text).toHaveLength(40);
    expect(window.text.startsWith('[Page 1]\n')).toBe(true);
    expect(window.sent).toMatchObject({ firstPage: 0, lastPage: 0, truncated: true, characters: 40 });
  });

  it('CONTROL: a later page that overflows is left out whole, not cut into the window', async () => {
    const { read } = pagesOf(['short', 'q'.repeat(500)]);
    const window = await readAskWindow([0, 1], 2, read, 60);

    expect(window.text).toBe('[Page 1]\nshort\n\n');
    expect(window.sent).toMatchObject({ lastPage: 0, truncated: true });
  });

  it('a document with no pages is an empty window with no pages named', async () => {
    const window = await readAskWindow([], 0, pagesOf([]).read);
    expect(window.sent).toStrictEqual({ firstPage: null, lastPage: null, pageCount: 0, characters: 0, truncated: false });
  });

  it('a selection is its page marker and the selected words, reading nothing', () => {
    const window = carriedWindow(6, 'the clause', 12);
    expect(window.text).toBe('[Page 7]\nthe clause');
    expect(window.sent).toMatchObject({ firstPage: 6, lastPage: 6, pageCount: 12, truncated: false });
  });
});

describe('the instruction a window travels in', () => {
  it('names the pages covered, asks for citations in the form the renderer reads, and carries the text', async () => {
    const window = await readAskWindow([2, 3], 9, pagesOf(['', '', 'c', 'd']).read);
    const instruction = askInstruction(window, 'document');

    expect(instruction).toContain('pages 3 to 4 of 9');
    expect(instruction).toContain('[p. 3]');
    expect(instruction.endsWith(window.text)).toBe(true);
    expect(instruction).not.toContain('stops before the end');
  });

  it('says when the window stopped early, so a summary of part is not read as the whole', async () => {
    const window = await readAskWindow([0, 1], 2, pagesOf(['a'.repeat(30), 'b'.repeat(30)]).read, 45);
    expect(askInstruction(window, 'document')).toContain('stops before the end');
  });

  it('calls a COMMENT a comment, and CONTROL: a selection is still called selected', () => {
    const window = carriedWindow(0, 'Please check the date.', 1);
    // Seen live 2026-09-21: a comment went as a selection, and the model said "the text you selected".
    expect(askInstruction(window, 'comment')).toContain('a comment left on a PDF document');
    expect(askInstruction(window, 'comment')).not.toContain('selected');
    expect(askInstruction(window, 'selection')).toContain('the person selected');
  });
});

describe('two documents side by side (ADR-0089)', () => {
  it('marks each page with its SIDE, and CONTROL: one document keeps the plain marker', async () => {
    const left = await readAskWindow([0], 1, pagesOf(['alpha']).read, 100, 'left');
    const right = await readAskWindow([1], 2, pagesOf(['', 'beta']).read, 100, 'right');
    const alone = await readAskWindow([0], 1, pagesOf(['alpha']).read, 100);

    expect(left.text).toBe('[Left page 1]\nalpha\n\n');
    expect(right.text).toBe('[Right page 2]\nbeta\n\n');
    expect(alone.text).toBe('[Page 1]\nalpha\n\n');
  });

  it('asks for side-named citations, says what each side covered, and carries both texts in order', async () => {
    const left = await readAskWindow([2], 5, pagesOf(['', '', 'left words']).read, 100, 'left');
    const right = await readAskWindow([0, 1], 2, pagesOf(['r1', 'r2']).read, 100, 'right');
    const instruction = askPairInstruction(left, right, 'page');

    expect(instruction).toContain('[Left p. 3]');
    expect(instruction).toContain('[Right p. 3]');
    expect(instruction).toContain('The Left text is from page 3 of 5.');
    expect(instruction).toContain('The Right text covers pages 1 to 2 of 2.');
    expect(instruction.endsWith(`${left.text}\n${right.text}`)).toBe(true);
    // One document's form must not appear, or a citation could name a page in either.
    expect(instruction).not.toContain('cite it as [p. 3]');
  });
});
