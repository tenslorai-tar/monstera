import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { OPEN_PROBLEM_SENTENCE, type OpenProblemReport } from './openProblemReasons.js';

/**
 * What an open that ended with no document says: ONE rendering for the start screen's line and the dialog over a
 * document alike, so the two never say different things about the same problem (B3a).
 *
 * A single problem with no file to name is the sentence on its own. Anything else is a list — each file by NAME, then
 * what happened to it — because a person who opened five files and was told only that "that file could not be opened"
 * has not been told which. The files that did open are on screen and are not listed here.
 */
export function OpenProblemLines(props: { readonly problems: readonly OpenProblemReport[] }): ReactElement {
  const { _ } = useLingui();
  const [only] = props.problems;
  if (props.problems.length === 1 && only !== undefined && only.name === undefined) {
    return <>{_(OPEN_PROBLEM_SENTENCE[only.reason])}</>;
  }
  return (
    <ul className="m-open-problem-list">
      {props.problems.map((problem, index) => (
        // The list is the batch, in the order the files were given, and is never reordered or edited in place, so the
        // position names an entry: two files can share a name when they came from different folders.
        <li key={index}>
          {problem.name === undefined ? null : <strong className="m-open-problem-name">{problem.name}</strong>}
          <span>{_(OPEN_PROBLEM_SENTENCE[problem.reason])}</span>
        </li>
      ))}
    </ul>
  );
}
