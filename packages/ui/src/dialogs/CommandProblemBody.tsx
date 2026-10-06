import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { type CommandProblem, problemMessage, problemParticulars } from './problemMessages.js';

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
 * A declared detail is shown the same way (ADR-0169 Decision 4): an edit PDFium refused has the step and PDFium's
 * number as its reference, and a font's refusal names the characters. `problemParticulars` decides which, for every
 * surface that says a problem.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function CommandProblemBody(problem: CommandProblem): ReactElement {
  const { _ } = useLingui();
  const particulars = problemParticulars(problem);

  return (
    <div className="m-command-problem">
      <p>{_(problemMessage(problem))}</p>
      {particulars === undefined ? null : (
        <dl className="m-command-problem-reference">
          <dt>{_(particulars.label)}</dt>
          <dd>{particulars.value}</dd>
        </dl>
      )}
    </div>
  );
}
