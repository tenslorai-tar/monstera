import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  DUPLICATE_PAGES_COMPARED,
  DUPLICATE_PAGES_GROUP,
  DUPLICATE_PAGES_NONE,
  DUPLICATE_PAGES_REMOVE,
  DUPLICATE_PAGES_TRUNCATED,
} from '../messages/en.js';
import { pdfjsPageOf } from '../pageNumbering.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { DuplicatePagesAnswer } from './duplicatePagesResult.js';

/**
 * What the engine found, and the offer to remove the extra copies.
 *
 * ## The FIRST page of each group is kept
 *
 * Which copy survives has to be decided by something, and the earliest is the
 * only choice a reader can predict without being told. It is also the one that
 * keeps a document's own order meaningful: removing the first copy of every
 * group moves the surviving content to wherever the last duplicate happened to
 * be.
 *
 * ## The numbers shown are ONE-BASED and the ones answered are not
 *
 * `pageNumbering.ts` is where the two frames meet, and this body converts once
 * for the label. The answer carries the model's own indices, so the command
 * that receives it does no arithmetic — the same rule the crop and delete
 * dialogs follow.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function DuplicatePagesBody({
  groups,
  truncated,
  resolve,
}: {
  readonly groups: readonly { readonly pages: readonly number[] }[];
  readonly truncated: boolean;
} & DialogAnswering<DuplicatePagesAnswer>): ReactElement {
  const { _ } = useLingui();
  const extras = groups.flatMap((group) => group.pages.slice(1));

  return (
    <div className="m-duplicate-pages">
      {/* WHAT WAS COMPARED, before the list. The finder understates, and a list
          headed *duplicates* with no such sentence is one a person acts on
          without asking what it means. */}
      <p className="m-duplicate-pages__compared">{_(DUPLICATE_PAGES_COMPARED)}</p>
      {truncated ? (
        <p className="m-duplicate-pages__truncated" role="status">
          {_(DUPLICATE_PAGES_TRUNCATED)}
        </p>
      ) : null}
      {groups.length === 0 ? (
        <p className="m-duplicate-pages__none">{_(DUPLICATE_PAGES_NONE)}</p>
      ) : (
        <ul className="m-duplicate-pages__groups">
          {groups.map((group) => (
            <li key={group.pages.join(',')}>
              {_(DUPLICATE_PAGES_GROUP, {
                pages: group.pages.map((page) => pdfjsPageOf(page)).join(', '),
              })}
            </li>
          ))}
        </ul>
      )}
      <Button
        label={DUPLICATE_PAGES_REMOVE}
        values={{ count: extras.length }}
        variant="primary"
        disabled={extras.length === 0}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute, for
          // `DeletePagesBody`'s reason: the result schema refuses an empty
          // list, and a mismatch would be a thrown `DialogResultRejected` over
          // the user's document.
          if (extras.length === 0) return;
          resolve({ pages: extras });
        }}
      />
    </div>
  );
}
