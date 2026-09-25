import { useLingui } from '@lingui/react';
import type { ContractClient } from '@monstera/contract';
import { type ReactElement, useEffect, useId, useState } from 'react';

import { rateOnStore } from '../commands/rateUs.js';
import type { ShowToast } from '../toasts.js';
import {
  REVIEW_PROMPT_LATER,
  REVIEW_PROMPT_MESSAGE,
  REVIEW_PROMPT_NEVER,
  REVIEW_PROMPT_RATE,
  REVIEW_PROMPT_REVIEWED,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { REVIEW_PROMPTS_SETTING } from '../settings/advanced.js';
import type { SettingsStore } from '../settingsStore.js';

/**
 * The Store rating prompt — the founding record's E3: *"Non-modal banner/toast — never interrupts editing"*.
 *
 * ## Asked once, when the window starts, and main decides
 *
 * The schedule — three days after install, two sessions, three days between, five at most — is main's
 * engagement record's, and a `true` answer to `app.reviewPrompt` is already counted as the prompt shown. So
 * this asks once per mount and draws what it is told; a second opinion here about whether a prompt is due
 * would be B3a's shape.
 *
 * ## Not a toast and not a dialog
 *
 * A toast times out, and `Toast.tsx` says what that means: a message that vanishes cannot hold a choice.
 * A dialog is modal, which E3 forbids. So this is a region at the foot of the window that stays until it
 * is answered, takes no focus when it arrives, and traps nothing.
 *
 * ## Four answers, and no fifth
 *
 * E3's four: *Rate now* and *Already reviewed* record `reviewedAt`, *Later* restarts the three days, and
 * *Don't ask again* turns off the Settings toggle — through this window's settings store, which is that
 * value's one writer, so main reads the opt-out from the same place the toggle does. There is no ×: a
 * close control would be a fifth answer E3 does not name, and *Later* is already the one that means it.
 */
export function ReviewPrompt({
  client,
  settings,
  toast,
}: {
  readonly client: ContractClient;
  readonly settings: SettingsStore;
  /** Says when *Rate now* opened nothing — `rateOnStore`'s report, shared with the title bar's *Rate Us*. */
  readonly toast: ShowToast;
}): ReactElement | null {
  const { _ } = useLingui();
  const [due, setDue] = useState(false);
  const message = useId();

  useEffect(() => {
    let cancelled = false;
    client['app.reviewPrompt']({}).then(
      (answer) => {
        if (cancelled || !answer.ok) return;
        setDue(answer.value.due);
      },
      () => {
        // NO ANSWER IS "NOT DUE": the prompt is a courtesy, and an error raised over the first screen for a
        // question nobody asked would be worse than the prompt's absence. Main has not counted it either.
      },
    );
    return (): void => {
      cancelled = true;
    };
  }, [client]);

  if (!due) return null;

  const answer = (action: 'reviewed' | 'later'): void => {
    setDue(false);
    // THE BANNER GOES EITHER WAY, and a lost answer is not reported. It leaves main's record holding this
    // prompt as shown and unanswered, which asks again in three days — *Later*'s own outcome, so the person
    // loses nothing they chose. *Rate now* is different, because it promises a page on screen.
    client['app.review']({ action }).then(
      () => undefined,
      () => undefined,
    );
  };

  return (
    <section aria-labelledby={message} className="m-review-prompt">
      <p className="m-review-prompt__message" id={message}>
        {_(REVIEW_PROMPT_MESSAGE)}
      </p>
      <div className="m-review-prompt__actions">
        <Button
          label={REVIEW_PROMPT_RATE}
          icon="Star"
          variant="primary"
          onClick={() => {
            setDue(false);
            void rateOnStore(client, toast);
          }}
        />
        <Button
          label={REVIEW_PROMPT_REVIEWED}
          onClick={() => {
            answer('reviewed');
          }}
        />
        <Button
          label={REVIEW_PROMPT_LATER}
          onClick={() => {
            answer('later');
          }}
        />
        <Button
          label={REVIEW_PROMPT_NEVER}
          onClick={() => {
            setDue(false);
            settings.set(REVIEW_PROMPTS_SETTING.id, false);
          }}
        />
      </div>
    </section>
  );
}
