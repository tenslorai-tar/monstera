import { useLingui } from '@lingui/react';
import { MAX_MERGE_DOCUMENTS } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useRef, useState } from 'react';

import {
  MERGE_DOCUMENT_ADD,
  MERGE_DOCUMENT_AFTER_PAGE,
  MERGE_DOCUMENT_APPLY,
  MERGE_DOCUMENT_AT_END,
  MERGE_DOCUMENT_AT_START,
  MERGE_DOCUMENT_LABEL,
  MERGE_DOCUMENT_MOVE_DOWN,
  MERGE_DOCUMENT_MOVE_UP,
  MERGE_DOCUMENT_NONE,
  MERGE_DOCUMENT_ORDER,
  MERGE_DOCUMENT_PAGE,
  MERGE_DOCUMENT_PLACE,
  MERGE_DOCUMENT_RANGE,
  MERGE_DOCUMENT_REMOVE,
  MERGE_DOCUMENT_ROW,
  SOURCE_CHOOSE_FILE,
  SOURCE_NONE_OPEN,
  SOURCE_PAGE_COUNT,
} from '../messages/en.js';
import { useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { MERGE_PLACEMENTS, MergeDocumentAnswer } from './mergeDocumentResult.js';
import type { SourceDocument } from './sourceDocuments.js';

/** Where the merged pages go. */
type Placement = (typeof MERGE_PLACEMENTS)[number];

/** One listed document, under a key of its own: the same document may be listed twice, so its id cannot be the key. */
interface Listed {
  readonly key: number;
  readonly docId: string;
}

/**
 * The documents the dialog opens with: those listed before *Choose file…*, then the file just picked — unless it is
 * already listed, which is the case when the person cancelled the next pick and the command asks again with the last
 * one still chosen. Without a draft, the file just picked or else the first document offered.
 */
function openingDocuments(
  choices: readonly SourceDocument[],
  openedOn: string | undefined,
  draft: readonly string[] | undefined,
): readonly string[] {
  if (draft === undefined) {
    const first = openedOn ?? choices[0]?.docId;
    return first === undefined ? [] : [first];
  }
  if (openedOn === undefined || draft.includes(openedOn)) return draft;
  return [...draft, openedOn].slice(0, MAX_MERGE_DOCUMENTS);
}

/**
 * The merge dialog's body — which documents come in, in what order, and where: at the start, at the end, or after a
 * page (the owner's item 13d, ADR-0152).
 *
 * The documents are a numbered list a person orders with each row's *Move up* and *Move down*, and they land one
 * after another in that order. Every page of each comes in; choosing some is *Insert from PDF*'s question. *At the
 * end* is chosen as the dialog opens, which is what *merge* most often means. The one conversion to the zero-based
 * position is here (`pageNumbering.ts`), and a page this document lacks is said on the press, `PageRangeChoice`'s rule.
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
  readonly draft?:
    | { readonly placement: Placement; readonly page: string; readonly documents: readonly string[] }
    | undefined;
} & DialogAnswering<MergeDocumentAnswer>): ReactElement {
  const { _ } = useLingui();
  const [documents, setDocuments] = useState<readonly Listed[]>(() =>
    openingDocuments(choices, openedOn, draft?.documents).map((docId, key) => ({ key, docId })),
  );
  // PAST EVERY OPENING KEY, and read only by a press: the list opens with fewer documents than the bound.
  const nextKey = useRef(MAX_MERGE_DOCUMENTS);
  const listed = (docId: string): Listed => {
    nextKey.current += 1;
    return { key: nextKey.current, docId };
  };
  const [placement, setPlacement] = useState<Placement>(draft?.placement ?? 'end');
  const [typed, setTyped] = useState(draft?.page ?? '1');
  const attempt = useAttempt();

  const parsed = Number.parseInt(typed, 10);
  const named = /^\d+$/u.test(typed.trim()) && Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= pageCount;
  const problem = placement === 'after' && attempt.tried && !named ? _(MERGE_DOCUMENT_RANGE, { last: pageCount }) : '';
  // EVERY LISTED DOCUMENT MUST STILL BE ONE OFFERED: one closed while the dialog was open is not merged in silently.
  const offered = documents.length > 0 && documents.every((each) => choices.some((choice) => choice.docId === each.docId));
  const full = documents.length >= MAX_MERGE_DOCUMENTS;

  const moved = (from: number, to: number): void => {
    setDocuments((now) => {
      const next = [...now];
      const [taken] = next.splice(from, 1);
      if (taken === undefined) return now;
      next.splice(to, 0, taken);
      return next;
    });
  };

  return (
    <div className="m-merge-document">
      <DialogRow
        label={MERGE_DOCUMENT_LABEL}
        note={choices.length === 0 ? SOURCE_NONE_OPEN : documents.length === 0 ? MERGE_DOCUMENT_NONE : MERGE_DOCUMENT_ORDER}
      >
        <div className="m-merge-list">
          {documents.length === 0 ? null : (
            <ol className="m-merge-list__documents">
              {documents.map((each, index) => {
                const number = index + 1;
                const chosen = choices.find((choice) => choice.docId === each.docId);
                return (
                  <li key={each.key} className="m-merge-list__document" data-merge-document={String(number)}>
                    <span aria-hidden className="m-merge-list__number">
                      {String(number)}
                    </span>
                    <select
                      aria-label={_(MERGE_DOCUMENT_ROW, { number })}
                      value={each.docId}
                      onChange={(event) => {
                        const docId = event.target.value;
                        setDocuments((now) => now.map((row) => (row.key === each.key ? { ...row, docId } : row)));
                      }}
                    >
                      {choices.map((choice) => (
                        <option key={choice.docId} value={choice.docId}>
                          {choice.name}
                        </option>
                      ))}
                    </select>
                    <span className="m-merge-list__pages">
                      {chosen === undefined ? null : _(SOURCE_PAGE_COUNT, { count: chosen.pageCount })}
                    </span>
                    <span className="m-merge-list__actions">
                      <Button
                        label={MERGE_DOCUMENT_MOVE_UP}
                        values={{ number }}
                        icon="MoveUp"
                        iconOnly
                        disabled={index === 0}
                        onClick={() => {
                          moved(index, index - 1);
                        }}
                      />
                      <Button
                        label={MERGE_DOCUMENT_MOVE_DOWN}
                        values={{ number }}
                        icon="MoveDown"
                        iconOnly
                        disabled={index === documents.length - 1}
                        onClick={() => {
                          moved(index, index + 1);
                        }}
                      />
                      <Button
                        label={MERGE_DOCUMENT_REMOVE}
                        values={{ number }}
                        icon="X"
                        iconOnly
                        onClick={() => {
                          setDocuments((now) => now.filter((row) => row.key !== each.key));
                        }}
                      />
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="m-merge-list__add">
            <Button
              label={MERGE_DOCUMENT_ADD}
              icon="Plus"
              disabled={choices.length === 0 || full}
              onClick={() => {
                const first = choices[0];
                if (first !== undefined) setDocuments((now) => [...now, listed(first.docId)]);
              }}
            />
            <Button
              label={SOURCE_CHOOSE_FILE}
              disabled={full}
              onClick={() => {
                resolve({
                  kind: 'choose-file',
                  draft: { placement, page: typed, documents: documents.map((each) => each.docId) },
                });
              }}
            />
          </div>
        </div>
      </DialogRow>
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
          disabled={!offered}
          onClick={() => {
            if (!offered) return;
            attempt.attempt();
            if (placement === 'after' && !named) return;
            // THE ONE CONVERSION. 1-based on screen, 0-based on the wire.
            const at = placement === 'start' ? 0 : placement === 'end' ? pageCount : parsed;
            resolve({ kind: 'merge', documents: documents.map((each) => each.docId), at });
          }}
        />
      </DialogFooter>
    </div>
  );
}
