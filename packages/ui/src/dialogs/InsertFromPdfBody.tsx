import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  INSERT_FROM_PDF_AFTER,
  INSERT_FROM_PDF_APPLY,
  INSERT_FROM_PDF_BEFORE,
  INSERT_FROM_PDF_LABEL,
  INSERT_FROM_PDF_PAGE,
  INSERT_FROM_PDF_POSITION,
  INSERT_FROM_PDF_RANGE,
  SOURCE_PAGES_EMPTY,
  SOURCE_PAGES_NOTE,
} from '../messages/en.js';
import { useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { SourceDocumentRow } from './DocumentChoice.js';
import { PageRangeChoice, usePageRange } from './PageRangeChoice.js';
import type { InsertFromPdfAnswer } from './insertFromPdfResult.js';
import type { SourceDocument } from './sourceDocuments.js';

/** Before or after the page typed. */
type Placement = 'before' | 'after';

/**
 * The insert-from-PDF dialog's body — which document, which of its pages, and where they go.
 *
 * ## The position is a page and a side, 1-BASED on screen and 0-based on the way out
 *
 * *Before page 3* or *After page 3*, starting after the page on show, which is where a person reading it means. The
 * conversion happens once, here (`pageNumbering.ts`): before page *p* is `p - 1`, after it is `p`, so *after the last
 * page* is `pageCount`, the one position past the end an insert may name.
 *
 * ## A page outside this document is said on the press
 *
 * The action stays enabled and the row says why when pressed with a page the document does not have, `PageRangeChoice`'s
 * rule: a row that told a person they were wrong while they typed would read as broken.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function InsertFromPdfBody({
  choices,
  source: openedOn,
  pageCount,
  page,
  draft,
  resolve,
}: {
  readonly choices: readonly SourceDocument[];
  readonly source?: string | undefined;
  readonly pageCount: number;
  /** Zero-based, as every page index crossing a boundary here is. */
  readonly page: number;
  readonly draft?:
    | { readonly sourcePages: { readonly every: boolean; readonly text: string }; readonly placement: Placement; readonly page: string }
    | undefined;
} & DialogAnswering<InsertFromPdfAnswer>): ReactElement {
  const { _ } = useLingui();
  const [source, setSource] = useState(openedOn ?? choices[0]?.docId ?? '');
  const chosen = choices.find((choice) => choice.docId === source);
  const range = usePageRange(chosen?.pageCount ?? 1, draft?.sourcePages);
  const [placement, setPlacement] = useState<Placement>(draft?.placement ?? 'after');
  // AFTER THE PAGE ON SHOW, 1-based.
  const [typed, setTyped] = useState(draft?.page ?? String(page + 1));
  const attempt = useAttempt();

  const parsed = Number.parseInt(typed, 10);
  const named = /^\d+$/u.test(typed.trim()) && Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= pageCount;
  const problem = attempt.tried && !named ? _(INSERT_FROM_PDF_RANGE, { last: pageCount }) : '';

  return (
    <div className="m-insert-from-pdf">
      <SourceDocumentRow
        label={INSERT_FROM_PDF_LABEL}
        choices={choices}
        value={source}
        onChange={setSource}
        onChooseFile={() => {
          resolve({
            kind: 'choose-file',
            draft: { sourcePages: { every: range.every, text: range.text }, placement, page: typed },
          });
        }}
        marker="insert-from-pdf"
      />
      {chosen === undefined ? null : <PageRangeChoice range={range} note={SOURCE_PAGES_NOTE} empty={SOURCE_PAGES_EMPTY} />}
      <DialogRow label={INSERT_FROM_PDF_POSITION} problem={problem}>
        <SegmentedControl<Placement>
          label={INSERT_FROM_PDF_POSITION}
          options={[
            { value: 'before', label: INSERT_FROM_PDF_BEFORE },
            { value: 'after', label: INSERT_FROM_PDF_AFTER },
          ]}
          value={placement}
          onChange={setPlacement}
        />
        {/* NAMED *Page* for a screen reader and not on screen, where the segment beside it already ends in *page*. */}
        <span className="m-page-number-field">
          <Input
            invalid={problem !== ''}
            label={INSERT_FROM_PDF_PAGE}
            labelShownBeside
            value={typed}
            onValueChange={setTyped}
          />
        </span>
      </DialogRow>
      <DialogFooter>
        <Button
          label={INSERT_FROM_PDF_APPLY}
          variant="primary"
          disabled={chosen === undefined}
          onClick={() => {
            if (chosen === undefined) return;
            attempt.attempt();
            const taken = range.proceed();
            if (taken === undefined || !named) return;
            // THE ONE CONVERSION. 1-based on screen, 0-based on the wire.
            resolve({
              kind: 'insert',
              source,
              sourcePages: range.every ? 'all' : [...taken],
              at: placement === 'before' ? parsed - 1 : parsed,
            });
          }}
        />
      </DialogFooter>
    </div>
  );
}
