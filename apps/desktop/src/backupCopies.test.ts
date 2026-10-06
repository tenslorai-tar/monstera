import { BACKUP_COPIES, BACKUP_COPIES_SETTING_ID, MAX_BACKUP_COPIES } from '@monstera/contract';
import { siblingNames } from '@monstera/kernel';
import { describe, expect, it } from 'vitest';

import { DEFAULT_BACKUP_COPIES, backupCopiesIn, saveNamesFor } from './backupCopies.js';

describe('backup copies to keep, as a save reads the setting', () => {
  it('reads each choice from the one table, and ONE for a missing or unknown value', () => {
    for (const [choice, count] of Object.entries(BACKUP_COPIES)) {
      expect(backupCopiesIn({ [BACKUP_COPIES_SETTING_ID]: choice }), choice).toBe(count);
    }
    expect(backupCopiesIn({})).toBe(DEFAULT_BACKUP_COPIES);
    expect(backupCopiesIn({ [BACKUP_COPIES_SETTING_ID]: 'eleven' })).toBe(1);
    // CONTROL: a choice other than the default is read as itself, so the reading is not always one.
    expect(backupCopiesIn({ [BACKUP_COPIES_SETTING_ID]: 'ten' })).toBe(10);
    // AND `none`, which §4's `.bak` rules out, is not a choice: a stored one reads as the default.
    expect(backupCopiesIn({ [BACKUP_COPIES_SETTING_ID]: 'none' })).toBe(1);
  });

  it('names the kept copies newest first, and retires every name up to the longest choice', () => {
    const three = siblingNames('C:/d/report.pdf', 3);
    // THE TEMP'S NAME IS NEW AT EVERY CALL (CR-SEC-17): beside the target, attributable, and nothing another account
    // could have created first.
    expect(three.temp).toMatch(/^C:\/d\/report\.pdf\.[0-9a-f]{16}\.monstera-tmp$/u);
    expect(siblingNames('C:/d/report.pdf', 3).temp).not.toBe(three.temp);
    expect(three).toStrictEqual({
      temp: three.temp,
      previous: 'C:/d/report.pdf.monstera-previous',
      backups: ['C:/d/report.pdf.bak', 'C:/d/report.pdf.bak2', 'C:/d/report.pdf.bak3'],
      retired: Array.from({ length: MAX_BACKUP_COPIES - 3 }, (_unused, index) => `C:/d/report.pdf.bak${String(index + 4)}`),
    });
    // ONE keeps the name every save wrote before this was a choice.
    expect(siblingNames('C:/d/report.pdf', 1).backups).toStrictEqual(['C:/d/report.pdf.bak']);
    const none = siblingNames('C:/d/report.pdf', 0);
    expect(none.backups).toStrictEqual([]);
    expect(none.retired).toHaveLength(MAX_BACKUP_COPIES);
  });

  it('the save’s names READ THE SETTING AT EACH SAVE — a change applies to the next save with nothing rebuilt', () => {
    let stored: Record<string, unknown> = { [BACKUP_COPIES_SETTING_ID]: 'three' };
    const names = saveNamesFor({ read: () => stored });
    expect(names('a.pdf').backups).toHaveLength(3);
    stored = { [BACKUP_COPIES_SETTING_ID]: 'ten' };
    expect(names('a.pdf').backups).toHaveLength(10);
  });
});
