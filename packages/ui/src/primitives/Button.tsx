import { useLingui } from '@lingui/react';
import { Button as BaseButton } from '@base-ui/react/button';
import type { MessageKey } from '@monstera/shared';
import { type ReactElement, useRef } from 'react';

import { Icon } from './Icon.js';
import type { IconName } from './icons.js';
import { useOnColor } from './useOnColor.js';

/**
 * The one button primitive (§10.4).
 *
 * ## Why the label is a prop and not a child
 *
 * B9 bans literal user-facing strings in JSX, and a `children` slot is where one
 * arrives. Taking the text as a prop puts the ban at this boundary rather than
 * relying on the lint rule alone — two mechanisms for two populations, which is
 * the same pairing ADR-0029 Decision 6 makes for a command's title.
 *
 * **`label` is a `MessageKey`, as of 2026-08-29.** That was a gap with a named
 * expiry — `packages/shared/src/messages.ts` states the trigger in its own body:
 * *"the primitives' text props become `MessageKey` in the commit that lands a
 * resolver"*. The resolver landed, so this did. The gap's stated reason was that
 * a `MessageKey` prop would render the key with nothing to resolve it, which is
 * worse than English; `useLingui` is what resolves it now, and a missing entry
 * throws rather than rendering the key.
 *
 * ## `primary` computes its foreground and does not store one
 *
 * The primary variant fills with `--accent`, which ADR-0003 types as a `fill`
 * and deliberately gives no companion foreground. A `--on-accent` token would be
 * one value baked for one theme while the theme is chosen at runtime, so the
 * stored colour would be right in one theme and quietly wrong in the others —
 * and a colour that fails contrast still renders, which is why nothing would
 * catch it. `useOnColor` solves it against the fill in effect, at the floor the
 * theme in force asks of text — 4.5:1, and 7:1 under `hc` (ADR-0003, corrected
 * 2026-09-16). This variant passes `'text'` rather than a number, so the floor
 * cannot be the one whoever wrote the call site had in mind.
 *
 * The fallback when it cannot be solved is `--text`, a real token rather than a
 * guess: an unreadable token is a defect to see, and a hard-coded black would
 * hide it behind something that looks deliberate.
 */
export interface ButtonProps {
  /** The visible text, and the accessible name. */
  label: MessageKey;
  /**
   * What a placeholder in {@link label} stands for.
   *
   * A LABEL AND ITS VALUES, never a resolved string: a caller that formatted
   * the sentence itself would hold user-facing text, which is what B9's ban on
   * literals in JSX is about, and it would do the formatting in whatever
   * language the caller happened to assume.
   *
   * Optional because most labels carry no placeholder, and a required empty
   * object at every call site is ceremony that teaches nothing.
   */
  values?: Readonly<Record<string, string | number>> | undefined;
  /** Filled with `--accent` (`primary`) or bounded by `--border-control`. */
  variant?: 'primary' | 'default';
  /**
   * A glyph before the label, as the owner's design draws Donate and Rate Us (2026-09-22).
   *
   * **Decorative, and hidden from the accessibility tree**: the label beside it is the control's
   * name, so a named glyph here would give the button two. That is `Icon`'s own rule, and the reason
   * this is a name rather than a node — a `ReactNode` slot is where an unlabelled image arrives.
   */
  icon?: IconName | undefined;
  disabled?: boolean;
  onClick?: (() => void) | undefined;
  /** Defaults to `button`, never to a form's implicit `submit`. */
  type?: 'button' | 'submit';
  /**
   * A chord drawn after the label — the command's own `shortcut`, e.g. `Ctrl+O` (§10.3: *"Open PDF… (Ctrl+O)"*).
   *
   * Hidden from the accessibility tree, so the control's name stays its label: a name that read the chord would change
   * the day the chord did, and the palette is where a screen-reader user meets chords.
   */
  chord?: string | undefined;
}

export function Button({
  label,
  values,
  variant = 'default',
  disabled = false,
  onClick,
  type = 'button',
  chord,
  icon,
}: ButtonProps): ReactElement {
  const element = useRef<HTMLElement>(null);
  // `useLingui` rather than the module-level `resolve`, so a locale change
  // re-renders this. The module function answers correctly and answers once —
  // it is not a subscription — which would leave every rendered control in the
  // previous language until something unrelated re-rendered it.
  const { _ } = useLingui();

  // Only the primary variant fills with a token that carries no foreground.
  // The default variant sits on `--surface`, a pair `tokens.css` declares and
  // `check:tokencontrast` already evaluates — solving it again here would be a
  // second opinion about a question that has an authority (B3a).
  //
  // A DISABLED primary is not on the accent: the stylesheet draws it as `--faint` on `--surface`,
  // a declared pair. Solving here anyway would write an inline colour, which beats the `:disabled`
  // rule, and leave the control looking exactly as pressable as an enabled one.
  useOnColor(element, 'color', '--text', variant === 'primary' && !disabled ? ['--accent'] : [], 'text');

  return (
    <BaseButton
      className={`m-button m-button--${variant}`}
      disabled={disabled}
      nativeButton
      onClick={onClick}
      ref={element}
      type={type}
    >
      {icon === undefined ? null : <Icon name={icon} size="dense" />}
      {values === undefined ? _(label) : _(label, values)}
      {chord === undefined ? null : (
        <kbd aria-hidden className="m-button__chord">
          {chord}
        </kbd>
      )}
    </BaseButton>
  );
}
