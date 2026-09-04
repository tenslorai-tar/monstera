import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  PAGE_TRANSITION_ALL,
  PAGE_TRANSITION_APPLY,
  PAGE_TRANSITION_BLINDS,
  PAGE_TRANSITION_BOX,
  PAGE_TRANSITION_DISSOLVE,
  PAGE_TRANSITION_DURATION,
  PAGE_TRANSITION_FADE,
  PAGE_TRANSITION_NOT_A_NUMBER,
  PAGE_TRANSITION_REPLACE,
  PAGE_TRANSITION_REPLACE_NOTE,
  PAGE_TRANSITION_THIS,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { PageTransitionAnswer } from './pageTransitionResult.js';

/**
 * The styles, in the order a person considers them.
 *
 * `replace` is FIRST and named *None*, because it is how a transition is turned
 * off and that is the thing somebody arriving at this dialog for the second
 * time most often wants. Putting it last, in specification order, would bury
 * the undo-shaped option under four decorative ones.
 */
const STYLES = [
  { key: 'replace', label: PAGE_TRANSITION_REPLACE },
  { key: 'dissolve', label: PAGE_TRANSITION_DISSOLVE },
  { key: 'fade', label: PAGE_TRANSITION_FADE },
  { key: 'box', label: PAGE_TRANSITION_BOX },
  { key: 'blinds', label: PAGE_TRANSITION_BLINDS },
] as const;

/** One second is what every presentation tool offers before you change it. */
const DEFAULT_DURATION = '1';

/**
 * The transition dialog's body.
 *
 * ## The duration stays visible when *None* is chosen, and is not disabled
 *
 * `replace` ignores `/D`, so the field is inert for that style — and hiding or
 * disabling it would make the control jump as the user moves through the list,
 * which reads as a bug at exactly the moment they are comparing options. It
 * stays, and the note under the styles says what *None* means, because the
 * honest thing to explain is the **style**, not the field it happens to ignore.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function PageTransitionBody({
  page,
  resolve,
}: {
  readonly page: number;
} & DialogAnswering<PageTransitionAnswer>): ReactElement {
  const { _ } = useLingui();
  const [style, setStyle] = useState<(typeof STYLES)[number]['key']>('dissolve');
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [everyPage, setEveryPage] = useState(true);

  const seconds = readSeconds(duration);
  const ready = seconds !== null;

  return (
    <div className="m-page-transition">
      <fieldset className="m-page-transition__style">
        {STYLES.map(({ key, label }) => (
          <Button
            key={key}
            label={label}
            variant={style === key ? 'primary' : 'default'}
            onClick={() => {
              setStyle(key);
            }}
          />
        ))}
      </fieldset>
      <p className="m-page-transition__note">{_(PAGE_TRANSITION_REPLACE_NOTE)}</p>
      <Input
        label={PAGE_TRANSITION_DURATION}
        value={duration}
        onValueChange={(next) => {
          setDuration(next);
        }}
      />
      <fieldset className="m-page-transition__scope">
        {/* TWO BUTTONS RATHER THAN A CHECKBOX, for `CropPagesBody`'s reason. */}
        <Button
          label={PAGE_TRANSITION_THIS}
          variant={everyPage ? 'default' : 'primary'}
          onClick={() => {
            setEveryPage(false);
          }}
        />
        <Button
          label={PAGE_TRANSITION_ALL}
          variant={everyPage ? 'primary' : 'default'}
          onClick={() => {
            setEveryPage(true);
          }}
        />
      </fieldset>
      <p className="m-page-transition__problem" role="status">
        {ready ? '' : _(PAGE_TRANSITION_NOT_A_NUMBER)}
      </p>
      <Button
        label={PAGE_TRANSITION_APPLY}
        variant="primary"
        disabled={!ready}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute, for
          // `CropPagesBody`'s reason: the schema behind `resolve` refuses a
          // duration over 60, and a mismatch would be a thrown
          // `DialogResultRejected` over the user's document.
          if (seconds === null) return;
          resolve({ pages: everyPage ? 'all' : [page], style, durationSeconds: seconds });
        }}
      />
    </div>
  );
}

/**
 * The duration in seconds, or `null` when the field is not a number in range.
 *
 * A PATTERN, not `parseFloat`, for `CropPagesBody`'s reason: `parseFloat` reads
 * `12abc` as 12, which is the quiet-drop failure `parsePageRanges` refuses.
 * **Zero is accepted** — `/D 0` is a legal instantaneous change, so refusing it
 * would be this dialog inventing a rule the format does not have.
 */
function readSeconds(text: string): number | null {
  const value = text.trim().length === 0 ? DEFAULT_DURATION : text.trim();
  if (!/^\d+(?:\.\d+)?$/u.test(value)) return null;
  const seconds = Number(value);
  return seconds > 60 ? null : seconds;
}
