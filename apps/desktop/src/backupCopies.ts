import { BACKUP_COPIES, BACKUP_COPIES_STORED, storedSetting } from '@monstera/contract';
import { type SaveFileNames, siblingNames } from '@monstera/kernel';

/** The setting's own default, counted: §4's one `.bak`, which every save wrote before the count was a choice. */
export const DEFAULT_BACKUP_COPIES: number = BACKUP_COPIES[BACKUP_COPIES_STORED.fallback];

/**
 * How many earlier versions a save keeps beside the file, read from the settings document at the moment of saving —
 * or one for a missing or unknown value, which is what a first launch and a hand-edited file both are. The table is
 * the contract's (`BACKUP_COPIES`), which the renderer's setting declares too, so no count is spelt here.
 */
export function backupCopiesIn(settings: Readonly<Record<string, unknown>>): number {
  // THE CONTRACT'S DEFINITION decides what a stored value may be and what an unset one is (`storedSettings.ts`).
  return BACKUP_COPIES[storedSetting(settings, BACKUP_COPIES_STORED)];
}

/**
 * The file names a save of a person's document uses: `siblingNames` with the count READ AT EACH SAVE from the settings
 * document, so a change in Settings applies to the next save with nothing restarted. The composition root takes this
 * whole, so the join between the setting and the save is a named thing with its own case rather than a lambda there.
 */
export function saveNamesFor(settings: { readonly read: () => Readonly<Record<string, unknown>> }): SaveFileNames {
  return (target) => siblingNames(target, backupCopiesIn(settings.read()));
}
