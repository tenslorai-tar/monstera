import type { IconName } from '../primitives/icons.js';
import { type Arrangement, type PlacedField, arrange } from '../forms/arrange.js';
import {
  FIELD_ARRANGE_ALIGN_BOTTOM,
  FIELD_ARRANGE_ALIGN_LEFT,
  FIELD_ARRANGE_ALIGN_RIGHT,
  FIELD_ARRANGE_ALIGN_TOP,
  FIELD_ARRANGE_CENTRE_HORIZONTALLY,
  FIELD_ARRANGE_CENTRE_VERTICALLY,
  FIELD_ARRANGE_SAME_HEIGHT,
  FIELD_ARRANGE_SAME_SIZE,
  FIELD_ARRANGE_SAME_WIDTH,
} from '../messages/en.js';
import { type UiCommand, VISIBLE } from '../registries/commands.js';
import type { MessageKey } from '@monstera/shared';

/**
 * Aligning the selected form fields and making them one size (ADR-0193): nine commands from one table, at the foot of the
 * Properties tab while two or more fields are selected.
 *
 * ## Registered, never wired
 *
 * Each is a command with a `when`, so with fewer than two fields selected it is hidden and not present and inert, and the
 * Properties tab's foot and the command palette read the same entry. What a command does is {@link arrange}'s answer sent
 * as one `editFormFields` (one undo step), so a form already lined up sends nothing.
 */
export interface FieldArrangeDeps {
  /** The selected fields and where each is, in the order they were chosen. Read when the command runs and when it is asked. */
  readonly placed: () => readonly PlacedField[];
  /** Sends the new place of each field that moves, as one command. */
  readonly apply: (moved: readonly PlacedField[]) => void;
}

const ARRANGEMENTS: readonly { readonly kind: Arrangement; readonly title: MessageKey; readonly icon: IconName }[] = [
  { kind: 'align-left', title: FIELD_ARRANGE_ALIGN_LEFT, icon: 'AlignStartVertical' },
  { kind: 'align-right', title: FIELD_ARRANGE_ALIGN_RIGHT, icon: 'AlignEndVertical' },
  { kind: 'align-top', title: FIELD_ARRANGE_ALIGN_TOP, icon: 'AlignStartHorizontal' },
  { kind: 'align-bottom', title: FIELD_ARRANGE_ALIGN_BOTTOM, icon: 'AlignEndHorizontal' },
  { kind: 'centre-horizontally', title: FIELD_ARRANGE_CENTRE_HORIZONTALLY, icon: 'AlignCenterVertical' },
  { kind: 'centre-vertically', title: FIELD_ARRANGE_CENTRE_VERTICALLY, icon: 'AlignCenterHorizontal' },
  { kind: 'same-width', title: FIELD_ARRANGE_SAME_WIDTH, icon: 'MoveHorizontal' },
  { kind: 'same-height', title: FIELD_ARRANGE_SAME_HEIGHT, icon: 'MoveVertical' },
  { kind: 'same-size', title: FIELD_ARRANGE_SAME_SIZE, icon: 'Maximize2' },
];

/** The arrange commands. */
export function fieldArrangeCommands(deps: FieldArrangeDeps): readonly UiCommand[] {
  return ARRANGEMENTS.map(
    ({ kind, title, icon }, at): UiCommand => ({
      id: `forms.arrange.${kind}`,
      feedback: VISIBLE,
      title,
      icon,
      // AFTER A MARK'S OWN FOOT (Reply 10, Delete 20): fields and marks are never selected together, and the order keeps
      // the nine in the table's.
      placements: [{ surface: 'properties', order: 30 + at }],
      when: () => deps.placed().length >= 2,
      run: (): void => {
        const moved = arrange(kind, deps.placed());
        if (moved.length > 0) deps.apply(moved);
      },
    }),
  );
}
