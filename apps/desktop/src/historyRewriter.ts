import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';

import type { HistoryRewriteData, HistoryRewriteResult } from '@monstera/nodemode';

/** Runs one Delete's rewrite and answers what it did (ADR-0279, the owner's answers, Decision 7). */
export type HistoryRewriter = (data: HistoryRewriteData) => Promise<HistoryRewriteResult>;

/** Where the rewrite worker's entry point sits, resolved through the package as the reader's is. */
export function historyRewriteEntryPath(): string {
  const entry = createRequire(import.meta.url).resolve('@monstera/nodemode');
  return join(dirname(entry), 'historyRewriteWorker.js');
}

/**
 * Delete's rewrite on a WORKER THREAD, so opening every record of a large file never holds `main` (Decision 7's 3.1 to
 * 3.9 s for 400 MB). One thread per job, ended by the job. A thread that dies, or ends without answering, is a failure
 * said rather than a promise left waiting: the file is untouched until `main` renames, and it renames only on `written`.
 */
export function workerRewriter(entryPath: string = historyRewriteEntryPath()): HistoryRewriter {
  return (data) =>
    new Promise((resolve) => {
      let answered = false;
      const answer = (result: HistoryRewriteResult): void => {
        if (answered) return;
        answered = true;
        resolve(result);
      };
      let worker: Worker;
      try {
        worker = new Worker(entryPath, { workerData: data });
      } catch (cause) {
        answer({ kind: 'failed', message: cause instanceof Error ? cause.message : String(cause) });
        return;
      }
      worker.once('message', (result: HistoryRewriteResult) => {
        answer(result);
      });
      worker.once('error', (cause) => {
        answer({ kind: 'failed', message: cause.message });
      });
      worker.once('exit', (code) => {
        answer({ kind: 'failed', message: `the rewrite thread ended with code ${String(code)} and no answer` });
      });
    });
}
