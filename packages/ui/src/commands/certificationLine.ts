import type { ContractClient } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import type { DocumentStore } from '../documentStores.js';

/**
 * Reads a document's certification into its store, where its layer draws the line
 * ([ADR-0291](../../../../docs/DECISIONS/0291-a-certified-document-is-locked-to-what-its-certifier-allowed-and-worked-on-as-a-copy.md)'s
 * amendment of 2026-11-12): when it is shown, and again after it is signed, since a signing can certify it.
 *
 * ## A read that fails draws no line, and refuses nothing
 *
 * The line says what the lock will do; it is not the lock. Main asks the same read before every command, so a document
 * whose read failed here is still held to its certifier when a change is sent, and the certified window says so then.
 * A line drawn from a guess would be the one thing here that could be wrong.
 */
export async function readCertificationLine(client: ContractClient, docId: DocId, store: DocumentStore): Promise<void> {
  const answer = await client['document.certification']({ docId });
  if (!answer.ok) return;
  const { certification } = answer.value;
  store.getState().certificationShown(certification === null ? null : { kind: 'certified', ...certification });
}
