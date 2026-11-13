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
  | {
      readonly kind: 'failed';
      readonly message: string;
      /**
       * A system error's code and call, `null` for any other: what `main` says in place of a message Node spells with the
       * history file's path (`pathlessCause`, HHHHHHHHH-19). A thread posts plain data, so they are carried as fields.
       */
      readonly code: string | null;
      readonly syscall: string | null;
    };

/** A rewrite that threw, as the failure it answers: its message, and a system error's code and call where it has them. */
export function rewriteFailed(cause: unknown): HistoryRewriteResult {
  const field = (name: 'code' | 'syscall'): string | null =>
    typeof cause === 'object' && cause !== null && name in cause && typeof (cause as Record<string, unknown>)[name] === 'string'
      ? ((cause as Record<string, unknown>)[name] as string)
      : null;
  return { kind: 'failed', message: cause instanceof Error ? cause.message : String(cause), code: field('code'), syscall: field('syscall') };
}
