import { Button as BaseButton } from '@base-ui/react/button';
import { type ReactElement, useRef } from 'react';

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
 * `label` is typed `string` today and becomes `MessageKey` when the i18n
 * scaffold lands (ADR-0029 Decision 6). That is a gap with a named expiry, not a
 * decision: the type does not exist yet, so nothing can reference it.
 *
 * ## `primary` computes its foreground and does not store one
 *
 * The primary variant fills with `--accent`, which ADR-0003 types as a `fill`
 * and deliberately gives no companion foreground. A `--on-accent` token would be
 * one value baked for one theme while the theme is chosen at runtime, so the
 * stored colour would be right in one theme and quietly wrong in the others —
 * and a colour that fails contrast still renders, which is why nothing would
 * catch it. `useOnColor` solves it against the fill in effect, at 4.5:1 for
 * text.
 *
 * The fallback when it cannot be solved is `--text`, a real token rather than a
 * guess: an unreadable token is a defect to see, and a hard-coded black would
 * hide it behind something that looks deliberate.
 */
export interface ButtonProps {
  /** The visible text, and the accessible name. */
  label: string;
  /** Filled with `--accent` (`primary`) or bounded by `--border-control`. */
  variant?: 'primary' | 'default';
  disabled?: boolean;
  onClick?: (() => void) | undefined;
  /** Defaults to `button`, never to a form's implicit `submit`. */
  type?: 'button' | 'submit';
}

export function Button({
  label,
  variant = 'default',
  disabled = false,
  onClick,
  type = 'button',
}: ButtonProps): ReactElement {
  const element = useRef<HTMLElement>(null);

  // Only the primary variant fills with a token that carries no foreground.
  // The default variant sits on `--surface`, a pair `tokens.css` declares and
  // `check:tokencontrast` already evaluates — solving it again here would be a
  // second opinion about a question that has an authority (B3a).
  useOnColor(element, 'color', '--text', variant === 'primary' ? ['--accent'] : [], 4.5);

  return (
    <BaseButton
      className={`m-button m-button--${variant}`}
      disabled={disabled}
      nativeButton
      onClick={onClick}
      ref={element}
      type={type}
    >
      {label}
    </BaseButton>
  );
}
