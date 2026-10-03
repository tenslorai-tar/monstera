import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  DELETE_PAGES_HINT,
  SPLIT_DOCUMENT_APPLY,
  SPLIT_DOCUMENT_EACH_PAGE,
  SPLIT_DOCUMENT_EACH_PAGE_NOTE,
  SPLIT_DOCUMENT_EMPTY,
  SPLIT_DOCUMENT_FILES,
  SPLIT_DOCUMENT_HOW,
  SPLIT_DOCUMENT_LABEL,
  SPLIT_DOCUMENT_RANGES,
  SPLIT_DOCUMENT_RANGES_NOTE,
} from '../messages/en.js';
import { parsePageGroups } from '../pageRanges.js';
import { renderRangeProblem } from './pageRangeProblem.js';
import type { SplitDocumentAnswer } from './splitDocumentResult.js';
import { Button } from '../primitives/Button.js';
import { DialogChoices, DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';

/**
 * The split dialog's body — one file per page, or one file per range.
 *
 * ## Both modes build GROUPS, so the mode does not leave this component
 *
 * *One per page* is `[[0],[1],…]` and *ranges* is whatever was typed. The
 * answer carries groups either way, so nothing downstream learns which control
 * was used and nothing can disagree with this file about what a mode means.
 *
 * ## The mode is RADIO BUTTONS, not a select
 *
 * Two mutually exclusive options, both visible: a reader can see that
 * one-per-page exists without opening anything. `DocumentChoiceSelect` next door
 * is a select because its options are a list that grows; this one is a choice
 * between two fixed things.
 *
 * ## The count is shown before the button is pressed
 *
 * *"12 files"* is the one number that tells a reader whether they meant this,
 * and it is the thing they cannot work out from `1-3, 4-6` at a glance. It is
 * computed from the parsed groups rather than from the text, so it agrees with
 * what will actually be written.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function SplitDocumentBody({
  pageCount,
  resolve,
}: {
  readonly pageCount: number;
} & DialogAnswering<SplitDocumentAnswer>): ReactElement {
  const { _ } = useLingui();
  const [eachPage, setEachPage] = useState(true);
  const [text, setText] = useState('');

  const parsed = parsePageGroups(text, pageCount);
  // ONE GROUP PER PAGE, built here rather than sent as a mode — see the header.
  const groups = eachPage
    ? Array.from({ length: pageCount }, (_unused, page) => [page])
    : parsed.ok
      ? parsed.value
      : [];
  const usable = groups.length > 0;

  return (
    <div className="m-split-document">
      <DialogChoices<'each' | 'ranges'>
        label={SPLIT_DOCUMENT_HOW}
        options={[
          { value: 'each', label: SPLIT_DOCUMENT_EACH_PAGE, note: SPLIT_DOCUMENT_EACH_PAGE_NOTE },
          { value: 'ranges', label: SPLIT_DOCUMENT_RANGES, note: SPLIT_DOCUMENT_RANGES_NOTE },
        ]}
        value={eachPage ? 'each' : 'ranges'}
        onChange={(chosen) => {
          setEachPage(chosen === 'each');
        }}
      />
      {eachPage ? null : (
        <DialogRow label={SPLIT_DOCUMENT_LABEL}>
          <Input
            label={SPLIT_DOCUMENT_LABEL}
            labelShownBeside
            opensFocused
            placeholder={DELETE_PAGES_HINT}
            value={text}
            onValueChange={setText}
          />
        </DialogRow>
      )}
      <p className="m-split-document__problem" role="status">
        {eachPage
          ? _(SPLIT_DOCUMENT_FILES, { files: groups.length })
          : parsed.ok
            ? _(SPLIT_DOCUMENT_FILES, { files: groups.length })
            : renderRangeProblem(parsed, text, _, SPLIT_DOCUMENT_EMPTY)}
      </p>
      <DialogFooter>
        <Button
          label={SPLIT_DOCUMENT_APPLY}
          variant="primary"
          disabled={!usable}
          onClick={() => {
            // GUARDED AGAIN rather than trusting the disabled attribute, for
            // `DeletePagesBody`'s reason: the schema behind `resolve` refuses an
            // empty list of groups.
            if (!usable) return;
            // COPIED out of the readonly arrays the parser answers, because zod's
            // inferred shape is mutable. The copy is the honest conversion rather
            // than a cast.
            resolve({ groups: groups.map((group) => [...group]) });
          }}
        />
      </DialogFooter>
    </div>
  );
}
