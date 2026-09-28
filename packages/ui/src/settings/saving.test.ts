import { BACKUP_COPIES, BACKUP_COPIES_SETTING_ID } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { BACKUP_COPIES_SETTING } from './saving.js';

describe('Backup copies to keep (saving.backup-copies)', () => {
  it('offers EXACTLY the choices main’s save reads, under the id it reads, one by default', () => {
    // THE JOIN between the two halves: the setting stores a key, `main` maps keys to counts from the same table.
    expect(BACKUP_COPIES_SETTING.id).toBe(BACKUP_COPIES_SETTING_ID);
    expect(BACKUP_COPIES_SETTING.schema.options).toStrictEqual(Object.keys(BACKUP_COPIES));
    expect(BACKUP_COPIES[BACKUP_COPIES_SETTING.fallback]).toBe(1);
    // CONTROL: a count the table does not have is refused, so no choice can reach a save that does not know it.
    expect(BACKUP_COPIES_SETTING.schema.safeParse('seven').success).toBe(false);
  });
});
