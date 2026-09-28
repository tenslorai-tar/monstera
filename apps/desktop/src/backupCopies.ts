import { BACKUP_COPIES, BACKUP_COPIES_SETTING_ID, type BackupCopies } from '@monstera/contract';
import { type SaveFileNames, siblingNames } from '@monstera/kernel';

/** One: §4's one `.bak`, which every save wrote before the count was a choice. */
export const DEFAULT_BACKUP_COPIES: number = BACKUP_COPIES.one;

/**
 * How many earlier versions a save keeps beside the file, read from the settings document at the moment of saving —
 * or one for a missing or unknown value, which is what a first launch and a hand-edited file both are. The table is
 * the contract's (`BACKUP_COPIES`), which the renderer's setting declares too, so no count is spelt here.
 */
export function backupCopiesIn(settings: Readonly<Record<string, unknown>>): number {
  const chosen = settings[BACKUP_COPIES_SETTING_ID];
  return typeof chosen === 'string' && Object.hasOwn(BACKUP_COPIES, chosen)
    ? BACKUP_COPIES[chosen as BackupCopies]
    : DEFAULT_BACKUP_COPIES;
}

/**
 * The file names a save of a person's document uses: `siblingNames` with the count READ AT EACH SAVE from the settings
 * document, so a change in Settings applies to the next save with nothing restarted. The composition root takes this
 * whole, so the join between the setting and the save is a named thing with its own case rather than a lambda there.
 */
export function saveNamesFor(settings: { readonly read: () => Readonly<Record<string, unknown>> }): SaveFileNames {
  return (target) => siblingNames(target, backupCopiesIn(settings.read()));
}
