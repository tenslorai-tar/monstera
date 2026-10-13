import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import { type ReactElement, type ReactNode, useId, useState } from 'react';

import { ColourSwatches } from './ColourChoice.js';
import { type DocumentFont, FontPicker, type FontList } from './FontPicker.js';
import {
  PROPERTIES_TEXT_COLOUR,
  TEXT_FORMAT_ALIGN_CENTER,
  TEXT_FORMAT_ALIGN_JUSTIFY,
  TEXT_FORMAT_ALIGN_LEFT,
  TEXT_FORMAT_ALIGN_RIGHT,
  TEXT_FORMAT_BOLD,
  TEXT_FORMAT_CHARACTER_SPACING,
  TEXT_FORMAT_COLOUR_AUTO,
  TEXT_FORMAT_COLOUR_CUSTOM,
  TEXT_FORMAT_FAMILY,
  TEXT_FORMAT_HIGHLIGHT,
  TEXT_FORMAT_HIGHLIGHT_CUSTOM,
  TEXT_FORMAT_HIGHLIGHT_NONE,
  TEXT_FORMAT_ITALIC,
  TEXT_FORMAT_SIZE,
  TEXT_FORMAT_SPACE_AFTER,
  TEXT_FORMAT_SPACING,
  TEXT_FORMAT_STRIKE,
  TEXT_FORMAT_SUBSCRIPT,
  TEXT_FORMAT_SUPERSCRIPT,
  TEXT_FORMAT_UNDERLINE,
  TEXT_PROPERTIES_TEXT,
} from './messages/en.js';
import { IconButton } from './primitives/IconButton.js';
import { ICONS, type IconName } from './primitives/icons.js';
import { HIGHLIGHT_COLOUR_FALLBACK, HIGHLIGHT_COLOURS, TEXT_COLOUR_FALLBACK, TEXT_COLOURS } from './textColours.js';

/**
 * THE ONE TEXT SECTION (the owner's N13): what Edit text, Add text, Text box, Typewriter and Callout show about their words,
 * in one order and one look, whichever writer the words go to.
 *
 * ## The order is the owner's
 *
 * Font and size on one row; the style buttons (B I U S x² x₂); text colour; highlight; alignment and justify; then line
 * spacing, space after and character spacing together, labels in one column and fields in the other.
 *
 * ## Only what applies is drawn
 *
 * A writer that cannot set a property is not offered it: `shows` names the optional rows a selection can take, and a row
 * not named is not drawn, rather than drawn and refused. A callout, whose styles its writer cannot draw, shows its font,
 * size, colour and alignment and nothing else.
 *
 * ## It holds no document and writes nothing itself
 *
 * Each control calls back with the one value it changed, and the caller sends it its own way: the open editor's
 * `formatOpenEditor`, or a box's `styleAnnotation` with one property. `live` says whether a number is sent as it is typed
 * (the editor, where every digit is drawn) or when its field is left (a box, where every send is a command).
 */

/** The four on/off styles, each a property of the words. */
export type TextToggle = 'bold' | 'italic' | 'underline' | 'strike';

/** The rows a selection may or may not take; font, size, colour and alignment are always drawn. */
export type TextRow = 'style' | 'rise' | 'highlight' | 'justify' | 'lineSpacing' | 'spaceAfter' | 'spacing';

/** How the words at the selection are, as the section shows them. */
export interface TextLook {
  readonly family: string | undefined;
  readonly size: number | undefined;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  readonly rise?: 'superscript' | 'subscript' | undefined;
  /** `#rrggbb`, or `undefined` for the words' own colour. */
  readonly colour: string | undefined;
  /** `#rrggbb`, or `undefined` for none. */
  readonly highlight?: string | undefined;
  readonly align: 'left' | 'center' | 'right' | 'justify' | undefined;
  /** A multiple of the size. */
  readonly lineSpacing?: number | undefined;
  /** Points. */
  readonly spaceAfter?: number | undefined;
  /** Points. */
  readonly spacing?: number | undefined;
}

