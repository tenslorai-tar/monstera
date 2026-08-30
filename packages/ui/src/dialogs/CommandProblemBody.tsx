import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  PROBLEM_BUSY,
  PROBLEM_INTERNAL,
  PROBLEM_NOT_OPEN,
  PROBLEM_NO_CHECKPOINT,
  PROBLEM_POISONED,
  PROBLEM_REFERENCE_LABEL,
} from '../messages/en.js';

/** Every failure code a document command can hand a renderer. */
export type CommandProblem =
  | { readonly code: 'document-not-open' }
  | { readonly code: 'document-busy' }
  | { readonly code: 'document-poisoned' }
  | { readonly code: 'checkpoint-restore-not-built' }
  | { readonly code: 'internal'; readonly incident: string };

/**
 * The sentence for each code.
 *
 * A `Record` keyed by the code, for the reason `SaveProblemBody` uses one: the
 * union comes from the **channels**, so it grows in a file nobody editing this
 * one will open, and a missing key must land on the table rather than on a
 * return path that quietly yields `undefined`.
 */
const MESSAGE: Readonly<Record<CommandProblem['code'], MessageKey>> = {
  'document-not-open': PROBLEM_NOT_OPEN,
  'document-busy': PROBLEM_BUSY,
  'document-poisoned': PROBLEM_POISONED,
  'checkpoint-restore-not-built': PROBLEM_NO_CHECKPOINT,
  internal: PROBLEM_INTERNAL,
};

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
      <p>{_(MESSAGE[problem.code])}</p>
      {problem.code === 'internal' ? (
        <dl className="m-command-problem-reference">
          <dt>{_(PROBLEM_REFERENCE_LABEL)}</dt>
          <dd>{problem.incident}</dd>
        </dl>
      ) : null}
    </div>
  );
}
