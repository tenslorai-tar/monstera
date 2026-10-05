import { describe, expect, it } from 'vitest';

import { replacementsMovingTheirLine, type RunBox } from './replaceLineRule.js';

/** A run on a line whose characters span `bottom`..`top`. */
const run = (left: number, end: number, bottom = 700, top = 710): RunBox => ({ left, end, bottom, top });

/** Two objects on one line: the word at 72..100 and the text after it at 103..200. */
const LINE = new Map([
  [0, run(72, 100)],
  [1, run(103, 200)],
]);

describe('replacementsMovingTheirLine', () => {
  it('a WIDER replacement with text after it on the line would move that text', () => {
    expect(replacementsMovingTheirLine(LINE, new Map([[0, run(72, 130)]]))).toStrictEqual([0]);
  });

  it('a NARROWER one would too, leaving a gap the next object does not close', () => {
    expect(replacementsMovingTheirLine(LINE, new Map([[0, run(72, 90)]]))).toStrictEqual([0]);
  });

  it('a REMOVED object with text after it would leave a gap the width of the word', () => {
    expect(replacementsMovingTheirLine(LINE, new Map([[0, null]]))).toStrictEqual([0]);
  });

  it('CONTROL: the same width moves nothing, within a quarter point', () => {
    expect(replacementsMovingTheirLine(LINE, new Map([[0, run(72, 100.2)]]))).toStrictEqual([]);
  });

  it('CONTROL: the LAST object on its line may change width, since nothing follows it', () => {
    expect(replacementsMovingTheirLine(LINE, new Map([[1, run(103, 260)]]))).toStrictEqual([]);
  });

  it('CONTROL: text on the line BELOW is not text after it, so a wider last run is not refused', () => {
    const lines = new Map([
      [0, run(72, 100)],
      [1, run(72, 200, 686, 696)],
    ]);
    expect(replacementsMovingTheirLine(lines, new Map([[0, run(72, 130)]]))).toStrictEqual([]);
  });

  it('text BEFORE the replaced run does not move, since a run grows from its own start', () => {
    expect(replacementsMovingTheirLine(LINE, new Map([[1, run(103, 230)]]))).toStrictEqual([]);
  });

  it('a follower the same replacement REMOVES is not text that would move', () => {
    expect(replacementsMovingTheirLine(LINE, new Map([[0, run(72, 130)], [1, null]]))).toStrictEqual([]);
  });

  it('an object that could not be measured is left to the read-back', () => {
    expect(replacementsMovingTheirLine(LINE, new Map([[5, run(0, 10)]]))).toStrictEqual([]);
  });
});
