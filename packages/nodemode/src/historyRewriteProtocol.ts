import type { HistoryDrop, RemovalPlan } from './historyRecords.js';

/** What `main` hands the rewrite worker (`historyRewriteWorker.ts`): the file, where to write, the key, and what to drop. */
export interface HistoryRewriteData {
  readonly path: string;
  readonly writing: string;
  /** The data key's bytes, copied into the worker's memory; it never reaches a file. */
  readonly key: Uint8Array;
  readonly drop: HistoryDrop;
}

/**
 * What it answers: nothing to drop; the kept records written beside the file, with `read`, where the last whole record it
 * read ends (where `main` reads the later tail from, never the number of bytes read), and the plan, so `main` filters that
 * tail the same way; or a failure, with the file untouched.
 */
export type HistoryRewriteResult =
  | { readonly kind: 'nothing' }
  | { readonly kind: 'written'; readonly read: number; readonly plan: RemovalPlan; readonly cardsKept: number }
  | { readonly kind: 'failed'; readonly message: string };
