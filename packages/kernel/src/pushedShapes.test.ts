import { describe, expect, it } from 'vitest';

import { foundBox } from './drawnObjectEdit.js';
import { type PageRuns, checkOperatorEdit, editOperators } from './operatorEdit.js';
import type { PageFont } from './pageFonts.js';
import { sitsWithLine } from './pushedShapes.js';
import { drawnObjects, showOperators } from './textOperators.js';

/**
 * ADR-0249's correction of 2026-10-26 (the owner's L1): when a paragraph grows and pushes a bulleted list down, every
 * bullet moves with its item. The bullets here are the three kinds a page draws them as: (a) a text object of its own in
 * another font, (b) a filled square path, as the owner's document 2 draws them, and (c) a character in the item's own
 * text object. The CONTROL is a drawing taller than a line beside the list, which is no line's and stays.
 */

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A font where every code from 97 draws `characters` in order and is half an em wide. */
function font(resource: string, characters: string): PageFont {
  const text = new Map(Array.from(characters, (character, at) => [97 + at, character]));
  text.set(32, ' ');
  return {
    resource,
    subtype: 'TrueType',
    toUnicode: { text, bytes: 1 },
    codeBytes: 1,
    width: (code) => (text.has(code) ? 0.5 : null),
    draws: (code) => text.has(code),
    face: 'Face',
    weight: 400,
  };
}

const FONTS = new Map([
  ['F1', font('F1', 'abcdefghijklmnopqrstuvwxyz')],
  ['F2', font('F2', '•')],
]);

/** A run as PDFium reads it: its object, the object's words, and its ink in user space. */
interface Ink {
  readonly object: number;
  readonly text: string;
  readonly left: number;
  readonly right: number;
  readonly baseline: number;
}
const runOf = (ink: Ink & { readonly members?: readonly number[] }): PageRuns['runs'][number] => ({
  index: ink.object,
  members: ink.members ?? [ink.object],
  text: ink.text,
  left: ink.left,
  right: ink.right,
  bottom: ink.baseline - 2,
  top: ink.baseline + 7,
});

/** The paragraph that grows: one line of three letters at 72, 700, size 10, its measure the letters' own 15 points. */
const PARAGRAPH = 'BT /F1 10 Tf 1 0 0 1 72 700 Tm (abc) Tj ET';
/** Where the list's one item's words stand. */
const ITEM_BASELINE = 600;

/**
 * The page and PDFium's reading of it: one text object per show operator, as PDFium makes them, numbered in order (no
 * drawing is numbered among them here, since `textObjects` maps text objects to page objects and these cases name text).
 */
function grown(list: string, runs: readonly (Ink & { readonly members?: readonly number[] })[]): { content: Uint8Array; read: PageRuns } {
  const content = bytes(`${PARAGRAPH}\n${list}`);
  const textObjects = showOperators(content).map((_, at) => at);
  return { content, read: { textObjects, runs: runs.map(runOf) } };
}

/** Where every drawn object of `content` is, by kind, in user space. */
const boxesOf = (content: Uint8Array) => drawnObjects(content, () => undefined).map((object) => ({ kind: object.kind, box: foundBox(object) }));

/** The y of each text operator's origin that shows `code`, through its text matrix and CTM. */
const originsOf = (content: Uint8Array, resource: string): number[] =>
  showOperators(content)
    .filter((op) => op.state.font === resource && op.codes.length > 0)
    .map((op) => op.state.matrix[5] * op.state.ctm[3] + op.state.ctm[5]);

function edit(content: Uint8Array, read: PageRuns, item: readonly (readonly number[])[], itemText: string) {
  const made = editOperators(
    content,
    FONTS,
    read,
    [
      { lines: [[0]], soft: [false], text: 'abc abc abc' },
      { lines: item, soft: item.map(() => false), text: itemText, push: { by: 0, room: 200 } },
    ],
  );
  if (!made.ok) throw new Error(`refused: ${JSON.stringify(made.error)}`);
  expect(checkOperatorEdit(content, made.value, FONTS)).toStrictEqual({ ok: true, value: undefined });
  const down = made.value.moved[0]?.down ?? 0;
  // NOT VACUOUS: the item did move, so a bullet that stayed is a bullet left behind.
  expect(down).toBeGreaterThan(0);
  return { after: made.value.content, down };
}

