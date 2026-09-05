import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { REPLACE_PAGE_APPLY, REPLACE_PAGE_LABEL, REPLACE_PAGE_WHICH } from '../messages/en.js';
import { type DocumentChoice, DocumentChoiceSelect } from './DocumentChoice.js';
import type { ReplacePageAnswer } from './replacePageResult.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';

/**
 * The replace-page dialog's body — which document replaces the page on screen.
 *
 * ## It names the page rather than asking for it
 *
 * The page being replaced is the one the reader is looking at, so this dialog
 * asks one question and states the other. `duplicatePageCommand` and
 * `insertBlankPageCommand` take the same position — *the page on screen* is
 * what a toolbar control means — and asking for a number here would make the
 * common case cost a decision.
 *
 * The number shown is **1-based**, converted at this surface, so the sentence
 * matches what the reader counts. The command sends `context.page`, which is
 * already zero-based; nothing converts twice (`pageNumbering.ts`).
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ReplacePageBody({
  choices,
  page,
  resolve,
}: {
  readonly choices: readonly DocumentChoice[];
  /** Zero-based, as every page index crossing a boundary here is. */
  readonly page: number;
} & DialogAnswering<ReplacePageAnswer>): ReactElement {
  const { _ } = useLingui();
  const [source, setSource] = useState(choices[0]?.docId ?? '');

  return (
    <div className="m-replace-page">
      <p className="m-replace-page__which">{_(REPLACE_PAGE_WHICH, { page: page + 1 })}</p>
      <DocumentChoiceSelect
        label={REPLACE_PAGE_LABEL}
        choices={choices}
        value={source}
        onChange={setSource}
        marker="replace-page"
      />
      <Button
        label={REPLACE_PAGE_APPLY}
        variant="primary"
        disabled={source === ''}
        onClick={() => {
          if (source === '') return;
          resolve({ source });
        }}
      />
    </div>
  );
}
