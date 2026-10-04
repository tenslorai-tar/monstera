import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { PROBLEM_REFERENCE_LABEL } from '../messages/en.js';
import { type CommandProblem, PROBLEM_MESSAGE } from './problemMessages.js';

export type { CommandProblem } from './problemMessages.js';

/**
 * The command-problem dialog's body.
 *
 * ## The reference is rendered, and it is the only part of a diagnostic that exists here
 *
 * ADR-0009 §9 keeps the message, the stack and the cause main-side and hands the
 * renderer an opaque id. Rendering it is what makes the id worth minting: a user
 * can quote it, and it names the log entry holding the real text. It is a `<dl>`
 * rather than a sentence because it is a value with a label, and the value is
 * not translatable text.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function CommandProblemBody(problem: CommandProblem): ReactElement {
  const { _ } = useLingui();

  return (
    <div className="m-command-problem">
      <p>{_(PROBLEM_MESSAGE[problem.code])}</p>
      {problem.code === 'internal' ? (
        <dl className="m-command-problem-reference">
          <dt>{_(PROBLEM_REFERENCE_LABEL)}</dt>
          <dd>{problem.incident}</dd>
        </dl>
      ) : null}
    </div>
  );
}
