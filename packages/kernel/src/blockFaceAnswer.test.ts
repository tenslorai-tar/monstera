import { describe, expect, it } from 'vitest';

import { BLOCK_FACE_TEXT_MAX, blockFaceRunsOf, facesInOrder } from './blockFaceAnswer.js';

/**
 * The read on open's two halves in `main` (`blockFaceAnswer.ts`): a block's runs translated into the content's numbering
 * for the host, and the host's answer put back on the runs that asked.
 */

/** PDFium's pre-read: a rule at page object 1 between two lines, so a text object's place is not its object number. */
const READ = {
  textObjects: [0, 2, 3],
  runs: [
    { index: 0, members: [0], text: 'first line' },
    { index: 2, members: [2, 3], text: 'second line' },
    // A RUN WHOSE FIRST MEMBER IS NO TEXT OBJECT, so its first text object is the one after it.
    { index: 1, members: [1, 3], text: 'x'.repeat(BLOCK_FACE_TEXT_MAX + 1) },
  ],
};

describe('a block’s runs for the host, and the host’s answer back on them', () => {
  it('names each run by the content’s numbering of its first text object, not by PDFium’s object numbers', () => {
    expect(blockFaceRunsOf(READ, [0, 2])).toStrictEqual([
      { index: 0, object: 0, text: 'first line' },
      // CONTROL: the second line is PDFium's object 2, which is the content's text object 1.
      { index: 2, object: 1, text: 'second line' },
    ]);
  });

  it('skips a member that is no text object, and carries no more of the words than the bound', () => {
    expect(blockFaceRunsOf(READ, [1])).toStrictEqual([{ index: 1, object: 2, text: 'x'.repeat(BLOCK_FACE_TEXT_MAX) }]);
  });

  it('answers a run the pre-read did not hold with none, and every other run keeps its own font', () => {
    const runs = blockFaceRunsOf(READ, [0, 9, 2]);
    expect(runs.map((run) => run.index)).toStrictEqual([0, 2]);
    const answer = { fonts: [{ own: true, chosen: null, candidates: [] }, { own: false, chosen: null, candidates: [] }], runs: [0, 1] };
    // CONTROL: by position alone the third run would take the missing one's font, 1, and the missing one the second's.
    expect(facesInOrder([0, 9, 2], runs, answer).runs).toStrictEqual([0, null, 1]);
  });
});
