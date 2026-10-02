import type { CloudProviderId } from '@monstera/contract';
import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { z } from 'zod';

import {
  CLOUD_PROVIDER_NAMES,
  CLOUD_VIEW_ONLY_FORBIDDEN,
  CLOUD_VIEW_ONLY_OPENED,
  CLOUD_VIEW_ONLY_READ_ONLY,
  CLOUD_VIEW_ONLY_SAVE_COPY,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { CLOUD_VIEW_ONLY_RESULT, CloudViewOnlyMoment } from './cloudViewOnly.js';

/** The sentence for each moment: said before an edit, or after Save back kept the changes here. */
const TEXT: Readonly<Record<CloudViewOnlyMoment, MessageKey>> = {
  opened: CLOUD_VIEW_ONLY_OPENED,
  'read-only': CLOUD_VIEW_ONLY_READ_ONLY,
  forbidden: CLOUD_VIEW_ONLY_FORBIDDEN,
};

export default function CloudViewOnlyBody({
  provider,
  moment,
  resolve,
}: {
  readonly provider: CloudProviderId;
  readonly moment: CloudViewOnlyMoment;
} & DialogAnswering<z.infer<typeof CLOUD_VIEW_ONLY_RESULT>>): ReactElement {
  const { _ } = useLingui();
  const name = _(CLOUD_PROVIDER_NAMES[provider]);
  return (
    <div className="m-cloud__outcome" data-cloud-view-only={moment}>
      <p>{_(TEXT[moment], { provider: name })}</p>
      <DialogFooter>
        <Button
          label={CLOUD_VIEW_ONLY_SAVE_COPY}
          values={{ provider: name }}
          onClick={() => {
            resolve({ kind: 'save-copy' });
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}
