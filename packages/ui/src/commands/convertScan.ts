import { CONVERT_SCAN_DIALOG_ID } from '../dialogs/convertScan.js';
import { CONVERT_SCAN_RESULT } from '../dialogs/convertScanResult.js';
import { CONVERT_SCAN_COMMAND_TITLE, CONVERT_SCAN_TIP, GROUP_OCR, RIBBON_CONVERT_SCAN } from '../messages/en.js';
import { type CommandContext, TOASTS, type UiCommand } from '../registries/commands.js';
import { type DocumentCommandDeps, hasDocument } from './documentCommands.js';

/**
 * The command each outcome goes to — registered commands, so this entry point can never describe something the application
 * does not do: a searchable PDF is *Make scanned pages searchable*, a Word file is *Export to Word*, a workbook is *Export
 * tables to Excel*.
 */
export const CONVERT_SCAN_TARGETS = {
  searchable: 'document.ocr',
  word: 'document.export-word',
  excel: 'document.export-excel',
} as const;

/**
 * Tools › OCR › *Convert scan…* — one entry point that says, before anything is read or sent, what a scanned or handwritten
 * document can become and takes the person to the command that does it (the owner's order of 2026-10-08, Step 7d).
 *
 * ## It answers a choice and runs a registered command
 *
 * The dialog takes no props and answers one of three outcomes; `run` hands the chosen command the context this one was
 * given, by id, through the registry the application built. A dismissal answers nothing the schema accepts and ends it.
 */
export function convertScanCommand(deps: Pick<DocumentCommandDeps, 'ask'> & {
  /** Runs another registered command with this context; `undefined` where none by that id is registered. */
  readonly runCommand: (id: string, context: CommandContext) => void | Promise<void>;
}): UiCommand {
  return {
    id: 'document.convert-scan',
    feedback: TOASTS,
    icon: 'ScanText',
    title: CONVERT_SCAN_COMMAND_TITLE,
    ribbonTitle: RIBBON_CONVERT_SCAN,
    tip: CONVERT_SCAN_TIP,
    // FIRST IN THE OCR GROUP: a person who has a scan looks here before reading about the three commands it leads to.
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_OCR, order: 5, size: 'small' }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      const chosen = CONVERT_SCAN_RESULT.safeParse(await deps.ask(CONVERT_SCAN_DIALOG_ID, {}));
      if (!chosen.success) return;
      await deps.runCommand(CONVERT_SCAN_TARGETS[chosen.data.outcome], context);
    },
  };
}
