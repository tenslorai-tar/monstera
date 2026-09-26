import type { WindowEditAction } from '@monstera/contract';

import { EDIT_COPY_TITLE, EDIT_CUT_TITLE, EDIT_PASTE_TITLE, EDIT_SELECT_ALL_TITLE } from '../messages/en.js';
import type { CommandContext, UiCommand } from '../registries/commands.js';

/**
 * The Edit menu's clipboard verbs — *Cut*, *Copy*, *Paste* and *Select all* — acting on WHAT HAS FOCUS
 * ([ADR-0107](../../../../docs/DECISIONS/0107-the-menu-bar-is-a-projection.md), the owner's answer of 2026-09-26).
 *
 * ## Two subjects, in the owner's order
 *
 * A text FIELD first — an input, a text area, the in-place text editor: while one has the focus, or had it when the menu
 * bar took it (`typingFocus.ts`), each verb is the browser's own, run by main on the window (`window.edit`). Otherwise
 * the subject is the page: its selected text for *Copy*, the selected marks for *Cut* and *Copy*, main's copied marks
 * for *Paste*, and every mark on the page on show for *Select all*.
 *
 * ## Each page half is ANOTHER COMMAND'S, called rather than restated
 *
 * *Copy* on the page's text is `text.copy`, on marks `annotate.copy-selection`; *Paste* is `annotate.paste`; *Select
 * all* is `annotate.select-all`; the delete half of *Cut* is `annotate.delete-selection`. A second implementation here
 * would be a second opinion about what copying a mark means (B3a), so this file holds the ORDER of the subjects and
 * nothing else. Those commands gave their chords to these, since one key names one command.
 *
 * ## Cut is copy, then delete, and one Undo restores it
 *
 * The copy changes nothing in the document and the delete is one command, so one Undo brings the marks back. A copy
 * that failed stops the cut before anything is removed: a cut that deleted what it could not copy loses it.
 *
 * ## In a field the keys never reach these
 *
 * `fieldOwnsChord` leaves Ctrl+X, C, V and A to a focused field, which answers them itself; these run from the menu, and
 * from the keyboard on the page.
 */
export interface EditDeps {
  /** The text field that has the focus, or had it when the menu bar took it; `undefined` when none did. */
  readonly field: () => HTMLElement | undefined;
  /** Runs the browser's own verb on the window — `window.edit`. */
  readonly native: (action: WindowEditAction) => void;
  /** The page's halves: the commands that already own them. */
  readonly copyText: UiCommand;
  readonly copyMarks: UiCommand;
  /** `annotate.copy-selection`'s copy, answering whether it copied — what the cut waits on. */
  readonly copyMarksFor: (context: CommandContext) => Promise<boolean>;
  readonly deleteMarks: UiCommand;
  readonly pasteMarks: UiCommand;
  readonly selectAllMarks: UiCommand;
}

/** Whether a field has text selected in it — what *Cut* and *Copy* in a field need. */
function selectsText(field: HTMLElement): boolean {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    return field.selectionStart !== field.selectionEnd;
  }
  const selection = field.ownerDocument.getSelection();
  return selection !== null && !selection.isCollapsed && field.contains(selection.anchorNode);
}

const can = (command: UiCommand, context: CommandContext): boolean => command.when?.(context) ?? true;

/** Returns the focus to the field, then runs the browser's verb there. */
function inField(deps: EditDeps, field: HTMLElement, action: WindowEditAction): void {
  field.focus();
  deps.native(action);
}

export function editCommands(deps: EditDeps): readonly UiCommand[] {
  const cut: UiCommand = {
    id: 'edit.cut',
    title: EDIT_CUT_TITLE,
    icon: 'Scissors',
    shortcut: 'Ctrl+X',
    placements: [{ surface: 'menu-bar', menu: 'edit', group: 1, order: 10 }],
    when: (context) => {
      const field = deps.field();
      return field === undefined ? can(deps.copyMarks, context) && can(deps.deleteMarks, context) : selectsText(field);
    },
    run: async (context): Promise<void> => {
      const field = deps.field();
      if (field !== undefined) {
        inField(deps, field, 'cut');
        return;
      }
      if (await deps.copyMarksFor(context)) await deps.deleteMarks.run(context);
    },
  };
  const copy: UiCommand = {
    id: 'edit.copy',
    title: EDIT_COPY_TITLE,
    icon: 'Copy',
    shortcut: 'Ctrl+C',
    placements: [{ surface: 'menu-bar', menu: 'edit', group: 1, order: 20 }],
    when: (context) => {
      const field = deps.field();
      if (field !== undefined) return selectsText(field);
      return can(deps.copyText, context) || can(deps.copyMarks, context);
    },
    run: async (context): Promise<void> => {
      const field = deps.field();
      if (field !== undefined) {
        inField(deps, field, 'copy');
        return;
      }
      // THE PAGE'S TEXT FIRST: text selected on the page is what a person just did, and a mark selection lasts only
      // while the select tool is on.
      await (can(deps.copyText, context) ? deps.copyText : deps.copyMarks).run(context);
    },
  };
  const paste: UiCommand = {
    id: 'edit.paste',
    title: EDIT_PASTE_TITLE,
    shortcut: 'Ctrl+V',
    placements: [{ surface: 'menu-bar', menu: 'edit', group: 1, order: 30 }],
    // A FIELD IS ALWAYS PASTABLE: the renderer may not read the clipboard (§2), so whether it holds text is not known
    // here, and pasting nothing into a field changes nothing.
    when: (context) => deps.field() !== undefined || can(deps.pasteMarks, context),
    run: async (context): Promise<void> => {
      const field = deps.field();
      if (field !== undefined) {
        inField(deps, field, 'paste');
        return;
      }
      await deps.pasteMarks.run(context);
    },
  };
  const selectAll: UiCommand = {
    id: 'edit.select-all',
    title: EDIT_SELECT_ALL_TITLE,
    shortcut: 'Ctrl+A',
    placements: [{ surface: 'menu-bar', menu: 'edit', group: 1, order: 40 }],
    when: (context) => deps.field() !== undefined || can(deps.selectAllMarks, context),
    run: async (context): Promise<void> => {
      const field = deps.field();
      if (field !== undefined) {
        inField(deps, field, 'selectAll');
        return;
      }
      await deps.selectAllMarks.run(context);
    },
  };
  return [cut, copy, paste, selectAll];
}
