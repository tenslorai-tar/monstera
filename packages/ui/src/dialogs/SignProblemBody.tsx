import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { SIGN_PROBLEM_UNREADABLE, SIGN_PROBLEM_WRONG_PASSPHRASE } from '../messages/en.js';

/**
 * Says why the document was not signed.
 *
 * Two sentences, and both end by saying nothing has been changed — which is the
 * fact a person most needs after an operation that was going to alter their
 * document, and which is true because the command throws before the bus applies
 * anything.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function SignProblemBody({
  reason,
}: {
  readonly reason: 'wrong-passphrase' | 'unreadable';
}): ReactElement {
  const { _ } = useLingui();

  return (
    <div className="m-sign-problem">
      <p>{_(reason === 'wrong-passphrase' ? SIGN_PROBLEM_WRONG_PASSPHRASE : SIGN_PROBLEM_UNREADABLE)}</p>
    </div>
  );
}
