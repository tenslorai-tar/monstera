import { useLingui } from '@lingui/react';
import { MAX_BLANK_PAGES } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { INSERT_BLANK_PAGE_APPLY, INSERT_BLANK_PAGE_COUNT, INSERT_BLANK_PAGE_COUNT_RANGE } from '../messages/en.js';
import { useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { PagePlacementRow, usePagePlacement } from './PagePlacement.js';
import type { InsertBlankPageAnswer } from './insertBlankPageResult.js';

/** A typed count of pages, or `undefined` where it is not a whole number from 1 to the command's bound. */
export function blankPageCount(typed: string): number | undefined {
  const trimmed = typed.trim();
  if (!/^\d+$/u.test(trimmed)) return undefined;
  const count = Number.parseInt(trimmed, 10);
  return count >= 1 && count <= MAX_BLANK_PAGES ? count : undefined;
}

/**
 * The blank page dialog's body (the owner's O3): how many pages, and where by the one placement row. It opens on one
 * page after the page on show. A default export because `declareDialog` takes a `lazy()` component.
 */
export default function InsertBlankPageBody({
  pageCount,
  page,
  resolve,
}: {
  readonly pageCount: number;
  /** Zero-based. */
  readonly page: number;
} & DialogAnswering<InsertBlankPageAnswer>): ReactElement {
  const { _ } = useLingui();
  const [typed, setTyped] = useState('1');
  const placement = usePagePlacement(pageCount, page);
  const attempt = useAttempt();
  const count = blankPageCount(typed);
  // SAID ON THE PRESS, `PagePlacementRow`'s rule: a field that told a person they were wrong while they typed reads as broken.
  const countProblem = attempt.tried && count === undefined ? _(INSERT_BLANK_PAGE_COUNT_RANGE, { limit: MAX_BLANK_PAGES }) : '';

  return (
    <div className="m-insert-blank-page">
      <DialogRow label={INSERT_BLANK_PAGE_COUNT} problem={countProblem}>
        <Input
          invalid={countProblem !== ''}
          label={INSERT_BLANK_PAGE_COUNT}
          labelShownBeside
          opensFocused
          value={typed}
          onValueChange={setTyped}
        />
      </DialogRow>
      <PagePlacementRow placement={placement} tried={attempt.tried} />
      <DialogFooter>
        <Button
          label={INSERT_BLANK_PAGE_APPLY}
          variant="primary"
          onClick={() => {
            attempt.attempt();
            if (placement.at === undefined || count === undefined) return;
            resolve({ at: placement.at, count });
          }}
        />
      </DialogFooter>
    </div>
  );
}
