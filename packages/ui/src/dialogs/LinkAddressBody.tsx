import { LINK_SCHEMES, MAX_LINK_URI } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  LINK_ADDRESS_APPLY,
  LINK_ADDRESS_EMPTY,
  LINK_ADDRESS_LABEL,
  LINK_ADDRESS_SCHEME,
  LINK_ADDRESS_TOO_LONG,
} from '../messages/en.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { AnnotationTextForm } from './AnnotationTextForm.js';
import type { LinkTextAnswer } from './annotationLink.js';

/**
 * Where a link goes, when it goes outside the document.
 *
 * The rule shown here is the SAME rule the payload enforces — three schemes,
 * parsed with the platform's own `URL` — and it is applied to the same value,
 * so a person meets the sentence before the control rather than a refusal over
 * their document afterwards. `LINK_SCHEMES` is imported rather than listed: the
 * set is the contract's, and a second copy would go stale the day a fourth
 * scheme is allowed and read as the rule until somebody tried one.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function LinkAddressBody({
  resolve,
}: DialogAnswering<LinkTextAnswer>): ReactElement {
  return (
    <AnnotationTextForm
      apply={LINK_ADDRESS_APPLY}
      empty={LINK_ADDRESS_EMPTY}
      label={LINK_ADDRESS_LABEL}
      limit={MAX_LINK_URI}
      resolve={resolve}
      tooLong={LINK_ADDRESS_TOO_LONG}
      validate={acceptable}
    />
  );
}

/** `undefined` when the address is one this build will write. */
function acceptable(value: string): MessageKey | undefined {
  try {
    return (LINK_SCHEMES as readonly string[]).includes(new URL(value).protocol)
      ? undefined
      : LINK_ADDRESS_SCHEME;
  } catch {
    // A STRING `URL` CANNOT PARSE is not a different problem from a scheme this
    // build refuses — both are *that is not an address a reader could follow* —
    // and one sentence naming what IS acceptable is more use than two naming
    // different ways of being wrong.
    return LINK_ADDRESS_SCHEME;
  }
}
