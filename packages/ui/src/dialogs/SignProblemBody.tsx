import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  SIGN_PROBLEM_IMAGE_TOO_LARGE,
  SIGN_PROBLEM_IMAGE_UNREADABLE,
  SIGN_PROBLEM_UNENCODABLE_TEXT,
  SIGN_PROBLEM_UNREADABLE,
  SIGN_PROBLEM_WRONG_PASSPHRASE,
} from '../messages/en.js';
import type { SIGN_PROBLEMS } from './signProblem.js';

/**
 * Each reason's sentence, exhaustive over the dialog's own list.
 *
 * A `Record` rather than a conditional, so a reason added to `SIGN_PROBLEMS`
 * without a sentence is a compile error instead of whichever sentence the last
 * branch happened to print.
 */
const SENTENCES: Readonly<Record<(typeof SIGN_PROBLEMS)[number], MessageKey>> = {
  'wrong-passphrase': SIGN_PROBLEM_WRONG_PASSPHRASE,
  unreadable: SIGN_PROBLEM_UNREADABLE,
  'unencodable-text': SIGN_PROBLEM_UNENCODABLE_TEXT,
  'image-unreadable': SIGN_PROBLEM_IMAGE_UNREADABLE,
  'image-too-large': SIGN_PROBLEM_IMAGE_TOO_LARGE,
};

/**
 * Says why the document was not signed.
 *
 * Every sentence ends by saying nothing has been changed — which is the fact a
 * person most needs after an operation that was going to alter their document,
 * and which is true because each refusal happens before the bus applies
 * anything.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function SignProblemBody({
  reason,
}: {
  readonly reason: (typeof SIGN_PROBLEMS)[number];
}): ReactElement {
  const { _ } = useLingui();

  return (
    <div className="m-sign-problem">
      <p>{_(SENTENCES[reason])}</p>
    </div>
  );
}