describe('a bullet moves with its item when the paragraph above grows (ADR-0249, 2026-10-26)', () => {
  it('(b) a bullet drawn as a filled square path', () => {
    const { content, read } = grown(
      [`q 0 g 77 ${String(ITEM_BASELINE + 1)} 3 3 re f Q`, `BT /F1 10 Tf 1 0 0 1 90 ${String(ITEM_BASELINE)} Tm (def) Tj ET`].join('\n'),
      [
        { object: 0, text: 'abc', left: 72, right: 87, baseline: 700 },
        { object: 1, text: 'def', left: 90, right: 105, baseline: ITEM_BASELINE },
      ],
    );
    const { after, down } = edit(content, read, [[1]], 'def');
    const bullet = boxesOf(after).find((each) => each.kind === 'path')?.box;
    expect(bullet?.bottom).toBeCloseTo(ITEM_BASELINE + 1 - down, 3);
    expect(originsOf(after, 'F1').at(-1)).toBeCloseTo(ITEM_BASELINE - down, 3);
  });

  it('(a) a bullet that is a text object of its own, in another font, on the item’s line', () => {
    const { content, read } = grown(
      [`BT /F2 10 Tf 1 0 0 1 77 ${String(ITEM_BASELINE)} Tm (a) Tj ET`, `BT /F1 10 Tf 1 0 0 1 90 ${String(ITEM_BASELINE)} Tm (def) Tj ET`].join('\n'),
      [
        { object: 0, text: 'abc', left: 72, right: 87, baseline: 700 },
        { object: 1, text: '•', left: 77, right: 82, baseline: ITEM_BASELINE },
        { object: 2, text: 'def', left: 90, right: 105, baseline: ITEM_BASELINE },
      ],
    );
    // THE BULLET IS A RUN OF THE ITEM'S LINE, as `main` groups a run on its baseline: the item's block names it.
    const { after, down } = edit(content, read, [[1, 2]], '•def');
    expect(originsOf(after, 'F2').at(-1)).toBeCloseTo(ITEM_BASELINE - down, 3);
    expect(originsOf(after, 'F1').at(-1)).toBeCloseTo(ITEM_BASELINE - down, 3);
  });

  it('(c) a bullet in the item’s own text object', () => {
    const { content, read } = grown(
      `BT /F2 10 Tf 1 0 0 1 77 ${String(ITEM_BASELINE)} Tm (a) Tj /F1 10 Tf 13 0 Td (def) Tj ET`,
      [
        { object: 0, text: 'abc', left: 72, right: 87, baseline: 700 },
        { object: 1, members: [1, 2], text: '•def', left: 77, right: 105, baseline: ITEM_BASELINE },
      ],
    );
    const { after, down } = edit(content, read, [[1]], '•def');
    expect(originsOf(after, 'F2').at(-1)).toBeCloseTo(ITEM_BASELINE - down, 3);
  });

  it('CONTROL: a drawing taller than a line, beside the list, is no line’s and stays', () => {
    const { content, read } = grown(
      [`q 0 g 77 ${String(ITEM_BASELINE - 20)} 3 40 re f Q`, `BT /F1 10 Tf 1 0 0 1 90 ${String(ITEM_BASELINE)} Tm (def) Tj ET`].join('\n'),
      [
        { object: 0, text: 'abc', left: 72, right: 87, baseline: 700 },
        { object: 1, text: 'def', left: 90, right: 105, baseline: ITEM_BASELINE },
      ],
    );
    const { after } = edit(content, read, [[1]], 'def');
    expect(boxesOf(after).find((each) => each.kind === 'path')?.box?.bottom).toBeCloseTo(ITEM_BASELINE - 20, 3);
  });
});

describe('which drawing sits with a line', () => {
  const line = { baseline: 600, size: 10, left: 72, right: 300 };
  it('a bullet and a rule under the words are on the line', () => {
    expect(sitsWithLine({ left: 77, bottom: 601, right: 80, top: 604 }, line)).toBe(true);
    expect(sitsWithLine({ left: 90, bottom: 598.2, right: 140, top: 599 }, line)).toBe(true);
  });
  it('CONTROL: a drawing reaching past the band, or outside the column, is not', () => {
    expect(sitsWithLine({ left: 77, bottom: 580, right: 80, top: 620 }, line)).toBe(false);
    expect(sitsWithLine({ left: 400, bottom: 601, right: 403, top: 604 }, line)).toBe(false);
  });
});
