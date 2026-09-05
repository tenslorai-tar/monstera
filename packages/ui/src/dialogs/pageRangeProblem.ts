import type { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';

import {
  DELETE_PAGES_BACKWARDS,
  DELETE_PAGES_NOT_A_NUMBER,
  DELETE_PAGES_OUT_OF_RANGE,
} from '../messages/en.js';
import type { parsePageRanges } from '../pageRanges.js';

/**
 * The sentence for a failed page-range parse, or nothing while the field is
 * untouched.
 *
 * ## Shared at the SECOND caller, because three of its four sentences are not
 * about the operation
 *
 * *"is not a page or a page range"*, *"is outside this document"* and *"counts
 * backwards"* are facts about the text, identical whether the pages are being
 * deleted, extracted or split out. Only the empty case names the operation, so
 * that one key travels in and the rest are shared.
 *
 * Copying them per dialog would be three near-identical strings per operation
 * in the catalogue, and a translator would meet the same sentence three times
 * with no way to know they must stay identical.
 *
 * ## Empty text is not a complaint
 *
 * `DeletePagesBody`'s rule, kept here with the code that enforces it: a dialog
 * that opens already telling the user they got it wrong reads as broken, and
 * the apply control is disabled either way — which is the honest statement that
 * nothing is ready yet.
 *
 * ## Each sentence names the offending PART
 *
 * What a message describing the class cannot do: *"that is not a page range"*
 * leaves a person re-reading a whole expression to find which comma-separated
 * piece was wrong.
 *
 * @param translate `useLingui`'s resolver, handed in rather than called here —
 *   a hook needs a component, and this is a function of its arguments.
 * @param empty the operation's own *nothing typed yet* sentence.
 */
export function renderRangeProblem(
  parsed: ReturnType<typeof parsePageRanges>,
  text: string,
  translate: ReturnType<typeof useLingui>['_'],
  empty: MessageKey,
): string {
  if (parsed.ok || text.trim().length === 0) return '';
  const problem = parsed.error;
  switch (problem.kind) {
    case 'empty':
      return translate(empty);
    case 'backwards':
      return translate(DELETE_PAGES_BACKWARDS, { part: problem.part });
    case 'out-of-range':
      return translate(DELETE_PAGES_OUT_OF_RANGE, {
        part: problem.part,
        pageCount: problem.pageCount,
      });
    case 'not-a-number':
      return translate(DELETE_PAGES_NOT_A_NUMBER, { part: problem.part });
  }
}
