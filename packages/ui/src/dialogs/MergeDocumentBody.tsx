import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  MERGE_DOCUMENT_AFTER_PAGE,
  MERGE_DOCUMENT_APPLY,
  MERGE_DOCUMENT_AT_END,
  MERGE_DOCUMENT_AT_START,
  MERGE_DOCUMENT_LABEL,
  MERGE_DOCUMENT_PAGE,
  MERGE_DOCUMENT_PLACE,
  MERGE_DOCUMENT_RANGE,
} from '../messages/en.js';
import { useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { SourceDocumentRow } from './DocumentChoice.js';
import type { MERGE_PLACEMENTS, MergeDocumentAnswer } from './mergeDocumentResult.js';
import type { SourceDocument } from './sourceDocuments.js';

/** Where the merged pages go. */
type Placement = (typeof MERGE_PLACEMENTS)[number];

/**
 * The merge dialog's body — which document comes in, and where: at the start, at the end, or after a page.
 *
 * Every page of the document merged in comes in; choosing some of them is *Insert from PDF*'s question. *At the end*
 * is chosen as the dialog opens, which is what *merge* most often means. The one conversion to the zero-based position
 * is here (`pageNumbering.ts`), and a page this document lacks is said on the press, `PageRangeChoice`'s rule.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function MergeDocumentBody({
  choices,
  source: openedOn,
  pageCount,
  draft,
  resolve,
}: {
  readonly choices: readonly SourceDocument[];
  readonly source?: string | undefined;
  readonly pageCount: number;
  readonly draft?: { readonly placement: Placement; readonly page: string } | undefined;
} & DialogAnswering<MergeDocumentAnswer>): ReactElement {
  const { _ } = useLingui();
  const [source, setSource] = useState(openedOn ?? choices[0]?.docId ?? '');
  const chosen = choices.find((choice) => choice.docId === source);
  const [placement, setPlacement] = useState<Placement>(draft?.placement ?? 'end');
  const [typed, setTyped] = useState(draft?.page ?? '1');
  const attempt = useAttempt();

  const parsed = Number.parseInt(typed, 10);
  const named = /^\d+$/u.test(typed.trim()) && Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= pageCount;
  const problem = placement === 'after' && attempt.tried && !named ? _(MERGE_DOCUMENT_RANGE, { last: pageCount }) : '';

  return (
    <div className="m-merge-document">
      <SourceDocumentRow
        label={MERGE_DOCUMENT_LABEL}
        choices={choices}
        value={source}
        onChange={setSource}
        onChooseFile={() => {
          resolve({ kind: 'choose-file', draft: { placement, page: typed } });
        }}
        marker="merge"
      />
      <DialogRow label={MERGE_DOCUMENT_PLACE} problem={problem}>
        <SegmentedControl<Placement>
          label={MERGE_DOCUMENT_PLACE}
          options={[
            { value: 'start', label: MERGE_DOCUMENT_AT_START },
            { value: 'end', label: MERGE_DOCUMENT_AT_END },
            { value: 'after', label: MERGE_DOCUMENT_AFTER_PAGE },
          ]}
          value={placement}
          onChange={setPlacement}
        />
        {placement === 'after' ? (
          // NAMED *Page* for a screen reader and not on screen, where the segment beside it ends in *page*.
          <span className="m-page-number-field">
            <Input
              invalid={problem !== ''}
              label={MERGE_DOCUMENT_PAGE}
              labelShownBeside
              value={typed}
              onValueChange={setTyped}
            />
          </span>
        ) : null}
      </DialogRow>
      <DialogFooter>
        <Button
          label={MERGE_DOCUMENT_APPLY}
          variant="primary"
          disabled={chosen === undefined}
          onClick={() => {
            if (chosen === undefined) return;
            attempt.attempt();
            if (placement === 'after' && !named) return;
            // THE ONE CONVERSION. 1-based on screen, 0-based on the wire.
            const at = placement === 'start' ? 0 : placement === 'end' ? pageCount : parsed;
            resolve({ kind: 'merge', source, at });
          }}
        />
      </DialogFooter>
    </div>
  );
}
