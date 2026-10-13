// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';

import { openEditorState, registerEditor } from './textEditorControl.js';

/**
 * What the open editor says of the words at its selection (`openEditorState`), which every value field of the Text section
 * shows. These cases hold the selections that have no letter in them (W4), where the state used to be nothing at all.
 */

let unregister: (() => void) | undefined;
afterEach(() => {
  unregister?.();
  unregister = undefined;
  document.body.replaceChildren();
});

/** An editor whose words are `lines`, each a run of `size` points; an empty string is an empty run, as a new box has. */
function editorOf(lines: readonly string[], size = 12): HTMLElement {
  const root = document.createElement('div');
  for (const words of lines) {
    const row = document.createElement('div');
    row.className = 'm-text-editor__line';
    const run = document.createElement('span');
    run.className = 'm-text-editor__run';
    run.dataset['size'] = String(size);
    run.style.fontWeight = '400';
    run.textContent = words;
    row.append(run);
    if (words === '') row.append(document.createElement('br'));
    root.append(row);
  }
  document.body.append(root);
  unregister = registerEditor({
    root,
    zoom: () => 1,
    block: { remove: () => undefined, nudge: () => undefined },
    finish: () => undefined,
    fonts: [],
  });
  return root;
}

function caretAt(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe('openEditorState', () => {
  it('W4: a new box with no letter yet says its run’s size, from a caret in its line as the editor puts it', () => {
    const root = editorOf([''], 12);
    const line = root.firstElementChild;
    if (line === null) throw new Error('no line');
    caretAt(line, 0);
    expect(openEditorState()?.size).toBe(12);
  });

  it('W4: and from a caret at the editor itself, which a line holds no letter of either', () => {
    const root = editorOf([''], 9);
    caretAt(root, 0);
    expect(openEditorState()?.size).toBe(9);
  });

  it('W4: words typed beside the empty run, in no run, say the block’s size, which the editor root carries', () => {
    const root = editorOf([''], 11);
    root.dataset['size'] = '11';
    const line = root.firstElementChild;
    if (line === null) throw new Error('no line');
    // WHERE CHROMIUM PUTS THE FIRST KEYS of a new box: a text node in the line, before the empty run.
    const typed = document.createTextNode('Now words');
    line.prepend(typed);
    caretAt(typed, 3);
    expect(openEditorState()?.size).toBe(11);
    // CONTROL: the same words with no block size on the root say none, so the 11 above is the root's and not a default.
    delete root.dataset['size'];
    caretAt(typed, 4);
    expect(openEditorState()?.size).toBeUndefined();
  });

  it('CONTROL: with words at the caret, their own run says the size, so the fallback is not what answers', () => {
    const root = editorOf(['first line', ''], 14);
    // THE SECOND LINE IS EMPTY AT 14 TOO; the first is read, as the paragraph the caret is in.
    const words = root.firstElementChild?.firstElementChild?.firstChild;
    if (words === null || words === undefined) throw new Error('no words');
    caretAt(words, 3);
    expect(openEditorState()?.size).toBe(14);
  });
});
