import { MAX_TEXT_RUN_CHARS, MAX_TEXT_RUNS } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { WRITE_TEXT_BOX_LABEL, WRITE_TOO_LONG } from './messages/en.js';
import { type WriteEnd, type WriteRequest, draftOf, runsFit, settle, styledRunsFor } from './pageWriting.js';

/**
 * How a request for words on the page ends (ADR-0154 Decision 1 and its correction): one rule the editor, the
 * application and these cases read, so a key that means *finish* in one place cannot mean *abandon* in another.
 */

const REFUSED = WRITE_TOO_LONG;

const BLOCK: WriteRequest = {
  page: 0,
  box: { x0: 10, y0: 20, x1: 110, y1: 60 },
  shape: 'block',
  initial: '',
  label: WRITE_TEXT_BOX_LABEL,
};

/** A line whose rule refuses anything but `https://` — the shape of a link address's. */
const LINE: WriteRequest = {
  ...BLOCK,
  shape: 'line',
  check: (text) => (text.startsWith('https://') ? undefined : REFUSED),
};

const EVERY_END: readonly WriteEnd[] = ['escape', 'enter', 'outside', 'replaced'];

describe('settle', () => {
  it('a BLOCK keeps its words however it ends — Escape and a click outside FINISH, the owner’s words', () => {
    expect(EVERY_END.map((end) => settle(BLOCK, 'see figure 3', end))).toStrictEqual(
      EVERY_END.map(() => ({ stays: false, answer: 'see figure 3' })),
    );
  });

  it('a block with NOTHING TYPED answers nothing at every end, an edit included — a comment is never emptied', () => {
    const edit: WriteRequest = { ...BLOCK, initial: 'what the mark said' };
    for (const request of [BLOCK, edit]) {
      expect(EVERY_END.map((end) => settle(request, '  \n ', end))).toStrictEqual(
        EVERY_END.map(() => ({ stays: false, answer: undefined })),
      );
    }
  });

  it('a block its rule REFUSES stays open at every end a person chose, and only a replacement takes it', () => {
    // PRESERVE, NEVER DROP: finishing could only throw the words away, so Escape and a click outside keep the box
    // open with its message. A second request is the one ending that cannot wait for the person.
    const ruled: WriteRequest = { ...BLOCK, check: () => REFUSED };
    expect(EVERY_END.map((end) => settle(ruled, 'far too much', end))).toStrictEqual([
      { stays: true },
      { stays: true },
      { stays: true },
      { stays: false, answer: undefined },
    ]);
  });

  it('a LINE commits words its rule passes at Enter, a click outside and a replacement, and Escape abandons them', () => {
    expect(EVERY_END.map((end) => settle(LINE, 'https://example.com', end))).toStrictEqual([
      { stays: false, answer: undefined },
      { stays: false, answer: 'https://example.com' },
      { stays: false, answer: 'https://example.com' },
      { stays: false, answer: 'https://example.com' },
    ]);
  });

  it('CONTROL: a line its rule REFUSES stays open at Enter only — elsewhere it is abandoned, never committed', () => {
    // The case above is what makes this one mean something: the same request commits at those ends once the rule
    // passes, so an answer of `undefined` here is the rule's doing and not the ending's.
    expect(EVERY_END.map((end) => settle(LINE, 'example.com', end))).toStrictEqual([
      { stays: false, answer: undefined },
      { stays: true },
      { stays: false, answer: undefined },
      { stays: false, answer: undefined },
    ]);
  });
});

describe('draftOf', () => {
  it('starts from the words it was given and reads back the last ones kept', () => {
    const draft = draftOf('what the mark said');
    expect(draft.read()).toBe('what the mark said');
    draft.keep('what the mark says now');
    expect(draft.read()).toBe('what the mark says now');
  });

  it('CONTROL: two drafts are two cells — keeping words in one leaves the other as it was', () => {
    const first = draftOf('');
    const second = draftOf('');
    first.keep('typed into the first');
    expect(second.read()).toBe('');
  });
});

describe('words styled one by one while typed (B5.8)', () => {
  it('the runs are cut where the answer was trimmed, each keeping its style', () => {
    expect(styledRunsFor('Plain bold', [{ text: '  Plain ' }, { text: 'bold', bold: true }, { text: ' \n' }])).toStrictEqual([
      { text: 'Plain ' },
      { text: 'bold', bold: true },
    ]);
  });

  it('CONTROL: runs that say no style are the plain words, which a command carries as its text alone', () => {
    expect(styledRunsFor('Plain words', [{ text: 'Plain ' }, { text: 'words' }])).toBeUndefined();
  });

  it('runs that do not make the answered words are not sent: another box’s styles are never put on these words', () => {
    expect(styledRunsFor('Other words', [{ text: 'Plain ' }, { text: 'bold', bold: true }])).toBeUndefined();
  });

  it('a run past the wire’s bound is sent as pieces in its style, and never cut inside a character', () => {
    const long = '𝒜'.repeat(MAX_TEXT_RUN_CHARS);
    const runs = styledRunsFor(long, [{ text: long, italic: true }]) ?? [];
    expect(runs.map((run) => run.text).join('')).toBe(long);
    expect(runs.every((run) => run.italic === true && run.text.length <= MAX_TEXT_RUN_CHARS)).toBe(true);
    // A SURROGATE PAIR WHOLE in every piece: an even number of units, each starting on the pair's first half.
    expect(runs.every((run) => run.text.length % 2 === 0 && run.text.codePointAt(0) === 0x1d49c)).toBe(true);
  });

  it('the bound is the wire’s, counted in pieces: one run more than a box carries does not fit', () => {
    const many = Array.from({ length: MAX_TEXT_RUNS + 1 }, (_, at) => ({ text: `w${String(at)} `, bold: at % 2 === 0 }));
    expect(runsFit(many)).toBe(false);
    expect(runsFit(many.slice(0, MAX_TEXT_RUNS))).toBe(true);
    // PLAIN WORDS ARE NO RUNS AT ALL, however many pieces they would be.
    expect(runsFit(many.map(({ text }) => ({ text })))).toBe(true);
  });
});
