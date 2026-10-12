import { useLingui } from '@lingui/react';
import { COMPOSED_FAMILY_DEFAULT } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { type DocumentFont, FontPicker, type FontList, RESOLVED_BUILT_IN } from '../FontPicker.js';
import {
  INSERT_MARKDOWN_AFTER,
  INSERT_MARKDOWN_APPLY,
  INSERT_MARKDOWN_END,
  INSERT_MARKDOWN_FONT,
  INSERT_MARKDOWN_PAGE,
  INSERT_MARKDOWN_RANGE,
  INSERT_MARKDOWN_START,
  INSERT_MARKDOWN_WHERE,
} from '../messages/en.js';
import { useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { InsertMarkdownAnswer } from './insertMarkdownResult.js';

type Where = 'start' | 'end' | 'after';

/** None: the composer's resolver reads this computer's and Monstera's fonts, never the target document's. */
const NO_DOCUMENT_FONTS: readonly DocumentFont[] = [];

/**
 * The insert-from-Markdown dialog's body: at the start, at the end, or after a page. **1-based on screen and 0-based on the
 * way out**, converted once here (`pageNumbering.ts`): after page *p* is `p`, so after the last page is `pageCount`.
 *
 * A page outside the document is said on the press, `InsertFromPdfBody`'s rule: a row that told a person they were wrong
 * while they typed would read as broken. A default export because `declareDialog` takes a `lazy()` component.
 */
export default function InsertMarkdownBody({
  pageCount,
  page,
  fonts,
  resolve,
}: {
  readonly pageCount: number;
  /** Zero-based, as every page index crossing a boundary here is. */
  readonly page: number;
  /** The fonts main listed when the dialog opened; absent where that read failed, which the picker says in words. */
  readonly fonts?: NonNullable<FontList> | undefined;
} & DialogAnswering<InsertMarkdownAnswer>): ReactElement {
  const { _ } = useLingui();
  // THE ONE PICKER (D1), opening on the face every composition was set in before there was a choice.
  const [family, setFamily] = useState<string>(COMPOSED_FAMILY_DEFAULT);
  // AT THE END is what *append* always did, so it is where the dialog opens.
  const [where, setWhere] = useState<Where>('end');
  const [typed, setTyped] = useState(String(page + 1));
  const attempt = useAttempt();

  const parsed = Number.parseInt(typed, 10);
  const named = /^\d+$/u.test(typed.trim()) && Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= pageCount;
  const problem = where === 'after' && attempt.tried && !named ? _(INSERT_MARKDOWN_RANGE, { last: pageCount }) : '';

  return (
    <div className="m-insert-markdown">
      <DialogRow label={INSERT_MARKDOWN_WHERE} problem={problem}>
        <SegmentedControl<Where>
          label={INSERT_MARKDOWN_WHERE}
          options={[
            { value: 'start', label: INSERT_MARKDOWN_START },
            { value: 'end', label: INSERT_MARKDOWN_END },
            { value: 'after', label: INSERT_MARKDOWN_AFTER },
          ]}
          value={where}
          onChange={setWhere}
        />
        {where === 'after' ? (
          <span className="m-page-number-field">
            <Input
              invalid={problem !== ''}
              label={INSERT_MARKDOWN_PAGE}
              labelShownBeside
              value={typed}
              onValueChange={setTyped}
            />
          </span>
        ) : null}
      </DialogRow>
      <DialogRow label={INSERT_MARKDOWN_FONT}>
        <FontPicker
          builtIn={RESOLVED_BUILT_IN}
          inDocument={NO_DOCUMENT_FONTS}
          label={INSERT_MARKDOWN_FONT}
          list={fonts ?? { listed: false, families: [], more: 0 }}
          onPick={setFamily}
          unset={INSERT_MARKDOWN_FONT}
          value={family}
        />
      </DialogRow>
      <DialogFooter>
        <Button
          label={INSERT_MARKDOWN_APPLY}
          variant="primary"
          onClick={() => {
            attempt.attempt();
            if (where === 'after' && !named) return;
            // THE ONE CONVERSION. 1-based on screen, 0-based on the wire.
            resolve({ at: where === 'start' ? 0 : where === 'end' ? pageCount : parsed, family });
          }}
        />
      </DialogFooter>
    </div>
  );
}