/** A number field's bounds, in the unit its label says. */
export interface NumberBounds {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export interface TextSectionProps {
  readonly look: TextLook;
  readonly shows: ReadonlySet<TextRow>;
  readonly font: {
    readonly list: FontList;
    readonly builtIn: readonly string[];
    readonly inDocument: readonly DocumentFont[];
    /** What the button says while the words have no one family the picker names. */
    readonly unset: MessageKey;
  };
  /** Whether a typed number is sent as it is typed, or when its field is left. */
  readonly live: boolean;
  readonly sizeBounds: NumberBounds;
  readonly lineSpacingBounds: NumberBounds;
  /** The furthest character spacing goes either way at this size, in points, or `undefined` while the size is unknown. */
  readonly spacingBound: number | undefined;
  /** Whether the words' colour may be their own, offered as the first choice. */
  readonly ownColour: boolean;
  /** Controls a writer has beyond these, drawn after alignment: the editor's lists and indents. */
  readonly paragraphExtras?: ReactNode;
  readonly onFamily: (family: string) => void;
  readonly onSize: (points: number) => void;
  readonly onToggle: (style: TextToggle) => void;
  readonly onRise: (rise: 'superscript' | 'subscript') => void;
  readonly onColour: (hex: string | undefined) => void;
  readonly onHighlight: (hex: string | undefined) => void;
  readonly onAlign: (align: 'left' | 'center' | 'right' | 'justify') => void;
  /** `null` for an emptied field, which takes the property off. */
  readonly onLineSpacing: (multiple: number | null) => void;
  /** `null` for an emptied field or nought, which takes the property off. */
  readonly onSpaceAfter: (points: number | null) => void;
  /** In points; nought takes it off. */
  readonly onSpacing: (points: number) => void;
  /** Enter in a field: the editor gives the focus back to the words. */
  readonly onEnter?: () => void;
}

const TOGGLES: readonly { readonly style: TextToggle; readonly label: MessageKey; readonly icon: IconName }[] = [
  { style: 'bold', label: TEXT_FORMAT_BOLD, icon: 'Bold' },
  { style: 'italic', label: TEXT_FORMAT_ITALIC, icon: 'Italic' },
  { style: 'underline', label: TEXT_FORMAT_UNDERLINE, icon: 'Underline' },
  { style: 'strike', label: TEXT_FORMAT_STRIKE, icon: 'Strikethrough' },
];

const RISES = [
  { rise: 'superscript', label: TEXT_FORMAT_SUPERSCRIPT, icon: 'Superscript' },
  { rise: 'subscript', label: TEXT_FORMAT_SUBSCRIPT, icon: 'Subscript' },
] as const;

const ALIGNS = [
  { align: 'left', label: TEXT_FORMAT_ALIGN_LEFT, icon: 'AlignLeft' },
  { align: 'center', label: TEXT_FORMAT_ALIGN_CENTER, icon: 'AlignCenter' },
  { align: 'right', label: TEXT_FORMAT_ALIGN_RIGHT, icon: 'AlignRight' },
  { align: 'justify', label: TEXT_FORMAT_ALIGN_JUSTIFY, icon: 'AlignJustify' },
] as const;

/** A number as a person reads it: to a hundredth, and nothing for none. */
function shown(value: number | undefined): string {
  return value === undefined ? '' : String(Math.round(value * 100) / 100);
}

/**
 * Every number field of the section. Live, each value is sent as it is typed; otherwise when the field is left or Enter
 * is pressed, and only when it changed. A value outside its bounds is not sent, and the field shows the words' own value
 * again once left, except where `clamps` says the bound is the value's own limit rather than a mistake: then the value
 * finished outside it is held to it (character spacing, ADR-0228), never while it is still being typed, where `1` on the
 * way to `15` is not yet anything. An emptied field sends `null` where `clears` says it takes the property off, and
 * nothing otherwise.
 */
function NumberInput({
  id,
  value,
  bounds,
  live,
  clears,
  clamps = false,
  disabled = false,
  onSend,
  onEnter,
}: {
  readonly id: string;
  readonly value: number | undefined;
  readonly bounds: NumberBounds;
  readonly live: boolean;
  readonly clears: boolean;
  readonly clamps?: boolean;
  readonly disabled?: boolean;
  readonly onSend: (value: number | null) => void;
  readonly onEnter?: (() => void) | undefined;
}): ReactElement {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const send = (text: string, finished: boolean): void => {
    if (text === '') {
      if (clears && value !== undefined) onSend(null);
      return;
    }
    const typed = Number(text);
    if (!Number.isFinite(typed)) return;
    const next = clamps && finished ? Math.min(bounds.max, Math.max(bounds.min, typed)) : typed;
    if (next < bounds.min || next > bounds.max || next === value) return;
    onSend(next);
  };
  // A FIELD LEFT OR ENTERED: what a live field sent as it was typed is sent again only where clamping changes it.
  const finish = (): void => {
    if (draft !== undefined && (!live || clamps)) send(draft, true);
    setDraft(undefined);
  };
  return (
    <input
      className="m-text-section__number"
      disabled={disabled}
      id={id}
      max={bounds.max}
      min={bounds.min}
      onBlur={finish}
      onChange={(event) => {
        setDraft(event.target.value);
        if (live) send(event.target.value, false);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        finish();
        onEnter?.();
      }}
      step={bounds.step}
      type="number"
      value={draft ?? shown(value)}
    />
  );
}

/** A labelled number row of the spacing block: its label in the first column, its field in the second. */
function NumberRow(props: Omit<Parameters<typeof NumberInput>[0], 'id'> & { readonly label: MessageKey }): ReactElement {
  const { _ } = useLingui();
  const id = useId();
  const { label, ...input } = props;
  return (
    <>
      <label className="m-text-section__label" htmlFor={id}>
        {_(label)}
      </label>
      <NumberInput {...input} id={id} />
    </>
  );
}

export function TextSection(props: TextSectionProps): ReactElement {
  const { _ } = useLingui();
  const { look, shows, live, onEnter } = props;
  const sizeId = useId();
  return (
    <div aria-label={_(TEXT_PROPERTIES_TEXT)} className="m-text-section" data-text-section="" role="group">
      <h3 className="m-text-section__title">{_(TEXT_PROPERTIES_TEXT)}</h3>

      <div className="m-text-section__font">
        <FontPicker
          builtIn={props.font.builtIn}
          inDocument={props.font.inDocument}
          label={TEXT_FORMAT_FAMILY}
          list={props.font.list}
          onPick={props.onFamily}
          unset={props.font.unset}
          value={look.family}
        />
        <label className="m-visually-hidden" htmlFor={sizeId}>
          {_(TEXT_FORMAT_SIZE)}
        </label>
        <NumberInput
          bounds={props.sizeBounds}
          clears={false}
          id={sizeId}
          live={live}
          onEnter={onEnter}
          onSend={(points) => {
            if (points !== null) props.onSize(points);
          }}
          value={look.size}
        />
      </div>

      {shows.has('style') || shows.has('rise') ? (
        <div className="m-text-section__buttons">
          {shows.has('style')
            ? TOGGLES.map((toggle) => (
                <IconButton
                  icon={ICONS[toggle.icon]}
                  key={toggle.style}
                  label={toggle.label}
                  onClick={() => {
                    props.onToggle(toggle.style);
                  }}
                  pressed={look[toggle.style]}
                  size="control"
                />
              ))
            : null}
          {shows.has('rise')
            ? RISES.map((entry) => (
                <IconButton
                  icon={ICONS[entry.icon]}
                  key={entry.rise}
                  label={entry.label}
                  onClick={() => {
                    props.onRise(entry.rise);
                  }}
                  pressed={look.rise === entry.rise}
                  size="control"
                />
              ))
            : null}
        </div>
      ) : null}

      <div aria-label={_(PROPERTIES_TEXT_COLOUR)} className="m-text-section__row" role="group">
        <span className="m-text-section__label">{_(PROPERTIES_TEXT_COLOUR)}</span>
        <ColourSwatches
          auto={props.ownColour && look.colour === undefined}
          autoLabel={props.ownColour ? TEXT_FORMAT_COLOUR_AUTO : undefined}
          current={look.colour}
          customLabel={TEXT_FORMAT_COLOUR_CUSTOM}
          fallback={TEXT_COLOUR_FALLBACK}
          layout="start"
          onPick={props.onColour}
          presets={TEXT_COLOURS}
        />
      </div>

      {shows.has('highlight') ? (
        <div aria-label={_(TEXT_FORMAT_HIGHLIGHT)} className="m-text-section__row" role="group">
          <span className="m-text-section__label">{_(TEXT_FORMAT_HIGHLIGHT)}</span>
          <ColourSwatches
            auto={look.highlight === undefined}
            autoLabel={TEXT_FORMAT_HIGHLIGHT_NONE}
            current={look.highlight}
            customLabel={TEXT_FORMAT_HIGHLIGHT_CUSTOM}
            fallback={HIGHLIGHT_COLOUR_FALLBACK}
            layout="start"
            onPick={props.onHighlight}
            presets={HIGHLIGHT_COLOURS}
          />
        </div>
      ) : null}

      <div className="m-text-section__buttons">
        {ALIGNS.filter((entry) => entry.align !== 'justify' || shows.has('justify')).map((entry) => (
          <IconButton
            icon={ICONS[entry.icon]}
            key={entry.align}
            label={entry.label}
            onClick={() => {
              props.onAlign(entry.align);
            }}
            pressed={look.align === entry.align}
            size="control"
          />
        ))}
        {props.paragraphExtras}
      </div>

      {shows.has('lineSpacing') || shows.has('spaceAfter') || shows.has('spacing') ? (
        <div className="m-text-section__numbers">
          {shows.has('lineSpacing') ? (
            <NumberRow
              bounds={props.lineSpacingBounds}
              clears
              label={TEXT_FORMAT_SPACING}
              live={live}
              onEnter={onEnter}
              onSend={props.onLineSpacing}
              value={look.lineSpacing}
            />
          ) : null}
          {shows.has('spaceAfter') ? (
            <NumberRow
              bounds={{ min: 0, max: 500, step: 1 }}
              clears
              label={TEXT_FORMAT_SPACE_AFTER}
              live={live}
              onEnter={onEnter}
              onSend={(points) => {
                props.onSpaceAfter(points === 0 ? null : points);
              }}
              value={look.spaceAfter}
            />
          ) : null}
          {shows.has('spacing') ? (
            <NumberRow
              bounds={{ min: -(props.spacingBound ?? 0), max: props.spacingBound ?? 0, step: 0.1 }}
              clamps
              clears={false}
              disabled={props.spacingBound === undefined}
              label={TEXT_FORMAT_CHARACTER_SPACING}
              live={live}
              onEnter={onEnter}
              onSend={(points) => {
                props.onSpacing(points ?? 0);
              }}
              value={look.spacing}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
