import { CLOUD_REFUSALS, type CloudRefusal } from '@monstera/contract';
import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import { CLOUD_PROBLEMS, SAVE_BACK_KEPT_HERE, SAVE_BACK_NOT_FROM_CLOUD, SAVE_BACK_SAVE_FAILED } from '../messages/en.js';
import type { CloudOutcome } from './cloudOutcome.js';

/** The sentence for each outcome: the two of *Save back*'s own, then every refusal's. */
const TEXT: Readonly<Record<CloudOutcome, MessageKey>> = {
  'not-from-cloud': SAVE_BACK_NOT_FROM_CLOUD,
  'save-failed': SAVE_BACK_SAVE_FAILED,
  ...CLOUD_PROBLEMS,
};

/**
 * The refusal whose own sentence already says the changes are kept here. The refusal sentences are
 * shared with the Cloud storage dialog, where most of them are about signing in or listing and
 * nothing was saved; after a save-back the working copy WAS saved first, and a person told only
 * *the provider could not be reached* cannot tell whether their work went anywhere.
 */
const SAYS_KEPT_ITSELF: ReadonlySet<CloudRefusal> = new Set(['changed-elsewhere']);

function isRefusal(outcome: CloudOutcome): outcome is CloudRefusal {
  return (CLOUD_REFUSALS as readonly string[]).includes(outcome);
}

export default function CloudOutcomeBody({ outcome }: { readonly outcome: CloudOutcome }): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-cloud__outcome" data-cloud-outcome={outcome}>
      <p>{_(TEXT[outcome])}</p>
      {isRefusal(outcome) && !SAYS_KEPT_ITSELF.has(outcome) ? <p>{_(SAVE_BACK_KEPT_HERE)}</p> : null}
    </div>
  );
}
