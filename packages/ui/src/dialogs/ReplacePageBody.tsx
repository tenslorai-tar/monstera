import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  REPLACE_PAGE_APPLY,
  REPLACE_PAGE_COUNTS_DIFFER,
  REPLACE_PAGE_LABEL,
  REPLACE_PAGE_WHICH,
  SOURCE_PAGES_EMPTY,
  SOURCE_PAGES_NOTE,
} from '../messages/en.js';
import { formatPageRanges } from '../pageRanges.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { SourceDocumentRow } from './DocumentChoice.js';
import { PageRangeChoice, type PageRangeStart, usePageRange } from './PageRangeChoice.js';
import type { ReplacePageAnswer } from './replacePageResult.js';
import type { SourceDocument } from './sourceDocuments.js';

/**
 * The replace-pages dialog's body — which document, and which of its pages, replace the pages the command acts on.
 *
 * ## It names the pages rather than asking for them
 *
 * They are the ticked pages, else the page on show, so the dialog states them and asks about the source alone. The
 * numbers shown are **1-based**, converted at this surface (`pageNumbering.ts`).
 *
 * ## It opens on as many source pages as it replaces
 *
 * One page replaced from a two-page file starts on *Select pages*, page 1 — so the document keeps its length unless the
 * person chooses otherwise. A source with exactly as many pages starts on *Every page*.
 *
 * ## Pages apart need as many pages back, and that is said here
 *
 * `replacePageSchema` pairs pages that are not next to each other one for one, and the kernel refuses a different
 * count for them. The dialog says so on the press rather than sending what would be refused.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ReplacePageBody({
  choices,
  source: openedOn,
  pages,
  draft,
  resolve,
}: {
  readonly choices: readonly SourceDocument[];
  readonly source?: string | undefined;
  /** Zero-based, as every page index crossing a boundary here is. */
  readonly pages: readonly number[];
  readonly draft?: { readonly sourcePages: PageRangeStart } | undefined;
} & DialogAnswering<ReplacePageAnswer>): ReactElement {
  const { _ } = useLingui();
  const [source, setSource] = useState(openedOn ?? choices[0]?.docId ?? '');
  const chosen = choices.find((choice) => choice.docId === source);
  const pageCount = chosen?.pageCount ?? 1;
  const range = usePageRange(pageCount, draft?.sourcePages ?? startFor(pages.length, pageCount));
  const [pressed, setPressed] = useState(false);
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const together = sorted.every((page, index) => page === (sorted[0] ?? 0) + index);
  // SAID FROM THE FIRST PRESS ON, and as the choice changes after it, until the counts pair.
  const taking = range.chosen?.length;
  const countsDiffer = pressed && !together && taking !== undefined && taking !== sorted.length;

  return (
    <div className="m-replace-page">
      <p className="m-replace-page__which">
        {_(REPLACE_PAGE_WHICH, { count: sorted.length, pages: formatPageRanges(sorted) })}
      </p>
      <SourceDocumentRow
        label={REPLACE_PAGE_LABEL}
        choices={choices}
        value={source}
        onChange={setSource}
        onChooseFile={() => {
          resolve({ kind: 'choose-file', draft: { sourcePages: { every: range.every, text: range.text } } });
        }}
        marker="replace-page"
      />
      {chosen === undefined ? null : <PageRangeChoice range={range} note={SOURCE_PAGES_NOTE} empty={SOURCE_PAGES_EMPTY} />}
      {countsDiffer ? (
        <p className="m-replace-page__problem" role="alert">
          {_(REPLACE_PAGE_COUNTS_DIFFER, { count: sorted.length })}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          label={REPLACE_PAGE_APPLY}
          values={{ count: sorted.length }}
          variant="primary"
          disabled={chosen === undefined}
          onClick={() => {
            if (chosen === undefined) return;
            setPressed(true);
            const taken = range.proceed();
            if (taken === undefined) return;
            // THE KERNEL'S PAIRING RULE, said before it would refuse: pages apart take as many pages back.
            if (!together && taken.length !== sorted.length) return;
            resolve({ kind: 'replace', source, sourcePages: range.every ? 'all' : [...taken] });
          }}
        />
      </DialogFooter>
    </div>
  );
}

/**
 * Where the source's page row starts: *Every page* when the source has exactly as many pages as are replaced, else
 * *Select pages* on its first that many — or every page of a source shorter than that.
 */
function startFor(replaced: number, sourcePages: number): PageRangeStart {
  if (sourcePages <= replaced) return { every: true, text: '' };
  return { every: false, text: formatPageRanges(Array.from({ length: replaced }, (_unused, page) => page)) };
}
