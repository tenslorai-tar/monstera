import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import { type ReactElement, useEffect, useRef, useState } from 'react';

/**
 * A row of colour swatches and a custom colour: the one colour control of the application.
 *
 * The Properties tab's colour row and the page background dialog both take it (the owner's item 13j), so what a
 * colour choice looks like and how it answers is decided once. Each caller brings its own colours, because a mark and
 * a page want different ones: a highlighter's hues would be an unreadable page.
 *
 * `onPick(undefined)` is the *no colour of its own* choice, offered only where `autoLabel` is given; any other answer
 * is a hex.
 */
export function ColourSwatches({
  presets,
  current,
  auto = false,
  autoLabel,
  customLabel,
  fallback,
  layout = 'fill',
  onPick,
}: {
  /** The colours offered, each with the name a screen reader and a tooltip give it. */
  readonly presets: readonly { readonly hex: string; readonly title: MessageKey }[];
  /** The colour in force, as a hex, or `undefined` for none. */
  readonly current: string | undefined;
  /** Whether *no colour of its own* is the choice in force. */
  readonly auto?: boolean;
  /** Offers *no colour of its own* first, under this name. Absent, it is not offered. */
  readonly autoLabel?: MessageKey | undefined;
  readonly customLabel: MessageKey;
  /** What the custom colour shows while nothing is chosen: a colour input cannot show *none*. */
  readonly fallback: string;
  /** `fill` spreads the swatches across a narrow panel; `start` keeps them together at the start of a wide row. */
  readonly layout?: 'fill' | 'start';
  readonly onPick: (hex: string | undefined) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const preset = presets.some((entry) => entry.hex === current);
  return (
    <div className={layout === 'fill' ? 'm-colour-swatches' : 'm-colour-swatches m-colour-swatches--start'}>
      {autoLabel === undefined ? null : (
        <Swatch
          label={autoLabel}
          pressed={auto}
          onPress={() => {
            onPick(undefined);
          }}
        />
      )}
      {presets.map((entry) => (
        <Swatch
          hex={entry.hex}
          key={entry.hex}
          label={entry.title}
          pressed={!auto && entry.hex === current}
          onPress={() => {
            onPick(entry.hex);
          }}
        />
      ))}
      <span className="m-colour-custom" data-pressed={!auto && current !== undefined && !preset ? 'true' : undefined}>
        <CustomColour className="m-colour-custom__input" label={i18n._(customLabel)} value={current ?? fallback} onPick={onPick} />
      </span>
    </div>
  );
}

/**
 * A colour input that answers ONCE, when the person lets go: the one custom colour input of the application.
 *
 * A colour input fires `input` at every step of a drag in its picker, and React's `onChange` is that event. Answered at
 * each step, a drag was dozens of document commands, each composed against the version the drag began on: the first
 * applied and every later one was refused as out of date, the last among them, so the colour picked did not stick
 * (the owner's O6). So a step only moves what the input shows, and the DOM's own `change`, which the picker fires when
 * it closes on a new colour, is what answers. A value that arrives from outside while nothing is being picked replaces
 * what is shown.
 */
export function CustomColour({
  label,
  value,
  onPick,
  className,
  marks,
}: {
  readonly label: string;
  readonly value: string;
  readonly onPick: (hex: string) => void;
  readonly className?: string;
  /** Data attributes a caller finds the input by. */
  readonly marks?: Readonly<Record<`data-${string}`, string>>;
}): ReactElement {
  const [shown, setShown] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const picked = useRef(onPick);
  useEffect(() => {
    picked.current = onPick;
  }, [onPick]);
  // A VALUE FROM OUTSIDE, such as the selection changing, is what the input shows from then on.
  const [from, setFrom] = useState(value);
  if (from !== value) {
    setFrom(value);
    setShown(value);
  }
  useEffect(() => {
    const element = input.current;
    if (element === null) return undefined;
    const answer = (): void => {
      picked.current(element.value);
    };
    element.addEventListener('change', answer);
    return () => {
      element.removeEventListener('change', answer);
    };
  }, []);
  return (
    <input
      {...marks}
      aria-label={label}
      className={className}
      onChange={(event) => {
        setShown(event.target.value);
      }}
      ref={input}
      type="color"
      value={shown}
    />
  );
}

function Swatch({
  hex,
  label,
  pressed,
  onPress,
}: {
  readonly hex?: string;
  readonly label: MessageKey;
  readonly pressed: boolean;
  readonly onPress: () => void;
}): ReactElement {
  const { i18n } = useLingui();
  return (
    <button
      aria-label={i18n._(label)}
      aria-pressed={pressed}
      className={hex === undefined ? 'm-colour-swatch m-colour-swatch--auto' : 'm-colour-swatch'}
      onClick={onPress}
      // THE DOCUMENT COLOUR ITSELF, which is data rather than chrome: each caller's presets say why theirs are not tokens.
      style={hex === undefined ? undefined : { backgroundColor: hex }}
      title={i18n._(label)}
      type="button"
    />
  );
}
