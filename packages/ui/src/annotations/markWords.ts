import type { Channels, ContractClient, FailureOf } from '@monstera/contract';
import type { DocId, Failure } from '@monstera/shared';

import type { AnnotationSelection, SelectedAnnotation } from './selectTool.js';

/**
 * What an editor may start from for one selected mark's comment.
 *
 * `too-long` and `problem` are two outcomes rather than one because the person is told different things: a comment
 * past what an edit can write back is a fact about the comment and stays true, while a refusal or a moved document is
 * the lane's. A refusal is carried whole, so an `internal` one keeps the incident id the problem dialog shows.
 */
export type WordsToEdit =
  | { readonly kind: 'words'; readonly text: string }
  | { readonly kind: 'too-long' }
  | {
      readonly kind: 'problem';
      readonly problem: Failure<FailureOf<Channels, 'document.annotationWords'>> | { readonly code: 'stale-target' };
    };

/**
 * The comment an editor opens on: the walk's own text, or the mark's whole words when the walk cut them.
 *
 * ## Why an editor reads at all
 *
 * The walk lists a comment as one line in a panel, sliced, and says `cut` when it did. An editor that started from the
 * slice would save it over the whole, so a long comment written elsewhere would lose its end to any edit, including
 * one that only fixed a typo at the start. Every editor of a mark's comment takes its starting text from here, so none
 * of them can start from the slice by forgetting the flag.
 *
 * ## At the selection's version
 *
 * The handle is a position in the walk the selection was read from, so the read names that version and main answers
 * `stale` when the document has moved, rather than another mark's words. An uncut comment is not read again: it is
 * already whole, and it came from the same walk the handle points into.
 */
export async function wordsToEdit(
  client: ContractClient,
  docId: DocId,
  selection: AnnotationSelection,
  item: SelectedAnnotation,
): Promise<WordsToEdit> {
  if (item.cut !== true) return { kind: 'words', text: item.contents };
  const answer = await client['document.annotationWords']({
    docId,
    page: selection.page,
    index: item.index,
    version: selection.version,
  });
  if (!answer.ok) return { kind: 'problem', problem: answer.error };
  if (answer.value.kind === 'stale') return { kind: 'problem', problem: { code: 'stale-target' } };
  return answer.value.whole ? { kind: 'words', text: answer.value.text } : { kind: 'too-long' };
}
