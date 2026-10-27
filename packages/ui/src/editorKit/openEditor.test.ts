import { describe, expect, it } from 'vitest';

import { applyStyle, caret, insertText, type Model, type RunStyle } from './model.js';
import { onEditorChange, openEditorSnapshot, registerEditor } from './openEditor.js';
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

/** An editor open over `MODEL`, its caret at the end, and a count of what its subscribers were told. */
function opened() {
  const store = createEditorStore({ model: MODEL, selection: caret({ paragraph: 0, offset: 5 }) });
  const close = registerEditor({ store, root: () => null, block: { remove: () => undefined, nudge: () => undefined }, finish: () => undefined, fonts: [] });
  let told = 0;
  const stop = onEditorChange(() => {
    told += 1;
  });
  return {
    store,
    told: () => told,
    done: () => {
      stop();
      close();
    },
  };
}

describe('the open editor’s announcements (ADR-0274’s measurement)', () => {
  it('tells its subscribers NOTHING over twenty letters typed in one style, and the snapshot stays one object', () => {
    const editor = opened();
    const before = openEditorSnapshot();
    for (let key = 0; key < 20; key += 1) {
      const { model, selection, pending } = editor.store.get();
      editor.store.change(insertText(model, selection, 'a', pending), 'typing', 'a');
    }
    // ZERO, where every key announced before: the Properties panel re-rendered and every command's `when` was asked again.
    expect(editor.told()).toBe(0);
    expect(openEditorSnapshot()).toBe(before);
    editor.done();
  });

  it('CONTROL: a change a subscriber shows, the words at the caret made bold, is told once and gives a new snapshot', () => {
    const editor = opened();
    const before = openEditorSnapshot();
    const { model } = editor.store.get();
    const all = { anchor: { paragraph: 0, offset: 0 }, focus: { paragraph: 0, offset: 5 } };
    editor.store.change(applyStyle(model, all, { bold: true }), 'other');
    expect(editor.told()).toBe(1);
    expect(openEditorSnapshot()).not.toBe(before);
    expect(openEditorSnapshot().state?.bold).not.toBe(before.state?.bold);
    editor.done();
  });
});
