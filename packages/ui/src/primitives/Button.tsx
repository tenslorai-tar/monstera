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
 *
 * ## Every brand tone is a fill, solved the same way
 *
 * `gold` and `violet` are the owner's brand tones (ADR-0113), and since 2026-10-01 both are filled (the owner's
 * decision: Rate Us had been an outline). One rule draws every tone: `.m-button--tone` paints the gradient from
 * `--tone-top` to `--tone-bottom`, and a tone's own class names only which tokens those are and the label it asks
 * for, `--tone-label`. This solves that label against both stops, at the point of use, as it does the primary's. The
 * stylesheet holds the names once and this reads them back through the cascade, so there is no second list of a
 * tone's tokens here to drift from it (B3a).
 */
type Variant = 'primary' | 'default' | 'quiet' | 'gold' | 'violet';

/** What a filled variant's label is solved FROM, and every stop of the fill it must clear. */
interface Fill {
  readonly label: string;
  readonly stops: readonly string[];
}

/** The one fill every tone shares; a tone's class supplies the three properties it reads. */
const TONE_FILL: Fill = { label: '--tone-label', stops: ['--tone-top', '--tone-bottom'] };

/**
 * Each variant's fill, or `null` for one that sits on a declared surface pair `check:tokencontrast` already holds.
 * KEYED BY THE UNION, so a new variant does not compile until it says which it is, and a new tone that names
 * {@link TONE_FILL} is filled and solved by the lines that fill and solve the others.
 */
const FILLS: Readonly<Record<Variant, Fill | null>> = {
  // BOTH ENDS OF THE GRADIENT DRAWN, not `--accent`: in light the gradient is darker than the accent at both ends, and
  // a label solved against the accent came out dark on dark green — about 2.5:1 at the bottom (the stage audit of
  // 1e1bfad..e24eca0e, the design diff's finding; v5 draws white there).
  primary: { label: '--text', stops: ['--accent-grad-top', '--accent-grad-bottom'] },
  default: null,
  quiet: null,
  gold: TONE_FILL,
  violet: TONE_FILL,
};

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
  /**
   * Filled with `--accent` (`primary`), bounded by `--border-control` (`default`), or text alone (`quiet`) — a
   * row of links the design draws as words, such as the start screen's footer. `gold` and `violet` are the owner's
   * two brand tones for the menu row's Donate and Rate Us
   * ([ADR-0113](../../../../docs/DECISIONS/0113-the-applications-own-commands-sit-at-the-centre-of-the-menu-row.md)):
   * fixed tokens that do not follow the accent, each a fill whose label is solved like the primary's.
   */
  variant?: Variant;
  /**
   * The glyph alone, with the label kept as the accessible name and shown as the tooltip — for a row that has run out
   * of room for words (ADR-0113's narrow window). Needs an `icon`; without one there would be nothing to see.
   */
  iconOnly?: boolean;
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
  /**
   * The words SHOWN, where the row beside the button already shows the rest of its name: *Open* beside a file whose
   * name the row prints, where the label is *Open {name}* so each button is told apart by a screen reader. A long name
   * drawn into the button made it wider than the row (the gallery, 2026-10-03).
   *
   * The label stays the accessible name, and must begin with these words (WCAG 2.5.3, the visible label is in the
   * name), so a person who says what they see reaches the control.
   */
  shown?: MessageKey | undefined;
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
  iconOnly = false,
  shown,
}: ButtonProps): ReactElement {
  const element = useRef<HTMLElement>(null);
  // `useLingui` rather than the module-level `resolve`, so a locale change
  // re-renders this. The module function answers correctly and answers once —
  // it is not a subscription — which would leave every rendered control in the
  // previous language until something unrelated re-rendered it.
  const { _ } = useLingui();

  // Only a filled variant is solved. The default variant sits on `--surface`, a pair `tokens.css` declares and
  // `check:tokencontrast` already evaluates — solving it again here would be a second opinion about a question that
  // has an authority (B3a).
  //
  // A DISABLED fill is not drawn: the stylesheet draws it as `--faint` on `--surface`, a declared pair. Solving here
  // anyway would write an inline colour, which beats the `:disabled` rule, and leave the control looking exactly as
  // pressable as an enabled one.
  const fill = FILLS[variant];
  useOnColor(element, 'color', fill?.label ?? '--text', fill !== null && !disabled ? fill.stops : [], 'text');

  const text = values === undefined ? _(label) : _(label, values);
  // ICONS ALONE ONLY WHERE THERE IS AN ICON: a button with neither would be a blank control.
  const bare = iconOnly && icon !== undefined;

  return (
    <BaseButton
      className={`m-button m-button--${variant}${fill === TONE_FILL ? ' m-button--tone' : ''}${bare ? ' m-button--icon-only' : ''}`}
      disabled={disabled}
      nativeButton
      onClick={onClick}
      ref={element}
      type={type}
      title={bare ? text : undefined}
    >
      {icon === undefined ? null : <Icon name={icon} size="dense" />}
      {bare ? (
        <span className="m-visually-hidden">{text}</span>
      ) : shown === undefined ? (
        text
      ) : (
        <>
          <span aria-hidden>{_(shown)}</span>
          <span className="m-visually-hidden">{text}</span>
        </>
      )}
      {chord === undefined ? null : (
        <kbd aria-hidden className="m-button__chord">
          {chord}
        </kbd>
      )}
    </BaseButton>
  );
}
