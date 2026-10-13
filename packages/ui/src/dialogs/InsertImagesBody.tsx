import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { INSERT_IMAGES_APPLY, INSERT_IMAGES_NOTE } from '../messages/en.js';
import { useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { PagePlacementRow, usePagePlacement } from './PagePlacement.js';
import type { InsertImagesAnswer } from './insertImagesResult.js';

/**
 * The insert-images dialog's body (the owner's O3): where, by the one placement row, and what happens next said before
 * it happens — a picture is a page, and the pictures are saved as a PDF that opens beside this one. A default export
 * because `declareDialog` takes a `lazy()` component.
 */
export default function InsertImagesBody({
  pageCount,
  page,
  resolve,
}: {
  readonly pageCount: number;
  /** Zero-based. */
  readonly page: number;
} & DialogAnswering<InsertImagesAnswer>): ReactElement {
  const { _ } = useLingui();
  const placement = usePagePlacement(pageCount, page);
  const attempt = useAttempt();

  return (
    <div className="m-insert-images">
      <PagePlacementRow placement={placement} tried={attempt.tried} />
      <p className="m-insert-images__note">{_(INSERT_IMAGES_NOTE)}</p>
      <DialogFooter>
        <Button
          label={INSERT_IMAGES_APPLY}
          variant="primary"
          onClick={() => {
            attempt.attempt();
            if (placement.at === undefined) return;
            resolve({ at: placement.at });
          }}
        />
      </DialogFooter>
    </div>
  );
}
