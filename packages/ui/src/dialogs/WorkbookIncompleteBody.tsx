import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { WORKBOOK_INCOMPLETE_BLOCK, WORKBOOK_INCOMPLETE_MORE, WORKBOOK_INCOMPLETE_SAID } from '../messages/en.js';
import { DialogScroll } from '../primitives/Dialog.js';
import type { WorkbookIncomplete } from './workbookIncomplete.js';

/**
 * The rows a workbook's PDF does not hold: a sentence, the named blocks, and how many more.
 *
 * THE LIST SCROLLS, NOT THE BODY: sixty-four blocks are taller than the window, and with the body scrolling the OK button
 * and the count of the rest went below the fold (seen 2026-10-02 at 1280 x 800). The sentence above and the count below
 * stay in view beside the footer.
 *
 * A fragment, so the scroll part is the body's own child, which is what the dialog's layout keys on.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function WorkbookIncompleteBody({ missing, more }: WorkbookIncomplete): ReactElement {
  const { _ } = useLingui();
  return (
    <>
      <p className="m-workbook-incomplete__said">{_(WORKBOOK_INCOMPLETE_SAID)}</p>
      <DialogScroll>
        <ul className="m-dialog-list m-workbook-incomplete__list" data-missing-blocks={missing.length}>
          {missing.map((block) => (
            <li key={`${block.sheet}:${String(block.from)}`}>
              {_(WORKBOOK_INCOMPLETE_BLOCK, { sheet: block.sheet, from: block.from, to: block.to })}
            </li>
          ))}
        </ul>
      </DialogScroll>
      {more > 0 ? (
        <p className="m-workbook-incomplete__more" data-more-blocks={more}>
          {_(WORKBOOK_INCOMPLETE_MORE, { count: more })}
        </p>
      ) : null}
    </>
  );
}
