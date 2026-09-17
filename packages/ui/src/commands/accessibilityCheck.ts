import type { ContractClient } from '@monstera/contract';

import { ACCESSIBILITY_DIALOG_ID } from '../dialogs/accessibilityCheck.js';
import { ACCESSIBILITY_COMMAND_TITLE, GROUP_ACCESSIBILITY } from '../messages/en.js';
import { pdfjsPageOf } from '../pageNumbering.js';
import type { CommandContext, UiCommand } from '../registries/commands.js';
import { hasDocument } from './documentCommands.js';

/**
 * Review › Accessibility › *Accessibility check* (ADR-0078), beside *Reading order*, which reads
 * the same structure a page at a time.
 *
 * `inspectPageStructureCommand`'s shape: the command reads and the dialog displays, a refusal
 * opens the dialog too, and every page index is turned into the number a person reads through
 * `pageNumbering.ts`, the one place the two meet.
 */
export function accessibilityCheckCommand(deps: {
  readonly client: ContractClient;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
}): UiCommand {
  return {
    id: 'document.accessibility-check',
    icon: 'ShieldCheck',
    title: ACCESSIBILITY_COMMAND_TITLE,
    placements: [{ surface: 'ribbon', section: 'review', group: GROUP_ACCESSIBILITY, order: 20 }],
    when: hasDocument,
    run: async (context: CommandContext): Promise<void> => {
      const { docId } = context;
      if (docId === undefined) return;
      const answer = await deps.client['document.accessibilityCheck']({ docId });
      // Voided for `showWordCount`'s reason: the dialog declares no result.
      void deps.ask(
        ACCESSIBILITY_DIALOG_ID,
        answer.ok
          ? {
              kind: 'checked',
              rules: answer.value.rules.map((rule) => ({ ...rule, pages: rule.pages.map(pdfjsPageOf) })),
              humanChecks: answer.value.humanChecks,
            }
          : { kind: 'refused' },
      );
    },
  };
}
