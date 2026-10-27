import { describe, expect, it } from 'vitest';

import { applyStyle, caret, insertText, modelText, type Model, type RunStyle } from './model.js';
import { createEditorStore } from './store.js';

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
const SET = { align: 'left', lineSpacing: 1, spaceBefore: 0, spaceAfter: 0, firstIndent: 0, leftIndent: 0 } as const;
const MODEL: Model = { paragraphs: [{ ...SET, runs: [{ text: 'Seeds', style: BODY }] }] };

/** Types `text` a letter at a time at the caret, as keys do. */
function type(store: ReturnType<typeof createEditorStore>, text: string): void {
  for (const letter of text) {
    const { model, selection, pending } = store.get();
    store.change(insertText(model, selection, letter, pending), 'typing', letter);
  }
}

describe('the editor kit store', () => {
  it('undoes typing a word at a time, and redoes it', () => {
    const store = createEditorStore({ model: MODEL, selection: caret({ paragraph: 0, offset: 5 }) });
    type(store, ' and bulbs');
    expect(modelText(store.get().model)).toBe('Seeds and bulbs');
    store.undo();
    expect(modelText(store.get().model)).toBe('Seeds and ');
    store.undo();
    expect(modelText(store.get().model)).toBe('Seeds ');
    store.redo();
    expect(modelText(store.get().model)).toBe('Seeds and ');
  });

  it('keeps the same format object while what it says is the same, and a new one when it changes', () => {
    const store = createEditorStore({ model: MODEL, selection: caret({ paragraph: 0, offset: 1 }) });
    const first = store.format();
    store.select(caret({ paragraph: 0, offset: 3 }));
    // THE IDENTITY is what `useSyncExternalStore` compares: an equal answer kept as a new object renders every
    // subscribed control on every caret move.
    expect(store.format()).toBe(first);
    const { model } = store.get();
    store.change(applyStyle(model, { anchor: { paragraph: 0, offset: 0 }, focus: { paragraph: 0, offset: 5 } }, { bold: true }), 'other');
    expect(store.format()).not.toBe(first);
    expect(store.format().bold).toBe('on');
  });

  it('tells its subscribers of every change, and stops when asked', () => {
    const store = createEditorStore({ model: MODEL, selection: caret({ paragraph: 0, offset: 5 }) });
    let heard = 0;
    const stop = store.subscribe(() => {
      heard += 1;
    });
    type(store, 'x');
    stop();
    type(store, 'y');
    expect(heard).toBe(1);
  });

  it('types the pending style the person chose, and drops it when the caret moves', () => {
    const store = createEditorStore({ model: MODEL, selection: caret({ paragraph: 0, offset: 5 }) });
    store.setPending({ ...BODY, bold: true });
    expect(store.format().bold).toBe('on');
    type(store, 'X');
    expect(store.get().model.paragraphs[0]?.runs.map((run) => run.style.bold)).toEqual([false, true]);
    store.select(caret({ paragraph: 0, offset: 1 }));
    expect(store.get().pending).toBeUndefined();
  });

  it('says whether the words or their styles differ from those it opened with', () => {
    const store = createEditorStore({ model: MODEL, selection: caret({ paragraph: 0, offset: 5 }) });
    expect(store.changed()).toBe(false);
    type(store, 's');
    expect(store.changed()).toBe(true);
    store.undo();
    expect(store.changed()).toBe(false);
  });
});
