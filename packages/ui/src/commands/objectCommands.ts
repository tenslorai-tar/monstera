import type { DispatchableCommand } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import {
  EDIT_OBJECTS_ALL_TITLE,
  EDIT_OBJECTS_IMAGES_TITLE,
  EDIT_OBJECTS_SHAPES_TITLE,
  EDIT_OBJECTS_TEXT_TITLE,
  GROUP_TEXT,
  OBJECT_BACKWARD_TITLE,
  OBJECT_FORWARD_TITLE,
  RIBBON_EDIT_OBJECT,
} from '../messages/en.js';
import { OBJECT_FILTERS, type ObjectFilter, type ObjectPick, arrangeCommand } from '../objectEditing.js';
import type { IconName } from '../primitives/icons.js';
import { type UiCommand, VISIBLE } from '../registries/commands.js';
import { hasDocument } from './documentCommands.js';

/**
 * Edit object's commands
 * ([ADR-0264](../../../../docs/DECISIONS/0264-edit-object-returns-and-an-edit-changes-only-the-bytes-of-the-object-it-names.md)).
 */

/** Edit object's mode in the tool slot (Decision 8), the slot Edit text holds, for its reason: one mode at a time. */
export const EDIT_OBJECTS_TOOL_ID = 'edit.objects';

/** Each filter's title, which its menu item draws. */
const FILTER_TITLES: Readonly<Record<ObjectFilter, MessageKey>> = {
  all: EDIT_OBJECTS_ALL_TITLE,
  text: EDIT_OBJECTS_TEXT_TITLE,
  images: EDIT_OBJECTS_IMAGES_TITLE,
  shapes: EDIT_OBJECTS_SHAPES_TITLE,
};

/** Each filter's glyph: one each, since four of one glyph in a menu say nothing about which objects each outlines. */
const FILTER_ICONS: Readonly<Record<ObjectFilter, IconName>> = {
  all: 'SquarePen',
  text: 'Type',
  images: 'Image',
  shapes: 'Spline',
};

/**
 * Edit object's four filters, one ribbon menu whose face runs the filter chosen last (Decision 8; ADR-0241's mechanism).
 *
 * Each turns the mode on with its filter, and off again when it is the one already on, Edit text's toggle per filter.
 * **The filter is a value beside the slot, not four slot ids**: the slot answers what a press on the page does, which is
 * the same for all four, and the filter answers which objects are outlined.
 */
export function editObjectsCommands(deps: {
  readonly activeTool: () => string | undefined;
  readonly filter: () => ObjectFilter;
  readonly onEnter: (filter: ObjectFilter | undefined) => void;
}): readonly UiCommand[] {
  const on = (filter: ObjectFilter): boolean => deps.activeTool() === EDIT_OBJECTS_TOOL_ID && deps.filter() === filter;
  return OBJECT_FILTERS.map(
    (filter, at): UiCommand => ({
      id: `edit.objects-${filter}`,
      feedback: VISIBLE,
      icon: FILTER_ICONS[filter],
      title: FILTER_TITLES[filter],
      placements: [{ surface: 'ribbon', section: 'edit', group: GROUP_TEXT, order: 20 + at, menu: RIBBON_EDIT_OBJECT, menuRuns: 'last' }],
      when: hasDocument,
      checked: () => on(filter),
      run: (): void => {
        // READ THROUGH THE FUNCTIONS at the press, `editTextCommand`'s rule.
        deps.onEnter(on(filter) ? undefined : filter);
      },
    }),
  );
}

/** What Arrange reads of Edit object's selection, and how it sends the command it builds. */
export interface ObjectArrangeDeps {
  readonly picked: () => ObjectPick | undefined;
  readonly onArrange: (command: DispatchableCommand) => void;
}

const STEPS: readonly { readonly to: 'forward' | 'backward'; readonly title: MessageKey; readonly icon: IconName }[] = [
  { to: 'forward', title: OBJECT_FORWARD_TITLE, icon: 'BringToFront' },
  { to: 'backward', title: OBJECT_BACKWARD_TITLE, icon: 'SendToBack' },
];

/**
 * *Bring forward* and *Send backward* for the one selected object (Decision 3): in the Properties tab's foot, before
 * Delete, and in the object's menu. Shown only where the step exists, an object that overlaps the selected one on that
 * side (`arrangeNeighbourOf`), so neither is ever a button that does nothing (the wired-tools rule).
 */
export function objectArrangeCommands(deps: ObjectArrangeDeps): readonly UiCommand[] {
  return STEPS.map(
    ({ to, title, icon }, at): UiCommand => ({
      id: `edit.object-${to}`,
      feedback: VISIBLE,
      title,
      icon,
      placements: [
        { surface: 'properties', order: 15 + at },
        { surface: 'context-menu', context: 'object', order: 30 + at },
      ],
      when: () => {
        const pick = deps.picked();
        return pick !== undefined && arrangeCommand(pick, to) !== undefined;
      },
      run: (): void => {
        const pick = deps.picked();
        const command = pick === undefined ? undefined : arrangeCommand(pick, to);
        if (command !== undefined) deps.onArrange(command);
      },
    }),
  );
}
