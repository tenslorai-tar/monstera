import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import { CLOUD_PROBLEMS, SAVE_BACK_DONE, SAVE_BACK_NOT_FROM_CLOUD, SAVE_BACK_SAVE_FAILED } from '../messages/en.js';
import type { CloudOutcome } from './cloudOutcome.js';

/** The sentence for each outcome: the three of *Save back*'s own, then every refusal's. */
const TEXT: Readonly<Record<CloudOutcome, MessageKey>> = {
  'saved-back': SAVE_BACK_DONE,
  'not-from-cloud': SAVE_BACK_NOT_FROM_CLOUD,
  'save-failed': SAVE_BACK_SAVE_FAILED,
  ...CLOUD_PROBLEMS,
};

export default function CloudOutcomeBody({ outcome }: { readonly outcome: CloudOutcome }): ReactElement {
  const { _ } = useLingui();
  return (
    <p className="m-cloud__outcome" data-cloud-outcome={outcome}>
      {_(TEXT[outcome])}
    </p>
  );
}
