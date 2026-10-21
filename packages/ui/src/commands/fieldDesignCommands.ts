import type { FormFieldKind } from '@monstera/contract';

import type { PlacedField } from '../forms/arrange.js';
import {
  EDIT_FIELDS_TIP,
  EDIT_FIELDS_TITLE,
  EDIT_COPY_TITLE,
  EDIT_PASTE_TITLE,
  FIELD_DUPLICATE_TITLE,
  FIELD_PROPERTIES_TITLE,
  GROUP_FIELDS,
  RIBBON_EDIT_FIELDS,
} from '../messages/en.js';
import type { PanelPresence } from '../panelPresence.js';
import { type UiCommand, VISIBLE } from '../registries/commands.js';
import { CONTEXT_PANEL_TAB_SETTING } from '../settings/layout.js';
import type { SettingsStore } from '../settingsStore.js';
import { hasDocument } from './documentCommands.js';

/** *Edit fields*' mode in the tool slot (ADR-0226 Decision 7), the slot Edit text holds, for its reason. */
export const EDIT_FIELDS_TOOL_ID = 'forms.edit-fields';

/**
 * *Edit fields*, turned on and off again: Edit text's mode command one section over. While it is on every field is a box
 * to select, move and resize, and a press never fills; Escape with nothing selected, or this again, returns to filling.
 */
export function editFieldsCommand(deps: {
  readonly activeTool: () => string | undefined;
  readonly onSelect: (id: string | undefined) => void;
}): UiCommand {
  return {
    id: EDIT_FIELDS_TOOL_ID,
    feedback: VISIBLE,
    icon: 'SquareDashedMousePointer',
    title: EDIT_FIELDS_TITLE,
    ribbonTitle: RIBBON_EDIT_FIELDS,
    tip: EDIT_FIELDS_TIP,
    // FIRST IN FIELDS, before the tools that add one: the mode a person designs in is the group's first word.
    placements: [{ surface: 'ribbon', section: 'forms', group: GROUP_FIELDS, order: 69 }],
    when: hasDocument,
    checked: () => deps.activeTool() === EDIT_FIELDS_TOOL_ID,
    run: (): void => {
      // READ THROUGH THE FUNCTION, `toolCommand`'s rule: the command is built once.
      deps.onSelect(deps.activeTool() === EDIT_FIELDS_TOOL_ID ? undefined : EDIT_FIELDS_TOOL_ID);
    },
  };
}

/** What the field commands read of *Edit fields*: its selection, only while the mode is on, and what they send. */
export interface FieldDesignDeps {
  /** The selected fields with their places and kinds while *Edit fields* is on; empty otherwise, so nothing here exists. */
  readonly selected: () => readonly (PlacedField & { readonly kind: FormFieldKind })[];
  /** Holds the selected fields for a paste, in this document. */
  readonly copy: (fields: readonly PlacedField[]) => void;
  /** Whether something copied in this document can be pasted, read when asked. */
  readonly canPaste: () => boolean;
  /** Pastes what was copied, each a little below and right of its original, and selects the copies. */
  readonly paste: () => void;
  /** Copies the selected fields beside themselves in one go, and selects the copies. */
  readonly duplicate: (fields: readonly PlacedField[]) => void;
  readonly settings: SettingsStore;
  readonly presence: PanelPresence;
}

/**
 * A field the writer can copy: a radio option belongs to its group and a signature is signed once
 * (`FieldEditRefusal`'s `duplicate-radio` and `duplicate-signature` are the writer's backstop).
 */
function copyable(field: { readonly kind: FormFieldKind }): boolean {
  return field.kind !== 'radio' && field.kind !== 'signature';
}

/**
 * The commands *Edit fields* adds to a field's right-click menu (MenuContext `field`) and to the keyboard: Properties,
 * Copy, Paste and Duplicate. Delete and the arrows are `annotate.delete-selection` and the nudges, which take the field
 * selection beside the marks' (one key names one command); Align, Same size, Copy to pages and Tab order are their own
 * commands, placed in the same menu.
 *
 * Copy and Paste have no chord of their own: Ctrl+C and Ctrl+V are the Edit menu's (`editCommands.ts`), which run these
 * when the field selection is the subject. Duplicate takes Ctrl+D, which nothing else holds.
 */
export function fieldDesignCommands(deps: FieldDesignDeps): {
  readonly properties: UiCommand;
  readonly copy: UiCommand;
  readonly paste: UiCommand;
  readonly duplicate: UiCommand;
} {
  const any = (): boolean => deps.selected().length > 0;
  return {
    properties: {
      id: 'forms.field-properties',
      feedback: VISIBLE,
      title: FIELD_PROPERTIES_TITLE,
      icon: 'PaintBucket',
      placements: [{ surface: 'context-menu', context: 'field', order: 10 }],
      when: any,
      run: (): void => {
        deps.settings.set(CONTEXT_PANEL_TAB_SETTING.id, 'properties');
        // SHOWN, not only opened: in a narrow row the panel is a sheet, and a write of a setting already on draws nothing.
        deps.presence.show('end');
      },
    },
    copy: {
      id: 'forms.copy-fields',
      feedback: VISIBLE,
      title: EDIT_COPY_TITLE,
      icon: 'Copy',
      placements: [{ surface: 'context-menu', context: 'field', order: 14 }],
      when: () => deps.selected().some(copyable),
      run: (): void => {
        deps.copy(deps.selected().filter(copyable));
      },
    },
    paste: {
      id: 'forms.paste-fields',
      feedback: VISIBLE,
      title: EDIT_PASTE_TITLE,
      icon: 'ClipboardPaste',
      placements: [{ surface: 'context-menu', context: 'field', order: 16 }],
      when: () => deps.canPaste(),
      run: (): void => {
        deps.paste();
      },
    },
    duplicate: {
      id: 'forms.duplicate-field',
      feedback: VISIBLE,
      title: FIELD_DUPLICATE_TITLE,
      icon: 'CopyPlus',
      shortcut: 'Ctrl+D',
      placements: [{ surface: 'context-menu', context: 'field', order: 18 }],
      when: () => deps.selected().some(copyable),
      run: (): void => {
        deps.duplicate(deps.selected().filter(copyable));
      },
    },
  };
}
