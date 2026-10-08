// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import type { CommandContext } from '../registries/commands.js';
import { registerEditor } from '../textEditorControl.js';
import { FORMAT_ENTRIES, textFormatCommands } from './textFormatCommands.js';

/**
 * The formatting commands are projections of one table, and each is wired when pressing it reaches the open editor
 * (`textEditorControl`) and never otherwise (the wired-tools rule).
 */

const COMMANDS = textFormatCommands();
const EDITING = { editingText: true } as CommandContext;
const IDLE = {} as CommandContext;

describe('the formatting commands', () => {
  it('are one command per entry of the table, with distinct ids', () => {
    expect(COMMANDS.map((command) => command.id)).toStrictEqual(FORMAT_ENTRIES.map((entry) => entry.id));
    expect(new Set(COMMANDS.map((command) => command.id)).size).toBe(COMMANDS.length);
  });

  it('are offered only while an editor is open, and every one keeps the focus in it', () => {
    for (const command of COMMANDS) {
      expect(command.when?.(EDITING)).toBe(true);
      // CONTROL: the same command is hidden on a page nobody is editing, so no control renders that does nothing.
      expect(command.when?.(IDLE)).toBe(false);
      expect(command.keepsFocus).toBe(true);
    }
  });

  it('act on the open editor: bold toggles through the editor, and with none open it does nothing', () => {
    const bold = COMMANDS.find((command) => command.id === 'text.format.bold');
    if (bold === undefined) throw new Error('no bold command');
    const root = document.createElement('div');
    const row = document.createElement('div');
    row.textContent = 'words';
    root.append(row);
    document.body.append(root);
    const range = document.createRange();
    range.selectNodeContents(row);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const unregister = registerEditor({ root, zoom: () => 1, block: { remove: () => undefined, nudge: () => undefined } });
    document.dispatchEvent(new Event('selectionchange'));
    void bold.run({} as never);
    expect(root.querySelector('[data-fmt]')?.getAttribute('data-fmt')).toBe('{"bold":true}');
    unregister();
    // CONTROL: once the editor is gone the same press formats nothing.
    const before = root.innerHTML;
    void bold.run({} as never);
    expect(root.innerHTML).toBe(before);
  });
});
