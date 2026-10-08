import type { FormFieldHandle, FormFieldKind } from '@monstera/contract';

import { FIELD_COPY_DIALOG_ID } from '../dialogs/fieldCopy.js';
import type { FieldCopyAnswer } from '../dialogs/fieldCopyResult.js';
import type { IconName } from '../primitives/icons.js';
import { type Arrangement, type PlacedField, arrange } from '../forms/arrange.js';
import {
  FIELD_COPY_COMMAND_TITLE,
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

/** The one selected field, and what kind it is. */
export interface FieldToCopy {
  readonly field: FormFieldHandle;
  readonly kind: FormFieldKind;
}

export interface FieldCopyDeps {
  /** The one selected field, or `undefined` for none or several. */
  readonly single: () => FieldToCopy | undefined;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  /** Sends the copy: the field and the zero-based pages it goes onto. */
  readonly apply: (field: FormFieldHandle, pages: readonly number[]) => void;
}

/**
 * *Copy to other pages…* for the one selected form field (ADR-0193): asks which pages and sends ONE `duplicateFormField`.
 *
 * Offered only where a copy is a thing the writer does. A radio option belongs to its group and a signature is signed
 * once, so for those the command is hidden and not present and refused (`FieldEditRefusal`'s `duplicate-radio` and
 * `duplicate-signature` are the writer's own backstop).
 */
export function copyFieldToPagesCommand(deps: FieldCopyDeps): UiCommand {
  return {
    id: 'forms.copy-to-pages',
    feedback: VISIBLE,
    title: FIELD_COPY_COMMAND_TITLE,
    icon: 'CopyPlus',
    placements: [{ surface: 'properties', order: 20 }],
    when: (context) => {
      const chosen = deps.single();
      return chosen !== undefined && chosen.kind !== 'radio' && chosen.kind !== 'signature' && (context.pageCount ?? 0) > 1;
    },
    run: async (context): Promise<void> => {
      const chosen = deps.single();
      if (chosen === undefined || context.pageCount === undefined) return;
      const answer = (await deps.ask(FIELD_COPY_DIALOG_ID, { pageCount: context.pageCount, from: chosen.field.page })) as
        | FieldCopyAnswer
        | undefined;
      if (answer !== undefined) deps.apply(chosen.field, answer.pages);
    },
  };
}

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
