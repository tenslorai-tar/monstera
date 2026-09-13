import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  DOCUSIGN_NOTICE_NO_ACCOUNT,
  DOCUSIGN_NOTICE_NO_INTEGRATION_KEY,
  DOCUSIGN_NOTICE_NOT_COMPLETED,
  DOCUSIGN_NOTICE_NOTHING_SENT,
  DOCUSIGN_NOTICE_REJECTED,
  DOCUSIGN_NOTICE_SECRETS_UNAVAILABLE,
  DOCUSIGN_NOTICE_SENT,
  DOCUSIGN_NOTICE_SIGN_IN_CANCELLED,
  DOCUSIGN_NOTICE_SIGN_IN_DENIED,
  DOCUSIGN_NOTICE_SIGN_IN_TIMED_OUT,
  DOCUSIGN_NOTICE_SIGN_IN_UNAVAILABLE,
  DOCUSIGN_NOTICE_UNAUTHORISED,
  DOCUSIGN_NOTICE_UNEXPECTED_ANSWER,
  DOCUSIGN_NOTICE_UNREACHABLE,
} from '../messages/en.js';
import type { DocusignNotice } from './docusignNotice.js';

/**
 * Each outcome's sentence, exhaustive over the dialog's own list.
 *
 * A `Record`, so an outcome added to the contract's refusals without a sentence here
 * is a compile error rather than whichever sentence a conditional happened to print.
 */
const SENTENCES: Readonly<Record<DocusignNotice, MessageKey>> = {
  'no-integration-key': DOCUSIGN_NOTICE_NO_INTEGRATION_KEY,
  'secrets-unavailable': DOCUSIGN_NOTICE_SECRETS_UNAVAILABLE,
  'sign-in-cancelled': DOCUSIGN_NOTICE_SIGN_IN_CANCELLED,
  'sign-in-timed-out': DOCUSIGN_NOTICE_SIGN_IN_TIMED_OUT,
  'sign-in-denied': DOCUSIGN_NOTICE_SIGN_IN_DENIED,
  'sign-in-unavailable': DOCUSIGN_NOTICE_SIGN_IN_UNAVAILABLE,
  unauthorised: DOCUSIGN_NOTICE_UNAUTHORISED,
  rejected: DOCUSIGN_NOTICE_REJECTED,
  unreachable: DOCUSIGN_NOTICE_UNREACHABLE,
  'unexpected-answer': DOCUSIGN_NOTICE_UNEXPECTED_ANSWER,
  'no-account': DOCUSIGN_NOTICE_NO_ACCOUNT,
  sent: DOCUSIGN_NOTICE_SENT,
  'nothing-sent': DOCUSIGN_NOTICE_NOTHING_SENT,
  'not-completed': DOCUSIGN_NOTICE_NOT_COMPLETED,
};

/**
 * What happened with DocuSign, in one sentence.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function DocusignNoticeBody({
  reason,
  status,
}: {
  readonly reason: DocusignNotice;
  readonly status?: string | undefined;
}): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-docusign-notice">
      <p>{_(SENTENCES[reason], { status: status ?? '' })}</p>
    </div>
  );
}
