import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  FOLLOW_LINK_EXPLAINS,
  FOLLOW_LINK_OPEN,
  FOLLOW_LINK_REFUSED,
  FOLLOW_LINK_REFUSED_NO_SCHEME,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';

/**
 * Names where a web link goes, with *Open link* the one way on (ADR-0167). The address is shown whole as the listing
 * holds it, broken anywhere, because a person deciding whether to follow a link must be able to read all of it; a
 * scheme that is not followed is said under it, with nothing to press but OK.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function FollowLinkBody({
  address,
  followable,
  scheme,
  resolve,
}: DialogAnswering<{ readonly open: true }> & {
  readonly address: string;
  readonly followable: boolean;
  readonly scheme: string | null;
}): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-follow-link">
      <p>{_(FOLLOW_LINK_EXPLAINS)}</p>
      <p className="m-follow-link__address" data-follow-link-address="">
        {address}
      </p>
      {followable ? (
        <DialogFooter>
          <Button
            label={FOLLOW_LINK_OPEN}
            variant="primary"
            onClick={() => {
              resolve({ open: true });
            }}
          />
        </DialogFooter>
      ) : (
        <>
          <p>{scheme === null ? _(FOLLOW_LINK_REFUSED_NO_SCHEME) : _(FOLLOW_LINK_REFUSED, { scheme })}</p>
          {/* A REFUSAL ASKS NOTHING, so its one button acknowledges it: `DialogFooter`'s `ok`. */}
          <DialogFooter dismissal="ok" />
        </>
      )}
    </div>
  );
}
