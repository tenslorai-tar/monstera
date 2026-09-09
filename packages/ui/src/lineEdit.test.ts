import { describe, expect, it } from 'vitest';

import { type LineRun, lineText, replacementsForLine } from './lineEdit.js';

/**
 * The line diff, cased on what it must NOT rewrite.
 *
 * ## Every case here separates the diff from "put it all in the first run"
 *
 * That one-liner is the implementation this module exists instead of, and it
 * passes any test that only checks the line reads correctly afterwards — the
 * page looks right and the formatting of every untouched run is gone. So the
 * assertions are about **which objects are named**, and several cases would be
 * satisfied by the wrong implementation if they asserted the text alone.
 *
 * The fixture indices are non-contiguous and do not start at zero, for the same
 * reason `documentCommands.test.ts`' are: an implementation that answered a
 * position in its own list would agree with the engine's numbering exactly
 * until a page had a non-text object before a text one.
 */
const LINE: readonly LineRun[] = [
  { index: 4, text: 'The quick ' },
  { index: 9, text: 'brown ' },
  { index: 2, text: 'fox' },
];

describe('turning an edited line into replacements', () => {
  it('names NOTHING when the text is unchanged', () => {
    // The caller must not send a command for this — the schema refuses an empty
    // list, because a regeneration for no change is the whole cost of an edit
    // paid for nothing. An empty answer is *nothing to do*, not a refusal.
    expect(replacementsForLine(LINE, lineText(LINE))).toStrictEqual([]);
  });

  it('names ONE run when the change is inside one run', () => {
    // THE COMMON CASE, and the one the whole module is for. A change inside
    // "brown " must leave the objects either side untouched, so their fonts
    // survive an edit that never reached them.
    expect(replacementsForLine(LINE, 'The quick red fox')).toStrictEqual([
      { index: 9, text: 'red ' },
    ]);
  });

  it('names one run when the change is in the FIRST run, and not the others', () => {
    expect(replacementsForLine(LINE, 'A quick brown fox')).toStrictEqual([
      { index: 4, text: 'A quick ' },
    ]);
  });

  it('names one run when the change is in the LAST run', () => {
    expect(replacementsForLine(LINE, 'The quick brown dog')).toStrictEqual([
      { index: 2, text: 'dog' },
    ]);
  });

  it('keeps the untouched TAIL on its own run when a change crosses a boundary', () => {
    // THE CROSS-BOUNDARY RULE, asserted as three facts rather than one: the new
    // characters go to the first touched run, what followed the change stays on
    // the run that already held it, and the run the change never reached is not
    // named at all. An implementation that put everything in the first run and
    // emptied the rest produces the same rendered line and fails all three.
    //
    // The shared suffix here is " fox", not "fox", so the space before it stays
    // on run 9 — which is the diff keeping MORE than the boundary suggests and
    // is worth pinning: an implementation that computed the suffix per run
    // rather than over the line would empty run 9 and read as correct.
    expect(replacementsForLine(LINE, 'The slow grey fox')).toStrictEqual([
      { index: 4, text: 'The slow grey' },
      { index: 9, text: ' ' },
    ]);
  });

  it('empties every run when the line is cleared', () => {
    expect(replacementsForLine(LINE, '')).toStrictEqual([
      { index: 4, text: '' },
      { index: 9, text: '' },
      { index: 2, text: '' },
    ]);
  });

  it('appends to the LAST run rather than starting a fourth object', () => {
    // A command cannot create an object, so an append has to land on one that
    // exists. The last run is where the characters were typed.
    expect(replacementsForLine(LINE, 'The quick brown foxes')).toStrictEqual([
      { index: 2, text: 'foxes' },
    ]);
  });

  it('inserts at the very start into the FIRST run', () => {
    expect(replacementsForLine(LINE, 'Oh, The quick brown fox')).toStrictEqual([
      { index: 4, text: 'Oh, The quick ' },
    ]);
  });

  it('does not let a repeated character make the changed span negative', () => {
    // `AA` → `AAA`: the prefix claims both characters and an uncapped suffix
    // would claim both again, describing a change of MINUS one character. The
    // cap is what makes the insertion land in one place instead.
    const doubled: readonly LineRun[] = [{ index: 1, text: 'AA' }];
    expect(replacementsForLine(doubled, 'AAA')).toStrictEqual([{ index: 1, text: 'AAA' }]);
  });

  it('names only the runs that changed when a deletion ends on a boundary', () => {
    // The deletion removes "quick " exactly, ending where run 9 begins. A
    // last-run search that took the run STARTING at the boundary would name
    // object 9 as well and rewrite it with the text it already had.
    expect(replacementsForLine(LINE, 'The brown fox')).toStrictEqual([
      { index: 4, text: 'The ' },
    ]);
  });

  it('reads the line as its runs joined, which is what the dialog shows', () => {
    expect(lineText(LINE)).toBe('The quick brown fox');
    expect(lineText([])).toBe('');
  });
});
