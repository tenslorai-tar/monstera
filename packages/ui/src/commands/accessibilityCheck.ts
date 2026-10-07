import type { DocId } from '@monstera/shared';

import { ACCESSIBILITY_COMMAND_TITLE, GROUP_ACCESSIBILITY } from '../messages/en.js';
import { type CommandContext, type UiCommand, VISIBLE } from '../registries/commands.js';
import { hasDocument } from './documentCommands.js';

/**
 * Review › Accessibility › *Accessibility check* (ADR-0078), beside *Reading order*.
 *
 * It opens no dialog (ADR-0183): the left document panel shows the findings beside the page while the tool is open
 * (ADR-0189), so a result can be marked where it is. `show` is App's, which holds the panel and the document stores; it
 * opens the tool at the check section and starts the check.
 */
export function accessibilityCheckCommand(deps: {
  /** Opens the tool on its check and runs it for `docId`. */
  readonly show: (docId: DocId) => void;
}): UiCommand {
  return {
    id: 'document.accessibility-check',
    feedback: VISIBLE,
    icon: 'ShieldCheck',
    title: ACCESSIBILITY_COMMAND_TITLE,
    placements: [{ surface: 'ribbon', section: 'review', group: GROUP_ACCESSIBILITY, order: 20 }],
    when: hasDocument,
    run: (context: CommandContext): void => {
      const { docId } = context;
      if (docId === undefined) return;
      deps.show(docId);
    },
  };
}
