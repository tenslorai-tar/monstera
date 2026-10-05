import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { PROBLEM_REFERENCE_LABEL } from '../messages/en.js';
import { type CommandProblem, problemMessage } from './problemMessages.js';

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
 * An edit PDFium refused has a reference of the same kind: the step that refused and the number PDFium answered
 * (ADR-0169 Decision 4), which together say where in the rewrite it stopped.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function CommandProblemBody(problem: CommandProblem): ReactElement {
  const { _ } = useLingui();
  const reference = referenceOf(problem);

  return (
    <div className="m-command-problem">
      <p>{_(problemMessage(problem))}</p>
      {reference === undefined ? null : (
        <dl className="m-command-problem-reference">
          <dt>{_(PROBLEM_REFERENCE_LABEL)}</dt>
          <dd>{reference}</dd>
        </dl>
      )}
    </div>
  );
}

/** The value a person can quote for this problem, where it has one. */
function referenceOf(problem: CommandProblem): string | undefined {
  if (problem.code === 'internal') return problem.incident;
  if (problem.code === 'edit-refused') return `${problem.detail.step} ${String(problem.detail.engineError)}`;
  return undefined;
}
