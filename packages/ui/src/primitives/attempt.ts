import { useCallback, useState } from 'react';

/**
 * WHEN A DIALOG MAY SAY WHAT IS MISSING: once the person has tried to go on, and not before (the owner, 2026-10-03).
 *
 * A dialog that opens by telling the person they have not typed something yet — *"Type the comment this note should
 * hold."* above an empty field they have not had a chance to fill — reads as a dialog that is already wrong. So:
 *
 * - **A missing entry** (nothing typed, nothing chosen, nothing drawn) is said only after the person presses the
 *   dialog's action. The action stays enabled for exactly that reason: a disabled button cannot be pressed, so the
 *   person would never be told why.
 * - **An invalid entry** (too long, not a page number) is said as soon as it is typed, because the person has done
 *   something and it is wrong.
 *
 * One rule, so it is one hook: every dialog asks it rather than deciding afresh when a sentence appears (B3a). The
 * page-range row takes its `tried` too (`PageRangeChoice.tsx`), and holds back even a wrong range until then, because a
 * range is wrong at every step of typing one: `1-` on the way to `1-4`.
 */
export interface Attempt {
  /** Whether the person has pressed the action since the dialog opened, or since {@link forget}. */
  readonly tried: boolean;
  /** Records a press of the action. Call it on every press, whatever the press then does. */
  readonly attempt: () => void;
  /**
   * Forgets the presses, for a dialog whose person switches to a different way of answering — a signature's Draw to
   * Type — where the new way's empty field is one they have not had a chance to fill.
   */
  readonly forget: () => void;
}

export function useAttempt(): Attempt {
  const [tried, setTried] = useState(false);
  const attempt = useCallback((): void => {
    setTried(true);
  }, []);
  const forget = useCallback((): void => {
    setTried(false);
  }, []);
  return { tried, attempt, forget };
}

/**
 * The sentence a field's row shows under the rule above, or `undefined` for none.
 *
 * @param invalid the sentence for what is typed being wrong, shown at once; `undefined` when it is not
 * @param missing whether the entry is absent
 * @param missingSentence the sentence for an absent entry, shown only once `tried`
 */
export function attemptProblem<Sentence>(
  { tried }: Pick<Attempt, 'tried'>,
  invalid: Sentence | undefined,
  missing: boolean,
  missingSentence: Sentence,
): Sentence | undefined {
  if (invalid !== undefined) return invalid;
  return missing && tried ? missingSentence : undefined;
}
