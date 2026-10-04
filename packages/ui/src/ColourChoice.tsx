import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

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
        <input
          aria-label={i18n._(customLabel)}
          className="m-colour-custom__input"
          onChange={(event) => {
            onPick(event.target.value);
          }}
          type="color"
          value={current ?? fallback}
        />
      </span>
    </div>
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
