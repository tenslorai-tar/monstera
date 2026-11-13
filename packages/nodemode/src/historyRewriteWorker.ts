import { parentPort, workerData } from 'node:worker_threads';

import { runHistoryRewrite } from './historyRewrite.js';
import { type HistoryRewriteData, rewriteFailed } from './historyRewriteProtocol.js';

/**
 * Delete's rewrite on a thread of its own (ADR-0279, the owner's answers, Decision 7): `runHistoryRewrite`, and its answer
 * posted back. Loaded by path through `new Worker(…)`, never imported (`index.ts`' rule). One job per thread.
 */
try {
  parentPort?.postMessage(runHistoryRewrite(workerData as HistoryRewriteData));
} catch (cause) {
  // A FAILURE IS SAID, never a silence `main` would wait on for ever; the file is untouched, since nothing renamed it.
  parentPort?.postMessage(rewriteFailed(cause));
}
