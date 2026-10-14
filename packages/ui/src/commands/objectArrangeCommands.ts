import type { DispatchableCommand } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import { OBJECT_BACKWARD_TITLE, OBJECT_FORWARD_TITLE } from '../messages/en.js';
import { type ObjectPick, arrangeCommand } from '../objectEditing.js';
import type { IconName } from '../primitives/icons.js';
import { type UiCommand, VISIBLE } from '../registries/commands.js';

/** What Arrange reads of Edit object's selection, and how it sends the command it builds. */
export interface ObjectArrangeDeps {
  readonly picked: () => ObjectPick | undefined;
  readonly onArrange: (command: DispatchableCommand) => void;
}

const STEPS: readonly { readonly toward: 'forward' | 'backward'; readonly title: MessageKey; readonly icon: IconName }[] = [
  { toward: 'forward', title: OBJECT_FORWARD_TITLE, icon: 'BringToFront' },
  { toward: 'backward', title: OBJECT_BACKWARD_TITLE, icon: 'SendToBack' },
];

/**
 * *Bring forward* and *Send backward* for the one selected page object (ADR-0244): in the Properties tab's foot, before
 * Delete, and in the object's menu, before Properties. Shown only where the step exists — one object of page content
 * with a neighbour that way — so neither is ever a button that does nothing (the wired-tools rule).
 */
export function objectArrangeCommands(deps: ObjectArrangeDeps): readonly UiCommand[] {
  return STEPS.map(
    ({ toward, title, icon }, at): UiCommand => ({
      id: `edit.object-${toward}`,
      feedback: VISIBLE,
      title,
      icon,
      placements: [
        { surface: 'properties', order: 15 + at },
        { surface: 'context-menu', context: 'object', order: 30 + at },
      ],
      when: () => {
        const pick = deps.picked();
        return pick !== undefined && arrangeCommand(pick, toward) !== undefined;
      },
      run: (): void => {
        const pick = deps.picked();
        const command = pick === undefined ? undefined : arrangeCommand(pick, toward);
        if (command !== undefined) deps.onArrange(command);
      },
    }),
  );
}
