import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';

import { readWholeList } from './readWholeList.js';

/**
 * THE ONE READER of a document's annotation walk (`document.annotations`) in this window: one read per document per
 * version, whoever asks.
 *
 * Two asked for the same answer and each paid for it: the page layers' list (`usePageAnnotations`) once per version, and
 * every press of the eraser, the select tool or a writer's reopen again, through `main`, at a version already read.
 * Measured 2026-10-21 by `measureMove.pw.ts` with a mark at each step, an eraser press waited 10 to 112 ms for that
 * second read before anything could be held, and the press-to-gone time ran to 189 ms. Asked here, a press at a
 * version already read awaits the answer already in hand.
 *
 * What is kept is the latest read per document, under the version it ANSWERED at — a read asked while the document
 * moves is kept under the version it describes, never the one it was asked at. A refused read is not kept, so the
 * next asking asks again. A command built from a kept answer carries that answer's version, which `main` refuses when
 * it is stale, as it does for any read.
 */
export interface AnnotationReads {
  /** The document's walk at `version`, the one already read if it answered at that version, or a new read. */
  readonly read: (docId: DocId, version: DocVersion | undefined) => ReturnType<typeof readAnnotations>;
  /** Drops what is kept for a document that has closed. */
  readonly forget: (docId: DocId) => void;
}

/** One whole read of a document's walk, its parts joined (`readWholeList`). */
function readAnnotations(client: ContractClient, docId: DocId) {
  return readWholeList(
    (from) => client['document.annotations']({ docId, from }),
    (part) => part.annotations,
  );
}

/**
 * The reads of `client`'s documents: ONE per client, whichever surface asks — the shell, each page list, a side-by-side
 * half — so none of them can hold a second. Keyed by the client object, which the shell hands to everything it mounts,
 * and weakly, so a client let go of takes its reads with it.
 */
export function annotationReadsFor(client: ContractClient): AnnotationReads {
  const known = READS.get(client);
  if (known !== undefined) return known;
  const made = createAnnotationReads(client);
  READS.set(client, made);
  return made;
}

const READS = new WeakMap<ContractClient, AnnotationReads>();

function createAnnotationReads(client: ContractClient): AnnotationReads {
  const kept = new Map<DocId, { readonly version: DocVersion | undefined; readonly answer: ReturnType<typeof readAnnotations> }>();
  return {
    read: (docId, version) => {
      const held = kept.get(docId);
      if (held !== undefined && version !== undefined && held.version === version) return held.answer;
      const answer = readAnnotations(client, docId);
      kept.set(docId, { version, answer });
      void answer.then(
        (read) => {
          // ONLY WHILE IT IS STILL THE LATEST, re-keyed to the version it answered at; a refusal is not kept.
          if (kept.get(docId)?.answer !== answer) return;
          if (read.ok) kept.set(docId, { version: read.value.version, answer });
          else kept.delete(docId);
        },
        () => {
          if (kept.get(docId)?.answer === answer) kept.delete(docId);
        },
      );
      return answer;
    },
    forget: (docId) => {
      kept.delete(docId);
    },
  };
}
