import type { IconName } from '../primitives/icons.js';
import {
  GROUP_FORMAT,
  TEXT_FORMAT_ALIGN_CENTER,
  TEXT_FORMAT_ALIGN_LEFT,
  TEXT_FORMAT_ALIGN_RIGHT,
  TEXT_FORMAT_BOLD,
  TEXT_FORMAT_BULLETS,
  TEXT_FORMAT_INDENT_LESS,
  TEXT_FORMAT_INDENT_MORE,
  TEXT_FORMAT_ITALIC,
  TEXT_FORMAT_NUMBERING,
  TEXT_FORMAT_SUBSCRIPT,
  TEXT_FORMAT_SUPERSCRIPT,
  TEXT_FORMAT_UNDERLINE,
} from '../messages/en.js';
import { type CommandContext, type UiCommand, VISIBLE } from '../registries/commands.js';
import { type FormatAction, formatOpenEditor, openEditorState } from '../textEditorControl.js';
import type { FormatState } from '../textFormatting.js';
import type { MessageKey } from '@monstera/shared';

/**
 * The in-place editor's formatting commands
 * ([ADR-0180](../../../../docs/DECISIONS/0180-formatting-is-marks-over-a-blocks-words-and-a-block-is-moved-resized-and-added-by-its-own-commands.md)
 * Decisions 1 to 3): bold, italic, underline, superscript, subscript, alignment, bullets, numbering and indent, each a
 * projection of the one table below, so the ribbon, the palette and the editor's bar act through one function.
 *
 * ## Only while an editor is open, and a press does not close it
 *
 * `when` asks the context's `editingText`, so the controls are not drawn for a page nobody is editing, and every one
 * sets `keepsFocus`, since the focus leaving the editor writes the edit and closes it over the words the command is for.
 *
 * ## The size, the colour, the font and the line spacing are VALUES
 *
 * A command is a verb that takes nothing, and these take a number, a colour or a name, so they live on the editor's own
 * bar, as the status bar's zoom and page field stay the bar's (ADR-0067). They call the same {@link formatOpenEditor}.
 */
interface Entry {
  readonly id: string;
  readonly title: MessageKey;
  readonly icon: IconName;
  readonly action: FormatAction;
  /** Whether the words at the selection already are what this sets, for the pressed state. */
  readonly on?: (state: FormatState) => boolean;
}

export const FORMAT_ENTRIES: readonly Entry[] = [
  { id: 'text.format.bold', title: TEXT_FORMAT_BOLD, icon: 'Bold', action: { kind: 'toggle', property: 'bold' }, on: (state) => state.bold },
  { id: 'text.format.italic', title: TEXT_FORMAT_ITALIC, icon: 'Italic', action: { kind: 'toggle', property: 'italic' }, on: (state) => state.italic },
  {
    id: 'text.format.underline',
    title: TEXT_FORMAT_UNDERLINE,
    icon: 'Underline',
    action: { kind: 'toggle', property: 'underline' },
    on: (state) => state.underline,
  },
  {
    id: 'text.format.superscript',
    title: TEXT_FORMAT_SUPERSCRIPT,
    icon: 'Superscript',
    action: { kind: 'rise', rise: 'superscript' },
    on: (state) => state.rise === 'superscript',
  },
  {
    id: 'text.format.subscript',
    title: TEXT_FORMAT_SUBSCRIPT,
    icon: 'Subscript',
    action: { kind: 'rise', rise: 'subscript' },
    on: (state) => state.rise === 'subscript',
  },
  { id: 'text.format.align-left', title: TEXT_FORMAT_ALIGN_LEFT, icon: 'AlignLeft', action: { kind: 'align', align: 'left' } },
  { id: 'text.format.align-center', title: TEXT_FORMAT_ALIGN_CENTER, icon: 'AlignCenter', action: { kind: 'align', align: 'center' } },
  { id: 'text.format.align-right', title: TEXT_FORMAT_ALIGN_RIGHT, icon: 'AlignRight', action: { kind: 'align', align: 'right' } },
  { id: 'text.format.bullets', title: TEXT_FORMAT_BULLETS, icon: 'List', action: { kind: 'list', list: 'bullet' } },
  { id: 'text.format.numbering', title: TEXT_FORMAT_NUMBERING, icon: 'ListOrdered', action: { kind: 'list', list: 'number' } },
  { id: 'text.format.indent-more', title: TEXT_FORMAT_INDENT_MORE, icon: 'IndentIncrease', action: { kind: 'indent', steps: 1 } },
  { id: 'text.format.indent-less', title: TEXT_FORMAT_INDENT_LESS, icon: 'IndentDecrease', action: { kind: 'indent', steps: -1 } },
];

const editing = (context: CommandContext): boolean => context.editingText === true;

export function textFormatCommands(): readonly UiCommand[] {
  return FORMAT_ENTRIES.map((entry, at): UiCommand => ({
    id: entry.id,
    // THE WORDS CHANGE ON THE PAGE UNDER THE PERSON'S EYES, in the editor they are in.
    feedback: VISIBLE,
    title: entry.title,
    icon: entry.icon,
    placements: [{ surface: 'ribbon', section: 'edit', group: GROUP_FORMAT, order: at }],
    when: editing,
    keepsFocus: true,
    ...(entry.on === undefined
      ? {}
      : {
          checked: (): boolean => {
            const state = openEditorState();
            return state !== undefined && entry.on?.(state) === true;
          },
        }),
    run: (): void => {
      formatOpenEditor(entry.action);
    },
  }));
}
