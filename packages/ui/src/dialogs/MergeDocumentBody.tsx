import { useLingui } from '@lingui/react';
import { MAX_MERGE_DOCUMENTS, MAX_MERGE_PART_ENTRIES, type PageSet, pageSetOf } from '@monstera/contract';
import { err } from '@monstera/shared';
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
  MERGE_DOCUMENT_PAGES,
  MERGE_DOCUMENT_PAGES_ALL,
  MERGE_DOCUMENT_PAGES_COUNT,
  MERGE_DOCUMENT_PAGES_EMPTY,
  MERGE_DOCUMENT_PAGES_TOO_MANY,
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
import { type PageRangeProblem, parsePageGroups } from '../pageRanges.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { rangeProblemSentence } from './pageRangeProblem.js';
import type { MERGE_PLACEMENTS, MergeDocumentAnswer } from './mergeDocumentResult.js';
import type { SourceDocument } from './sourceDocuments.js';

/**
 * One row's page range: a field that is empty for every page, beside what it names — *3 of 8 pages go in* — and, once the
 * person has tried to go on, what is wrong with it, by the shared sentences of `pageRangeProblem.ts` plus the merge's own
 * bound. The refusal is said and the button goes no further; a part that cannot be read is never dropped.
 */
function MergePagesField({
  text,
  read,
  total,
  tried,
  onChange,
}: {
  readonly text: string;
  readonly read: RowPages | undefined;
  readonly total: number;
  readonly tried: boolean;
  readonly onChange: (text: string) => void;
}): ReactElement {
  const { _ } = useLingui();
  // SAID AS SOON AS THE TEXT IS WRONG and not only after a press: a field the person typed into is one they are reading.
  const problem =
    read === undefined || read.ok
      ? ''
      : read.problem === 'too-many'
        ? _(MERGE_DOCUMENT_PAGES_TOO_MANY, { limit: MAX_MERGE_PART_ENTRIES })
        : tried || text.trim() !== ''
          ? rangeProblemSentence(err(read.problem), _, MERGE_DOCUMENT_PAGES_EMPTY)
          : '';
  return (
    <span className="m-merge-list__range">
      <Input
        invalid={problem !== ''}
        label={MERGE_DOCUMENT_PAGES}
        labelShownBeside
        placeholder={MERGE_DOCUMENT_PAGES_ALL}
        value={text}
        onValueChange={onChange}
      />
      <span className="m-merge-list__range-note" role={problem === '' ? undefined : 'alert'}>
        {problem !== ''
          ? problem
          : read?.ok === true && read.pages !== 'all'
            ? _(MERGE_DOCUMENT_PAGES_COUNT, { count: read.count, total })
            : ''}
      </span>
    </span>
  );
}

/** Where the merged pages go. */
type Placement = (typeof MERGE_PLACEMENTS)[number];

/** One listed document, under a key of its own: the same document may be listed twice, so its id cannot be the key. */
interface Listed {
  readonly key: number;
  readonly docId: string;
  /** The page range as typed; empty is every page (ADR-0195). */
  readonly pages: string;
}

interface Draft { readonly docId: string; readonly pages: string }

/**
 * The documents the dialog opens with: those listed before *Choose file…*, then the file just picked — unless it is
 * already listed, which is the case when the person cancelled the next pick and the command asks again with the last
 * one still chosen. Without a draft, the file just picked or else the first document offered.
 */
function openingDocuments(
  choices: readonly SourceDocument[],
  openedOn: string | undefined,
  draft: readonly Draft[] | undefined,
): readonly Draft[] {
  if (draft === undefined) {
    const first = openedOn ?? choices[0]?.docId;
    return first === undefined ? [] : [{ docId: first, pages: '' }];
  }
  if (openedOn === undefined || draft.some((each) => each.docId === openedOn)) return draft;
  return [...draft, { docId: openedOn, pages: '' }].slice(0, MAX_MERGE_DOCUMENTS);
}

/**
 * One row's range, read against its document: the pages in the order typed (`1-3, 5`; empty is every page), or what is
 * wrong with it. The syntax and its refusals are `parsePageGroups`' — the one parser — and the only rule added here is
 * the merge's own bound on separate groups (`MAX_MERGE_PART_ENTRIES`), which is said where it is typed rather than
 * refused by the host.
 */
type RowPages =
  | { readonly ok: true; readonly pages: 'all' | PageSet; readonly count: number }
  | { readonly ok: false; readonly problem: PageRangeProblem | 'too-many' };

function rowPages(text: string, total: number): RowPages {
  if (text.trim() === '') return { ok: true, pages: 'all', count: total };
  const groups = parsePageGroups(text, total);
  if (!groups.ok) return { ok: false, problem: groups.error };
  const pages = groups.value.flat();
  const set = pageSetOf(pages);
  if (set.length > MAX_MERGE_PART_ENTRIES) return { ok: false, problem: 'too-many' };
  return { ok: true, pages: set, count: pages.length };
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
    | { readonly placement: Placement; readonly page: string; readonly documents: readonly Draft[] }
    | undefined;
} & DialogAnswering<MergeDocumentAnswer>): ReactElement {
  const { _ } = useLingui();
  const [documents, setDocuments] = useState<readonly Listed[]>(() =>
    openingDocuments(choices, openedOn, draft?.documents).map((each, key) => ({ key, ...each })),
  );
  // PAST EVERY OPENING KEY, and read only by a press: the list opens with fewer documents than the bound.
  const nextKey = useRef(MAX_MERGE_DOCUMENTS);
  const listed = (docId: string): Listed => {
    nextKey.current += 1;
    return { key: nextKey.current, docId, pages: '' };
  };
  // EACH ROW'S RANGE READ AGAINST ITS OWN DOCUMENT, by row key. A document no longer offered has no page count and so no
  // range: `offered` below already refuses the merge for it.
  const ranges = new Map(
    documents.map((each) => {
      const total = choices.find((choice) => choice.docId === each.docId)?.pageCount ?? 0;
      return [each.key, { total, read: rowPages(each.pages, total) }] as const;
    }),
  );
  const rangesOk = [...ranges.values()].every((range) => range.read.ok);
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
                    {chosen === undefined ? null : (
                      <MergePagesField
                        text={each.pages}
                        read={ranges.get(each.key)?.read}
                        total={chosen.pageCount}
                        tried={attempt.tried}
                        onChange={(pages) => {
                          setDocuments((now) => now.map((row) => (row.key === each.key ? { ...row, pages } : row)));
                        }}
                      />
                    )}
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
                  draft: { placement, page: typed, documents: documents.map((each) => ({ docId: each.docId, pages: each.pages })) },
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
            // A RANGE THE DOCUMENT DOES NOT HAVE IS SAID ON ITS ROW and goes no further: nothing is dropped or guessed.
            if (!rangesOk) return;
            // THE ONE CONVERSION. 1-based on screen, 0-based on the wire.
            const at = placement === 'start' ? 0 : placement === 'end' ? pageCount : parsed;
            resolve({
              kind: 'merge',
              documents: documents.map((each) => {
                const read = ranges.get(each.key)?.read;
                return { docId: each.docId, pages: read?.ok === true ? read.pages : 'all' };
              }),
              at,
            });
          }}
        />
      </DialogFooter>
    </div>
  );
}
