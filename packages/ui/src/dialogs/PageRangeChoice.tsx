import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  DELETE_PAGES_HINT,
  PAGE_RANGE_EVERY,
  PAGE_RANGE_LABEL,
  PAGE_RANGE_NUMBERS,
  PAGE_RANGE_NUMBERS_NOTE,
  PAGE_RANGE_SELECT,
} from '../messages/en.js';
import { parsePageRanges } from '../pageRanges.js';
import { useAttempt } from '../primitives/attempt.js';
import { DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import { rangeProblemSentence } from './pageRangeProblem.js';

/**
 * What a dialog holds of its page range: which option, what was typed, and whether the person has tried to go on.
 *
 * Made by {@link usePageRange} and drawn by {@link PageRangeChoice}, so the dialog owns the state — its own answer is
 * built from it — and the row owns every rule about it.
 */
export interface PageRange {
  readonly pageCount: number;
  readonly every: boolean;
  readonly text: string;
  /** Whether {@link proceed} has been called: from then on a refusal is said, and before it nothing is. */
  readonly tried: boolean;
  /** The pages chosen now, zero-based and ascending, for a dialog's count — `undefined` while what is typed names none. */
  readonly chosen: readonly number[] | undefined;
  readonly choose: (every: boolean) => void;
  readonly type: (text: string) => void;
  /**
   * The pages to send, or `undefined` when what is typed names none — the one way a dialog reads its pages to answer
   * with, because it is also what makes the row say why: a dialog that read {@link chosen} instead would refuse a
   * click in silence.
   */
  readonly proceed: () => readonly number[] | undefined;
}

/** Where a page-range row starts: which option, and what is typed. */
export interface PageRangeStart {
  readonly every: boolean;
  readonly text: string;
}

/**
 * The state of one page-range row: *Every page* first and nothing typed, unless `start` says otherwise — a dialog
 * reopened after *Choose file…* starts where the person left it, and Replace starts on as many pages as it replaces.
 * Nothing is tried either way.
 *
 * @param pageCount how many pages the document has — what *Every page* names and what a typed page is checked against
 */
export function usePageRange(pageCount: number, start: PageRangeStart = { every: true, text: '' }): PageRange {
  const [every, setEvery] = useState(start.every);
  const [text, setText] = useState(start.text);
  const attempt = useAttempt();
  const parsed = parsePageRanges(text, pageCount);
  const named = every ? Array.from({ length: pageCount }, (_unused, page) => page) : parsed.ok ? parsed.value : [];
  // NONE IS NOT AN ANSWER: every export's request names at least one page, and a document with none has nothing to
  // export, so an empty list never reaches a dialog's `resolve`.
  const chosen = named.length > 0 ? named : undefined;
  return {
    pageCount,
    every,
    text,
    tried: attempt.tried,
    chosen,
    choose: setEvery,
    type: setText,
    proceed: () => {
      attempt.attempt();
      return chosen;
    },
  };
}

/**
 * *Every page* or *Select pages* — the page range of a dialog that exports, and its typed pages.
 *
 * ## One row, because each export that asks for pages asks the same question
 *
 * A second copy is a second answer to what *Select pages* is called, what `3-1` means and when a typed range is
 * refused (B3a). So the two options, the field, the one parser (`parsePageRanges`) and the one set of refusal sentences
 * (`pageRangeProblem.ts`) live here, and a dialog brings only what is its own: the note on what a page becomes, and the
 * sentence for nothing typed, which names the operation.
 *
 * ## A refusal is said only once the person tries to go on
 *
 * A row that opens, or that answers a half-typed `1-`, by telling the person they got it wrong reads as broken. So the
 * dialog's action stays enabled and calls {@link PageRange.proceed}; from that moment the row says why, and says it
 * again as the text changes, until the pages are ones the document has.
 *
 * ## Not `PageScopeChoice`
 *
 * That row is a page COMMAND's: the pages it was opened on, counted, or all of them (ADR-0104). This one is an
 * export's, where no pages were chosen before the dialog opened and the person names them here.
 *
 * @param note what each page becomes in this dialog — beside *Pages*
 * @param empty the dialog's sentence for *Select pages* with nothing typed, e.g. *Type the pages to export*
 */
export function PageRangeChoice({
  range,
  note,
  empty,
}: {
  readonly range: PageRange;
  readonly note?: MessageKey | undefined;
  readonly empty: MessageKey;
}): ReactElement {
  const { _ } = useLingui();
  const problem = range.tried ? rangeProblemSentence(parsePageRanges(range.text, range.pageCount), _, empty) : '';
  return (
    <>
      <DialogRow label={PAGE_RANGE_LABEL} note={note}>
        <SegmentedControl<'every' | 'select'>
          label={PAGE_RANGE_LABEL}
          options={[
            { value: 'every', label: PAGE_RANGE_EVERY },
            { value: 'select', label: PAGE_RANGE_SELECT },
          ]}
          value={range.every ? 'every' : 'select'}
          onChange={(chosen) => {
            range.choose(chosen === 'every');
          }}
        />
      </DialogRow>
      {range.every ? null : (
        <DialogRow label={PAGE_RANGE_NUMBERS} note={PAGE_RANGE_NUMBERS_NOTE} problem={problem}>
          <Input
            invalid={problem !== ''}
            label={PAGE_RANGE_NUMBERS}
            labelShownBeside
            placeholder={DELETE_PAGES_HINT}
            value={range.text}
            onValueChange={range.type}
          />
        </DialogRow>
      )}
    </>
  );
}
