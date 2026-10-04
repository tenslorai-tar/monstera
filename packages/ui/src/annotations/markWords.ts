import type { Channels, ContractClient, FailureOf } from '@monstera/contract';
import type { DocId, DocVersion, Failure } from '@monstera/shared';

import type { AnnotationSelection, SelectedAnnotation } from './selectTool.js';

/**
 * What an editor may start from for one mark's comment.
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

/** One mark as the walk listed it, at the version the walk was read at: what its words are read by. */
export interface WordsMark {
  readonly page: number;
  readonly version: DocVersion;
  readonly index: number;
  /** The walk's text, whole unless {@link cut}. */
  readonly contents: string;
  readonly cut?: true | undefined;
}

/** How an editor reads the words it starts from — {@link wordsToEdit}, bound to the document on screen. */
export type WordsOf = (mark: WordsMark) => Promise<WordsToEdit>;

/** The one selected mark of a selection, as {@link WordsOf} names it. */
export function markOf(selection: AnnotationSelection, item: SelectedAnnotation): WordsMark {
  return { page: selection.page, version: selection.version, index: item.index, contents: item.contents, cut: item.cut };
}

/**
 * The comment an editor opens on: the walk's own text, or the mark's whole words when the walk cut them.
 *
 * ## Why an editor reads at all
 *
 * The walk lists a comment as one line in a panel, sliced, and says `cut` when it did. An editor that started from the
 * slice would save it over the whole, so a long comment written elsewhere would lose its end to any edit, including
 * one that only fixed a typo at the start. Every editor of a mark's words takes its starting text from here, so none
 * of them can start from the slice by forgetting the flag.
 *
 * ## At the walk's version
 *
 * The handle is a position in the walk the mark was read from, so the read names that version and main answers
 * `stale` when the document has moved, rather than another mark's words. An uncut comment is not read again: it is
 * already whole, and it came from the same walk the handle points into.
 */
export async function wordsToEdit(client: ContractClient, docId: DocId, mark: WordsMark): Promise<WordsToEdit> {
  if (mark.cut !== true) return { kind: 'words', text: mark.contents };
  const answer = await client['document.annotationWords']({
    docId,
    page: mark.page,
    index: mark.index,
    version: mark.version,
  });
  if (!answer.ok) return { kind: 'problem', problem: answer.error };
  if (answer.value.kind === 'stale') return { kind: 'problem', problem: { code: 'stale-target' } };
  return answer.value.whole ? { kind: 'words', text: answer.value.text } : { kind: 'too-long' };
}
