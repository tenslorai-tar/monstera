import type { ContractClient } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import type { TrackTask, TrackedTask } from '../runningTask.js';

/**
 * Runs a conversion in main with its work on screen (ADR-0234, the owner's O9 and O10): THE ONE WAY a conversion is shown,
 * which is why every conversion channel takes the name this mints.
 *
 * The work is NAMED here, a random id sent with the call. Main begins work under it once the input is chosen — after its
 * picker answers — so the name answers `idle` while a picker is open and for a picker dismissed, and the notice appears
 * only when main first says `running`. From then it steps with main's counts, shows Cancel only where main says the work
 * stops (`work.cancel` asks it to, at its next part), and leaves when the call answers. The name says nothing about the
 * file.
 *
 * @param run the call, given the name to send with it
 */
export async function withWorkProgress<T>(
  deps: { readonly client: ContractClient; readonly track: TrackTask },
  label: MessageKey,
  run: (work: string) => Promise<T>,
): Promise<T> {
  const work = globalThis.crypto.randomUUID();
  let task: TrackedTask | undefined;
  let answered = false;
  const stop = (): void => {
    void deps.client['work.cancel']({ work });
  };
  // ASKED OFTEN UNTIL THE WORK BEGINS, then once a second: the notice should appear when the input is chosen, and a part
  // of a conversion takes seconds.
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const ask = (): void => {
    timer = globalThis.setTimeout(() => {
      void deps.client['work.progress']({ work }).then((progress) => {
        if (answered) return;
        if (progress.ok && progress.value.kind === 'running') {
          const { done, total, stoppable } = progress.value;
          if (task === undefined) {
            task = deps.track(label, total, stoppable ? 'stops-between-parts' : 'runs-to-the-end');
            task.signal.addEventListener('abort', stop, { once: true });
          }
          task.step(done, total);
        }
        ask();
      });
    }, task === undefined ? WORK_BEGIN_INTERVAL_MS : WORK_PROGRESS_INTERVAL_MS);
  };
  ask();
  try {
    return await run(work);
  } finally {
    answered = true;
    globalThis.clearTimeout(timer);
    if (task !== undefined) {
      task.signal.removeEventListener('abort', stop);
      task.end();
    }
  }
}

/** How often a work's count is asked for once it runs: one part of a conversion takes seconds, so once a second shows every part. */
export const WORK_PROGRESS_INTERVAL_MS = 1000;

/** How often the name is asked about before the work begins, so the notice appears close to the moment the input is chosen. */
export const WORK_BEGIN_INTERVAL_MS = 200;
