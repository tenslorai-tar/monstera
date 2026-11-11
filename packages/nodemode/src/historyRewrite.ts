import { readFileSync, writeFileSync } from 'node:fs';

import { CARD, headsOf, keptUnder, planRemoval, unseal } from './historyRecords.js';
import type { HistoryRewriteData, HistoryRewriteResult } from './historyRewriteProtocol.js';

/**
 * Delete's rewrite (ADR-0279, the owner's answers, Decision 7): the file is read, the records to drop are worked out (for
 * a section, by opening every guard and card), and the records that stay are written beside it as `writing`. `main` then
 * appends whatever a save added since this read, filtered by the same plan, and renames over, with no await between, so
 * nothing a save writes is lost. That end is cheap; this is the part Decision 7 measured at 3.1 to 3.9 s for a 400 MB
 * file, and it runs on a worker thread (`historyRewriteWorker.ts`), so `main` stays free. One function for the worker and
 * the cases, so what the cases prove is what the worker runs.
 */
export function runHistoryRewrite(data: HistoryRewriteData): HistoryRewriteResult {
  const key = Buffer.from(data.key);
  const bytes = readFileSync(data.path);
  const heads = headsOf(bytes);
  const plan = planRemoval(heads, (head) => unseal(key, bytes.subarray(head.at, head.at + head.length)), data.drop);
  if (plan === null) return { kind: 'nothing' };
  const kept = heads.filter(keptUnder(plan));
  writeFileSync(data.writing, Buffer.concat(kept.map((head) => bytes.subarray(head.start, head.at + head.length))));
  return { kind: 'written', read: bytes.length, plan, cardsKept: kept.filter((head) => head.type === CARD).length };
}
