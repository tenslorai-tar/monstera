import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  PAGE_PLACEMENT_AFTER,
  PAGE_PLACEMENT_BEFORE,
  PAGE_PLACEMENT_FIRST,
  PAGE_PLACEMENT_LAST,
  PAGE_PLACEMENT_NUMBER,
  PAGE_PLACEMENT_PAGE,
  PAGE_PLACEMENT_RANGE,
  PAGE_PLACEMENT_SIDE,
  PAGE_PLACEMENT_WHICH,
  PAGE_PLACEMENT_WHERE,
} from '../messages/en.js';
import { DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import { type PagePlacementDraft, type PlacementPage, type PlacementSide, placementAt } from './pagePlacementDraft.js';

export type { PagePlacementDraft } from './pagePlacementDraft.js';

/**
 * WHERE NEW PAGES GO, asked once for every dialog that inserts pages (the owner's O3): Blank page, Insert image, Insert
 * from PDF, Merge and Insert from Markdown each asked it in their own words — *before or after page N*, *at the start, at
 * the end or after page N* — and each converted the answer itself. One question, one row and one conversion (B3a); the
 * value and the conversion are `pagePlacementDraft.ts`.
 */

/** A placement's state: what it holds, its setter, and the position it names. */
export interface PagePlacement {
  readonly value: PagePlacementDraft;
  readonly set: (next: PagePlacementDraft) => void;
  readonly at: number | undefined;
  readonly pageCount: number;
}

/**
 * Holds a placement: `draft` where the dialog is reopened with one, else `start`, else after the page on show (zero-based
 * `page`), which is where a person reading it means.
 */
export function usePagePlacement(
  pageCount: number,
  page: number,
  draft?: PagePlacementDraft,
  start?: Omit<PagePlacementDraft, 'typed'>,
): PagePlacement {
  const [value, set] = useState<PagePlacementDraft>(
    draft ?? { side: start?.side ?? 'after', page: start?.page ?? 'page', typed: String(page + 1) },
  );
  return { value, set, at: placementAt(value, pageCount), pageCount };
}

/**
 * The row: before or after, and which page. A page outside the document is said once the dialog's action has been
 * pressed (`tried`), `PageRangeChoice`'s rule: a row that told a person they were wrong while they typed would read as
 * broken.
 */
export function PagePlacementRow({ placement, tried }: { readonly placement: PagePlacement; readonly tried: boolean }): ReactElement {
  const { _ } = useLingui();
  const { value, set } = placement;
  const problem = tried && placement.at === undefined ? _(PAGE_PLACEMENT_RANGE, { last: placement.pageCount }) : '';
  return (
    <DialogRow label={PAGE_PLACEMENT_WHERE} problem={problem}>
      <div className="m-page-placement" data-page-placement="">
        <SegmentedControl<PlacementSide>
          label={PAGE_PLACEMENT_SIDE}
          options={[
            { value: 'before', label: PAGE_PLACEMENT_BEFORE },
            { value: 'after', label: PAGE_PLACEMENT_AFTER },
          ]}
          value={value.side}
          onChange={(side) => {
            set({ ...value, side });
          }}
        />
        <SegmentedControl<PlacementPage>
          label={PAGE_PLACEMENT_WHICH}
          options={[
            { value: 'first', label: PAGE_PLACEMENT_FIRST },
            { value: 'last', label: PAGE_PLACEMENT_LAST },
            { value: 'page', label: PAGE_PLACEMENT_PAGE },
          ]}
          value={value.page}
          onChange={(which) => {
            set({ ...value, page: which });
          }}
        />
        {value.page === 'page' ? (
          // NAMED *Page number* for a screen reader and not on screen, where the segment beside it already says *Page*.
          <span className="m-page-number-field">
            <Input
              invalid={problem !== ''}
              label={PAGE_PLACEMENT_NUMBER}
              labelShownBeside
              value={value.typed}
              onValueChange={(typed) => {
                set({ ...value, typed });
              }}
            />
          </span>
        ) : null}
      </div>
    </DialogRow>
  );
}
