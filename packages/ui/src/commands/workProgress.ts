import type { ContractClient } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import type { TrackTask } from '../runningTask.js';

/**
 * Runs a call to main that does long work, with that work on screen and stoppable (the owner's O9 and O10): the one way a
 * conversion in main shows its progress and takes a Cancel.
 *
 * The work is NAMED here, a random id sent with the call; while the call is in flight its progress is asked for under that
 * name (`work.progress`) and the status bar steps, and Cancel there asks main to stop it (`work.cancel`), which it does at
 * its next part. The name says nothing about the file.
 *
 * `withReadProgress`' shape, for work that is not one document's: an import has no document until it is done.
 *
 * @param run the call, given the name to send with it
 */
export async function withWorkProgress<T>(
  deps: { readonly client: ContractClient; readonly track: TrackTask },
  label: MessageKey,
  run: (work: string) => Promise<T>,
): Promise<T> {
  const work = globalThis.crypto.randomUUID();
  // NO TOTAL YET: main learns how many parts there are once it has read the file, and the first answer brings it.
  const task = deps.track(label, 0);
  const poll = globalThis.setInterval(() => {
    void deps.client['work.progress']({ work }).then((progress) => {
      if (progress.ok && progress.value.kind === 'running') task.step(progress.value.done, progress.value.total);
    });
  }, WORK_PROGRESS_INTERVAL_MS);
  const stop = (): void => {
    void deps.client['work.cancel']({ work });
  };
  task.signal.addEventListener('abort', stop, { once: true });
  try {
    return await run(work);
  } finally {
    globalThis.clearInterval(poll);
    task.signal.removeEventListener('abort', stop);
    task.end();
  }
}

/** How often a work's count is asked for: one part of a conversion takes seconds, so once a second shows every part. */
export const WORK_PROGRESS_INTERVAL_MS = 1000;
