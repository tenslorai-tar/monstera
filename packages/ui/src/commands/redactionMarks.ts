import type { ContractClient } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import { readWholeList } from '../readWholeList.js';

/**
 * How many redaction marks the document carries, or `undefined` where main refused the read.
 *
 * ## The count is `document.annotations`' own answer, never a second walk
 *
 * The kernel's reader names a `/Redact` `redact` — region marks, text marks, marks by search and another
 * application's marks alike — and the layer over each page reads the same list to draw them. Counting those entries
 * is a third reader of one answer, not a second opinion about what a mark is.
 *
 * ## One counter for the two questions that need it (B3a)
 *
 * *Apply redactions* asks it before offering to burn anything in, and the question before a save, close or export asks
 * it before asking about unapplied marks (`pendingRedactions.ts`). Its own module, because that one imports the
 * dispatcher and the dispatcher's module holds the Apply command.
 *
 * **A refusal counts nothing**, and that is deliberate rather than a swallowed failure: the refusals this channel
 * declares — not open, busy, poisoned — are the document's state, so the command that follows meets the same one on its
 * own call and reports it in the place it belongs.
 */
export async function countPendingRedactions(client: ContractClient, docId: DocId): Promise<number | undefined> {
  const read = await readWholeList(
    (from) => client['document.annotations']({ docId, from }),
    (part) => part.annotations,
  );
  if (!read.ok) return undefined;
  return read.value.items.filter((annotation) => annotation.kind === 'redact').length;
}
