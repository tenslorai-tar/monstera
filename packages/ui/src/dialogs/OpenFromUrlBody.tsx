import { MAX_LINK_URI } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  OPEN_FROM_URL_APPLY,
  OPEN_FROM_URL_EMPTY,
  OPEN_FROM_URL_LABEL,
  OPEN_FROM_URL_SCHEME,
  OPEN_FROM_URL_TOO_LONG,
} from '../messages/en.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { AnnotationTextForm } from './AnnotationTextForm.js';
import type { OpenFromUrlAnswer } from './openFromUrl.js';

/**
 * Where the PDF is, on the web.
 *
 * `LinkAddressBody`'s form with one scheme instead of three: the guard fetches `https:`
 * alone, so a person meets that sentence here rather than a refusal after pressing Open.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function OpenFromUrlBody({ resolve }: DialogAnswering<OpenFromUrlAnswer>): ReactElement {
  return (
    <AnnotationTextForm
      apply={OPEN_FROM_URL_APPLY}
      empty={OPEN_FROM_URL_EMPTY}
      label={OPEN_FROM_URL_LABEL}
      limit={MAX_LINK_URI}
      resolve={resolve}
      tooLong={OPEN_FROM_URL_TOO_LONG}
      validate={secure}
    />
  );
}

/** `undefined` for an address this build will try to fetch. */
function secure(value: string): MessageKey | undefined {
  try {
    return new URL(value).protocol === 'https:' ? undefined : OPEN_FROM_URL_SCHEME;
  } catch (error) {
    // A STRING `URL` CANNOT PARSE is the same problem to a person as a wrong scheme —
    // `LinkAddressBody`'s reason — and `URL` signals it with this one error.
    if (!(error instanceof TypeError)) throw error;
    return OPEN_FROM_URL_SCHEME;
  }
}
