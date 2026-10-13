import type { ReactElement } from 'react';
import { useState } from 'react';

import { INSERT_FROM_PDF_APPLY, INSERT_FROM_PDF_LABEL, SOURCE_PAGES_EMPTY, SOURCE_PAGES_NOTE } from '../messages/en.js';
import { useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { SourceDocumentRow } from './DocumentChoice.js';
import { PagePlacementRow, usePagePlacement } from './PagePlacement.js';
import { PageRangeChoice, usePageRange } from './PageRangeChoice.js';
import type { InsertFromPdfAnswer } from './insertFromPdfResult.js';
import type { PagePlacementDraft } from './pagePlacementDraft.js';
import type { SourceDocument } from './sourceDocuments.js';

/**
 * The insert-from-PDF dialog's body — which document, which of its pages, and where they go.
 *
 * ## Where they go is the one placement row (`PagePlacement.tsx`, the owner's O3)
 *
 * Before or after the first page, the last page or page N, starting after the page on show, which is where a person
 * reading it means; the row converts it to the zero-based `at` once.
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
    | { readonly sourcePages: { readonly every: boolean; readonly text: string }; readonly placement: PagePlacementDraft }
    | undefined;
} & DialogAnswering<InsertFromPdfAnswer>): ReactElement {
  const [source, setSource] = useState(openedOn ?? choices[0]?.docId ?? '');
  const chosen = choices.find((choice) => choice.docId === source);
  const range = usePageRange(chosen?.pageCount ?? 1, draft?.sourcePages);
  // AFTER THE PAGE ON SHOW, the one placement row every inserting dialog asks (O3).
  const placement = usePagePlacement(pageCount, page, draft?.placement);
  const attempt = useAttempt();

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
            draft: { sourcePages: { every: range.every, text: range.text }, placement: placement.value },
          });
        }}
        marker="insert-from-pdf"
      />
      {chosen === undefined ? null : <PageRangeChoice range={range} note={SOURCE_PAGES_NOTE} empty={SOURCE_PAGES_EMPTY} />}
      <PagePlacementRow placement={placement} tried={attempt.tried} />
      <DialogFooter>
        <Button
          label={INSERT_FROM_PDF_APPLY}
          variant="primary"
          disabled={chosen === undefined}
          onClick={() => {
            if (chosen === undefined) return;
            attempt.attempt();
            const taken = range.proceed();
            if (taken === undefined || placement.at === undefined) return;
            resolve({ kind: 'insert', source, sourcePages: range.every ? 'all' : [...taken], at: placement.at });
          }}
        />
      </DialogFooter>
    </div>
  );
}
