import { rm } from 'node:fs/promises';

import type { ShellFailureSink } from './shellFailure.js';

/**
 * Removes a file this build wrote for its own use, and says in the log when it could not (CR-COR-02).
 *
 * **It never rejects**, and that is the whole of why it exists. A working file's removal is called where nothing can
 * act on its failure: from a `discard` its caller does not await, where a rejection is one nothing handles, and from a
 * `finally` after the work it served is done, where a rejection replaced a finished copy with an error. On Windows a
 * removal fails with `EBUSY` while another process still holds the file, so the failure is ordinary, and what it
 * means — a file left in this build's own area — is a line in the log rather than a fault in the person's command.
 */
export async function removeWorkingFile(
  path: string,
  failures: ShellFailureSink,
  remove: (path: string) => Promise<void> = (target) => rm(target, { force: true }),
): Promise<void> {
  try {
    await remove(path);
  } catch (cause) {
    const code = cause instanceof Error ? ((cause as NodeJS.ErrnoException).code ?? cause.name) : typeof cause;
    failures({ event: 'working-file-left', detail: `${path} could not be removed: ${code}` });
  }
}
