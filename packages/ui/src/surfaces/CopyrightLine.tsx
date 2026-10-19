import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { COPYRIGHT_PUBLISHER, COPYRIGHT_PUBLISHER_OPEN, COPYRIGHT_SIGN } from '../messages/en.js';
import { Button } from '../primitives/Button.js';

/**
 * The © line: the sign, and the copyright holder's name as a link to its site (the owner's review of 0.1.16.0, R5).
 *
 * **The © is the copyright notice, and it stays**: Tenslor Inc. holds the copyright in the code, and the AGPL is the
 * permission granted under it, so the notice is what the licence rests on.
 *
 * **One component for both places it is drawn**, the start screen's footer and About, so the two cannot drift into
 * two spellings of one notice (B3a). The name is the button primitive's `quiet` variant — words, as the footer's other
 * links are, with its focus ring — and it opens nothing itself: `onPublisher` is the caller's way to the one route that
 * opens a page by its name (`app.openWebPage`, `publisher`), so this component cannot hold an address.
 */
export function CopyrightLine({ onPublisher }: { readonly onPublisher: () => void }): ReactElement {
  const { _ } = useLingui();
  return (
    <span className="m-copyright">
      <span>{_(COPYRIGHT_SIGN)}</span>
      <Button label={COPYRIGHT_PUBLISHER_OPEN} onClick={onPublisher} shown={COPYRIGHT_PUBLISHER} variant="quiet" />
    </span>
  );
}
