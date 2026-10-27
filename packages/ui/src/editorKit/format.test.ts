import { describe, expect, it } from 'vitest';

import { format, INDENT_STEP } from './format.js';
import { type Model, type Paragraph, type ParagraphSetting, type RunStyle, type Selection, caret, modelText } from './model.js';
import { createEditorStore } from './store.js';

/**
 * The kit's paragraph operations through the one `format` path a chord, the ribbon and the Properties panel take
 * (ADR-0271 section 3): a list toggled on and off, an indent stepped, the space after and the line spacing set and put
 * back. Each case's fixture holds a paragraph OUTSIDE the selection and a base that differs from every constant a broken
 * operation could fall back to, so an end state the absent decision would also produce separates nothing.
 */

const BODY: RunStyle = {
  face: 'Body',
  size: 10,
  colour: { r: 0, g: 0, b: 0 },
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  rise: 'none',
  lift: 0,
  spacing: 0,
  highlight: null,
};

/** The page's own setting for every paragraph here: nothing in it is a default a broken operation could return to. */
const PAGE: ParagraphSetting = { align: 'left', lineSpacing: 1.2, spaceBefore: 0, spaceAfter: 4, firstIndent: 6, leftIndent: 10 };
const paragraph = (text: string): Paragraph => ({ ...PAGE, base: PAGE, runs: [{ text, style: BODY }] });

/** Three paragraphs; the cases select the first two, so the third is the control that no operation reaches. */
const MODEL: Model = { paragraphs: [paragraph('one'), paragraph('two'), paragraph('three')] };
const FIRST_TWO: Selection = { anchor: { paragraph: 0, offset: 1 }, focus: { paragraph: 1, offset: 2 } };

const open = (selection: Selection = FIRST_TWO) => createEditorStore({ model: MODEL, selection });
const settings = (model: Model, key: keyof ParagraphSetting) => model.paragraphs.map((each) => each[key]);

describe('the editor kit’s paragraph operations', () => {
  it('a bullet list begins each selected paragraph with a bullet, hung by one step, and toggled again is taken off back to the page’s indents', () => {
    const store = open();
    expect(format(store, { kind: 'list', list: 'bullet' })).toBe(true);
    const listed = store.get().model;
    expect(modelText(listed)).toBe('• one\n• two\nthree');
    expect(settings(listed, 'leftIndent')).toStrictEqual([INDENT_STEP, INDENT_STEP, PAGE.leftIndent]);
    expect(settings(listed, 'firstIndent')).toStrictEqual([-INDENT_STEP, -INDENT_STEP, PAGE.firstIndent]);
    // THE SELECTION MOVES WITH THE WORDS the markers shifted: still on the same letters, two along.
    expect(store.get().selection).toStrictEqual({ anchor: { paragraph: 0, offset: 3 }, focus: { paragraph: 1, offset: 4 } });
    format(store, { kind: 'list', list: 'bullet' });
    const unlisted = store.get().model;
    // THE DECISION: every paragraph already a bullet, so the same toggle takes them off rather than stacking a second.
    expect(modelText(unlisted)).toBe('one\ntwo\nthree');
    // BACK TO THE PAGE'S OWN INDENTS, 10 and 6, not to none.
    expect(settings(unlisted, 'leftIndent')).toStrictEqual([PAGE.leftIndent, PAGE.leftIndent, PAGE.leftIndent]);
    expect(settings(unlisted, 'firstIndent')).toStrictEqual([PAGE.firstIndent, PAGE.firstIndent, PAGE.firstIndent]);
  });

  it('a numbered list over a bullet list REPLACES the bullets, numbered from the first selected paragraph', () => {
    const store = open();
    format(store, { kind: 'list', list: 'bullet' });
    format(store, { kind: 'list', list: 'number' });
    expect(modelText(store.get().model)).toBe('1. one\n2. two\nthree');
  });

  it('a list over a selection that is only PARTLY a list makes all of it one, rather than taking the listed part off', () => {
    const store = createEditorStore({ model: MODEL, selection: caret({ paragraph: 0, offset: 0 }) });
    format(store, { kind: 'list', list: 'bullet' });
    expect(modelText(store.get().model)).toBe('• one\ntwo\nthree');
    store.select(FIRST_TWO);
    format(store, { kind: 'list', list: 'bullet' });
    expect(modelText(store.get().model)).toBe('• one\n• two\nthree');
  });

  it('indent steps every selected paragraph by one step a time, and outdent never takes it below none', () => {
    const store = open();
    format(store, { kind: 'indent', steps: 2 });
    expect(settings(store.get().model, 'leftIndent')).toStrictEqual([PAGE.leftIndent + 2 * INDENT_STEP, PAGE.leftIndent + 2 * INDENT_STEP, PAGE.leftIndent]);
    format(store, { kind: 'indent', steps: -1 });
    expect(settings(store.get().model, 'leftIndent')).toStrictEqual([PAGE.leftIndent + INDENT_STEP, PAGE.leftIndent + INDENT_STEP, PAGE.leftIndent]);
    format(store, { kind: 'indent', steps: -5 });
    expect(settings(store.get().model, 'leftIndent')).toStrictEqual([0, 0, PAGE.leftIndent]);
  });

  it('space after is set on the selected paragraphs, and none puts back the PAGE’S space, not zero', () => {
    const store = open();
    format(store, { kind: 'space-after', points: 12 });
    expect(settings(store.get().model, 'spaceAfter')).toStrictEqual([12, 12, PAGE.spaceAfter]);
    format(store, { kind: 'space-after', points: null });
    expect(settings(store.get().model, 'spaceAfter')).toStrictEqual([PAGE.spaceAfter, PAGE.spaceAfter, PAGE.spaceAfter]);
  });

  it('line spacing is set on the selected paragraphs, and none puts back the PAGE’S spacing, not single', () => {
    const store = open();
    format(store, { kind: 'spacing', lineSpacing: 2 });
    expect(settings(store.get().model, 'lineSpacing')).toStrictEqual([2, 2, PAGE.lineSpacing]);
    format(store, { kind: 'spacing', lineSpacing: null });
    expect(settings(store.get().model, 'lineSpacing')).toStrictEqual([PAGE.lineSpacing, PAGE.lineSpacing, PAGE.lineSpacing]);
  });

  it('with a caret, a paragraph operation acts on the caret’s paragraph at once and is one step of undo', () => {
    const store = createEditorStore({ model: MODEL, selection: caret({ paragraph: 1, offset: 1 }) });
    format(store, { kind: 'space-after', points: 12 });
    // NOT A PENDING STYLE, as a letter style at a caret is: the paragraph itself changed.
    expect(store.get().pending).toBeUndefined();
    expect(settings(store.get().model, 'spaceAfter')).toStrictEqual([PAGE.spaceAfter, 12, PAGE.spaceAfter]);
    expect(store.undo()).toBe(true);
    expect(store.get().model).toBe(MODEL);
  });
});
