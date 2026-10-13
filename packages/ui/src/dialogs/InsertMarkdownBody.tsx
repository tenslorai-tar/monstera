import { COMPOSED_FAMILY_DEFAULT } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useState } from 'react';

import type { ReadFontList } from '../FontPicker.js';
import { INSERT_MARKDOWN_APPLY, INSERT_MARKDOWN_FONT } from '../messages/en.js';
import { useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { PagePlacementRow, usePagePlacement } from './PagePlacement.js';
import { ResolvedFontRow } from './ResolvedFontRow.js';
import type { InsertMarkdownAnswer } from './insertMarkdownResult.js';

/**
 * The insert-from-Markdown dialog's body: where the pages go, by the one placement row every inserting dialog asks
 * (`PagePlacement.tsx`, the owner's O3), opening at the end, and the font. A default export because `declareDialog` takes a
 * `lazy()` component.
 */
export default function InsertMarkdownBody({
  pageCount,
  page,
  fonts,
  resolve,
}: {
  readonly pageCount: number;
  /** Zero-based, as every page index crossing a boundary here is. */
  readonly page: number;
  /** The fonts main listed when the dialog opened; absent where that read failed, which the picker says in words. */
  readonly fonts?: ReadFontList | undefined;
} & DialogAnswering<InsertMarkdownAnswer>): ReactElement {
  // THE ONE PICKER (D1), opening on the face every composition was set in before there was a choice.
  const [family, setFamily] = useState<string>(COMPOSED_FAMILY_DEFAULT);
  // AT THE END is what *append* always did, so it is where the dialog opens: after the last page, by the one placement row
  // every inserting dialog asks (O3).
  const placement = usePagePlacement(pageCount, page, undefined, { side: 'after', page: 'last' });
  const attempt = useAttempt();

  return (
    <div className="m-insert-markdown">
      <PagePlacementRow placement={placement} tried={attempt.tried} />
      <ResolvedFontRow fonts={fonts} label={INSERT_MARKDOWN_FONT} value={family} onPick={setFamily} />
      <DialogFooter>
        <Button
          label={INSERT_MARKDOWN_APPLY}
          variant="primary"
          onClick={() => {
            attempt.attempt();
            if (placement.at === undefined) return;
            resolve({ at: placement.at, family });
          }}
        />
      </DialogFooter>
    </div>
  );
}
