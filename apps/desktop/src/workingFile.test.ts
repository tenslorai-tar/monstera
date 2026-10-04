import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ShellFailure } from './shellFailure.js';
import { removeWorkingFile } from './workingFile.js';

describe('removeWorkingFile (CR-COR-02)', () => {
  it('a removal that FAILS resolves, and names the file and the code in the log', async () => {
    const said: ShellFailure[] = [];
    // WINDOWS' ANSWER while another process still holds the file open.
    const held = (): Promise<void> => Promise.reject(Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }));
    await expect(removeWorkingFile('C:/session/output/joined-7', (failure) => said.push(failure), held)).resolves.toBeUndefined();
    expect(said).toStrictEqual([{ event: 'working-file-left', detail: 'C:/session/output/joined-7 could not be removed: EBUSY' }]);
  });

  it('CONTROL: the real removal removes the file and says nothing', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'monstera-working-'));
    try {
      const path = join(directory, 'joined');
      writeFileSync(path, 'bytes');
      const said: ShellFailure[] = [];
      await removeWorkingFile(path, (failure) => said.push(failure));
      expect(existsSync(path)).toBe(false);
      expect(said).toStrictEqual([]);
      // AND A FILE ALREADY GONE is no failure: the removal is forced, as both callers ran it before.
      await removeWorkingFile(path, (failure) => said.push(failure));
      expect(said).toStrictEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
