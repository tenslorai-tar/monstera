import { describe, expect, it } from 'vitest';

import { modelOfBlock, editOf } from '../editText/blockModel.js';
import { wholeBlock } from '../editorKit/model.js';
import { registerEditor } from '../editorKit/openEditor.js';
import { createEditorStore } from '../editorKit/store.js';
import type { CommandContext } from '../registries/commands.js';
import type { TextBlock } from '../textBlock.js';
import { FORMAT_ENTRIES, textFormatCommands } from './textFormatCommands.js';

/**
 * The formatting commands are projections of one table, and each is wired when pressing it reaches the open editor
 * (`editorKit/openEditor.ts`) and never otherwise (the wired-tools rule).
 */

const COMMANDS = textFormatCommands();
const EDITING = { editingText: true } as CommandContext;
const IDLE = {} as CommandContext;

const STYLE = { size: 11, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false };
const BOX = { x0: 72, y0: 686, x1: 300, y1: 700 };
const WORDS: TextBlock = {
  box: BOX,
  lines: [{ runs: [{ index: 1, text: 'words', style: STYLE }], box: BOX, soft: false, baseline: 689 }],
  style: STYLE,
  shape: { align: 'left', firstIndent: 0 },
  push: { below: [], room: 0 },
};

/** An open editor over the one block, its whole words selected, as the box is when first pressed. */
function openOver() {
  const { model } = modelOfBlock(WORDS);
  const store = createEditorStore({ model, selection: wholeBlock(model) });
  const unregister = registerEditor({
    store,
    root: () => null,
    block: { remove: () => undefined, nudge: () => undefined },
    finish: () => undefined,
    fonts: [],
  });
  return { store, unregister };
}

function command(id: string) {
  const found = COMMANDS.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no ${id} command`);
  return found;
}

describe('the formatting commands', () => {
  it('are one command per entry of the table, with distinct ids', () => {
    expect(COMMANDS.map((each) => each.id)).toStrictEqual(FORMAT_ENTRIES.map((entry) => entry.id));
    expect(new Set(COMMANDS.map((each) => each.id)).size).toBe(COMMANDS.length);
  });

  it('are offered only while an editor is open, and every one keeps the focus in it', () => {
    for (const each of COMMANDS) {
      expect(each.when?.(EDITING)).toBe(true);
      // CONTROL: the same command is hidden on a page nobody is editing, so no control renders that does nothing.
      expect(each.when?.(IDLE)).toBe(false);
      expect(each.keepsFocus).toBe(true);
    }
  });

  it('act on the open editor: bold toggles through the editor, and with none open it does nothing', () => {
    const { store, unregister } = openOver();
    void command('text.format.bold').run({} as never);
    expect(editOf(store.get().model).formatting).toStrictEqual({ marks: [{ from: 0, to: 5, set: { bold: true } }] });
    // THE BUTTON SHOWS IT AT ONCE, from the subscribed state, with nothing rendered again.
    expect(command('text.format.bold').checked?.(EDITING)).toBe(true);
    unregister();
    // CONTROL: once the editor is gone the same press formats nothing, and nothing shows pressed.
    const before = store.get().model;
    void command('text.format.bold').run({} as never);
    expect(store.get().model).toBe(before);
    expect(command('text.format.bold').checked?.(EDITING)).toBe(false);
  });

  it('strikethrough marks the words and justify sets the paragraph, through the open editor (ADR-0228)', () => {
    const { store, unregister } = openOver();
    void command('text.format.strike').run({} as never);
    void command('text.format.align-justify').run({} as never);
    expect(editOf(store.get().model).formatting).toStrictEqual({
      marks: [{ from: 0, to: 5, set: { strike: true } }],
      paragraphs: [{ paragraph: 0, align: 'justify' }],
    });
    // THE STRIKE IS A TOGGLE: pressed again over struck words it takes the line off.
    expect(command('text.format.strike').checked?.(EDITING)).toBe(true);
    void command('text.format.strike').run({} as never);
    // THE WORDS ARE NOT STRUCK, and were not before, so no mark is sent (VVVVVVV-16): the button reads them unstruck.
    expect(editOf(store.get().model).formatting.marks).toBeUndefined();
    expect(command('text.format.strike').checked?.(EDITING)).toBe(false);
    unregister();
  });
});
