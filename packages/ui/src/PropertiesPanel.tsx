import { useLingui } from '@lingui/react';
import {
  type AnnotationBlend,
  type AnnotationColour,
  MAX_ANNOTATION_AUTHOR,
  MAX_ANNOTATION_BORDER,
  MAX_ANNOTATION_FONT,
  MAX_ANNOTATION_TEXT,
  MIN_ANNOTATION_FONT,
  MIN_ANNOTATION_OPACITY,
} from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { type ReactElement, useId, useState } from 'react';

import { ANNOTATION_KIND_LABELS } from './AnnotationsPanel.js';
import { STARTING_STYLE_COLOUR, colourFromHex, hexFromColour } from './annotations/annotationStyle.js';
import type { AnnotationSelection } from './annotations/selectTool.js';
import { LINE_WIDTH_PRESETS, STYLE_PRESETS } from './annotations/stylePresets.js';
import {
  COMMENT_STYLES_NO_WIDTH,
  PROPERTIES_ACTIONS,
  PROPERTIES_AS_DEFAULT,
  PROPERTIES_AUTHOR,
  PROPERTIES_BLEND,
  PROPERTIES_BLEND_MULTIPLY,
  PROPERTIES_BLEND_NORMAL,
  PROPERTIES_CREATED,
  PROPERTIES_COLOUR,
  PROPERTIES_COMMENT,
  PROPERTIES_CUSTOM_COLOUR,
  PROPERTIES_FONT_SIZE,
  PROPERTIES_LINE_WIDTH,
  PROPERTIES_NEW_HEADING,
  PROPERTIES_NEW_HINT,
  PROPERTIES_OPACITY,
  PROPERTIES_OPACITY_VALUE,
  PROPERTIES_WHERE,
  PROPERTIES_WIDTH_VALUE,
  STYLE_COLOUR_AUTO,
  STYLE_PANEL_LABEL,
} from './messages/en.js';
import { pdfjsPageOf } from './pageNumbering.js';
import { Button } from './primitives/Button.js';
import { SegmentedControl, type SegmentedOption } from './primitives/SegmentedControl.js';
import type { CommandContext, CommandRegistry } from './registries/commands.js';
import {
  ANNOTATION_COLOUR_SETTING,
  ANNOTATION_FONT_SIZE_SETTING,
  ANNOTATION_LINE_WIDTH_SETTING,
  ANNOTATION_OPACITY_SETTING,
  STYLE_AS_DEFAULT_SETTING,
} from './settings/editing.js';
import type { SettingsStore } from './settingsStore.js';
import { propertiesModel } from './surfaces/projections.js';
import { useSetting } from './useSetting.js';

/** One change to the selected marks' style — each property alone, as `styleAnnotation` takes it. */
export type StyleChange =
  | { readonly colour: AnnotationColour }
  | { readonly opacity: number }
  | { readonly borderWidth: number }
  | { readonly blend: AnnotationBlend };

export interface PropertiesPanelProps {
  readonly settings: SettingsStore;
  /** What is selected, or `undefined` for nothing — when the tab shows the authoring settings. */
  readonly selection: AnnotationSelection | undefined;
  /** Restyles the whole selection, one property at a time, through the one dispatcher. */
  readonly onRestyle: (selection: AnnotationSelection, change: StyleChange) => void;
  /** Rewrites the one selected mark's comment. */
  readonly onComment: (selection: AnnotationSelection, text: string) => void;
  /** Rewrites who the one selected mark names as its author (ADR-0103). */
  readonly onAuthor: (selection: AnnotationSelection, author: string) => void;
  /** Where the foot's commands come from (`properties` placements), and what they run with. */
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
}

/**
 * The right panel's Properties tab — v5-02's, with ADR-0102 behind it.
 *
 * ## With marks selected, the controls ARE their style
 *
 * Each control sends one `styleAnnotation` naming only what it changed, so picking a colour for three
 * marks of three opacities changes their colour and leaves their opacities. `App` carries the
 * selection across the command (`KEEPS_THE_ANNOTATION_WALK`), which is what lets the next control be
 * used on the same marks. A slider sends on release, so a drag is one undo step.
 *
 * What the controls show is the FIRST selected mark's style, and the heading says how many are
 * selected — the honest reading of *what am I about to change*, where an averaged control would be a
 * value nothing in the document has.
 *
 * ## *Use as default* writes the authoring settings too
 *
 * Ticked, a change to the selection is also written to the four settings the tools read, so the next
 * mark is drawn the same way. Those settings are shared by every tool, so the label says
 * *annotations*, not the selected kind.
 *
 * ## With nothing selected, the controls are the authoring settings
 *
 * The same rows, writing settings rather than sending commands, plus the font size — which the tools
 * read and which no command changes on an existing mark — and *Each tool's own* first among the
 * colours, the setting's `'auto'`.
 *
 * ## Author, created and blend (ADR-0103)
 *
 * The author is the one mark's `/T`, sent on blur by its own command; the creation time is shown and
 * never edited; the blend is the appearance's, sent as one property of a restyle like the others. None
 * of the three is written to the authoring settings: the author's default is its own setting, and the
 * blend differs by kind.
 */
export function PropertiesPanel({
  settings,
  selection,
  onRestyle,
  onComment,
  onAuthor,
  registry,
  context,
}: PropertiesPanelProps): ReactElement {
  const { i18n } = useLingui();
  const asDefault = useSetting(settings, STYLE_AS_DEFAULT_SETTING);
  const colourSetting = useSetting(settings, ANNOTATION_COLOUR_SETTING);
  const opacitySetting = useSetting(settings, ANNOTATION_OPACITY_SETTING);
  const widthSetting = useSetting(settings, ANNOTATION_LINE_WIDTH_SETTING);
  const fontSize = useSetting(settings, ANNOTATION_FONT_SIZE_SETTING);
  const fontSizeId = useId();

  if (selection === undefined) {
    return (
      <section aria-label={i18n._(STYLE_PANEL_LABEL)} className="m-properties">
        <header className="m-properties__head">
          <h2 className="m-properties__title">{i18n._(PROPERTIES_NEW_HEADING)}</h2>
          <p className="m-properties__meta">{i18n._(PROPERTIES_NEW_HINT)}</p>
        </header>
        <ColourRow
          auto={colourSetting === 'auto'}
          current={colourSetting === 'auto' ? undefined : colourSetting}
          offerAuto
          onPick={(hex) => {
            settings.set(ANNOTATION_COLOUR_SETTING.id, hex ?? 'auto');
          }}
        />
        <OpacityRow
          value={opacitySetting}
          onCommit={(opacity) => {
            settings.set(ANNOTATION_OPACITY_SETTING.id, opacity);
          }}
        />
        <WidthRow
          value={widthSetting}
          onPick={(width) => {
            settings.set(ANNOTATION_LINE_WIDTH_SETTING.id, width);
          }}
        />
        <div className="m-properties__row m-properties__row--inline">
          <label className="m-properties__label" htmlFor={fontSizeId}>
            {i18n._(PROPERTIES_FONT_SIZE)}
          </label>
          <input
            className="m-properties__number"
            id={fontSizeId}
            max={MAX_ANNOTATION_FONT}
            min={MIN_ANNOTATION_FONT}
            onChange={(event) => {
              settings.set(ANNOTATION_FONT_SIZE_SETTING.id, Number(event.target.value));
            }}
            step={1}
            type="number"
            value={fontSize}
          />
        </div>
      </section>
    );
  }

  const first = selection.items[0];
  // A SELECTION IS NEVER EMPTY (`AnnotationSelection`'s own rule), so this is the type's gap rather
  // than a state: nothing is drawn for it.
  if (first === undefined) return <section className="m-properties" />;
  const only = selection.items.length === 1 ? first : undefined;
  /** The one mark's creation instant, or `null` — for several marks, or a mark with no date. */
  const created = only?.created ?? null;
  const hex = hexFromColour([first.style.colour[0] ?? 0, first.style.colour[1] ?? 0, first.style.colour[2] ?? 0]);
  // THE WIDTH ROW ONLY WHERE A SELECTED MARK HAS ONE. Six subtypes carry no `/BS`, and the kernel
  // skips them; a row that set nothing on a highlight would be a control that does nothing.
  const widths = selection.items.map((item) => item.style.borderWidth).filter((width) => width !== null);
  const foot = propertiesModel(registry, context);

  const change = (next: StyleChange): void => {
    onRestyle(selection, next);
    if (!asDefault) return;
    if ('colour' in next) settings.set(ANNOTATION_COLOUR_SETTING.id, hexFromColour(next.colour));
    if ('opacity' in next) settings.set(ANNOTATION_OPACITY_SETTING.id, next.opacity);
    if ('borderWidth' in next) settings.set(ANNOTATION_LINE_WIDTH_SETTING.id, next.borderWidth);
  };

  return (
    <section aria-label={i18n._(STYLE_PANEL_LABEL)} className="m-properties">
      <header className="m-properties__head">
        <h2 className="m-properties__title">{i18n._(ANNOTATION_KIND_LABELS[first.kind])}</h2>
        <p className="m-properties__meta">
          {i18n._(PROPERTIES_WHERE, { count: selection.items.length, page: pdfjsPageOf(selection.page) })}
        </p>
        {/* WHEN IT WAS MADE, read-only (ADR-0103): a mark carrying no date says nothing rather than
            showing one nobody wrote. The instant is formatted in the reader's own locale. */}
        {created === null ? null : (
          <p className="m-properties__meta" data-properties-created={created}>
            {i18n._(PROPERTIES_CREATED, {
              when: new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
                new Date(created),
              ),
            })}
          </p>
        )}
      </header>
      <ColourRow
        auto={false}
        current={hex}
        offerAuto={false}
        onPick={(picked) => {
          const colour = picked === undefined ? undefined : colourFromHex(picked);
          if (colour !== undefined) change({ colour });
        }}
      />
      <OpacityRow
        // THE CONTRACT'S FLOOR, so a foreign mark drawn fainter than a command may ask for shows where
        // the slider starts rather than off its end.
        value={Math.max(first.style.opacity, MIN_ANNOTATION_OPACITY)}
        onCommit={(opacity) => {
          change({ opacity });
        }}
      />
      {widths.length === 0 ? (
        <p className="m-properties__meta">{i18n._(COMMENT_STYLES_NO_WIDTH)}</p>
      ) : (
        <WidthRow
          value={first.style.borderWidth ?? widths[0] ?? 0}
          onPick={(borderWidth) => {
            change({ borderWidth });
          }}
        />
      )}
      <div className="m-properties__row">
        <span className="m-properties__label" aria-hidden="true">
          {i18n._(PROPERTIES_BLEND)}
        </span>
        {/* THE BLEND THE APPEARANCE IS DRAWN IN, the walk's reading rather than the dictionary's
            claim (ADR-0103). Not written to the authoring settings: it differs by kind, and a
            remembered blend would turn a person's next rectangle into a multiply. */}
        <SegmentedControl
          label={PROPERTIES_BLEND}
          onChange={(blend) => {
            onRestyle(selection, { blend });
          }}
          options={BLEND_OPTIONS}
          value={first.blend}
        />
      </div>
      {only === undefined ? null : (
        <AuthorRow
          // A NEW FIELD PER MARK AND PER NAME, `CommentRow`'s reason.
          key={`${String(selection.page)}:${String(only.index)}:${only.author}`}
          author={only.author}
          onCommit={(author) => {
            onAuthor(selection, author);
          }}
        />
      )}
      {only === undefined ? null : (
        <CommentRow
          // A NEW FIELD PER MARK AND PER TEXT, so a draft never outlives the mark it was typed for,
          // and the text a carried selection brings back replaces the draft that produced it.
          key={`${String(selection.page)}:${String(only.index)}:${only.contents}`}
          text={only.contents}
          onCommit={(text) => {
            onComment(selection, text);
          }}
        />
      )}
      <label className="m-properties__check">
        <input
          checked={asDefault}
          onChange={(event) => {
            settings.set(STYLE_AS_DEFAULT_SETTING.id, event.target.checked);
          }}
          type="checkbox"
        />
        <span>{i18n._(PROPERTIES_AS_DEFAULT)}</span>
      </label>
      {foot.length === 0 ? null : (
        <div aria-label={i18n._(PROPERTIES_ACTIONS)} className="m-properties__foot" role="group">
          {foot.map((entry) => (
            <Button
              key={entry.command.id}
              label={entry.command.title}
              onClick={() => {
                void entry.command.run(context);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}


/**
 * The swatches, a custom colour, and — for the authoring settings only — *Each tool's own* first.
 * `onPick(undefined)` is that choice; a hex is any other.
 */
function ColourRow({
  auto,
  current,
  offerAuto,
  onPick,
}: {
  readonly auto: boolean;
  readonly current: string | undefined;
  readonly offerAuto: boolean;
  readonly onPick: (hex: string | undefined) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const labelId = useId();
  const customId = useId();
  const preset = STYLE_PRESETS.some((entry) => entry.hex === current);
  return (
    <div aria-labelledby={labelId} className="m-properties__row" role="group">
      <span className="m-properties__label" id={labelId}>
        {i18n._(PROPERTIES_COLOUR)}
      </span>
      <div className="m-properties__swatches">
        {offerAuto ? (
          <Swatch
            label={STYLE_COLOUR_AUTO}
            pressed={auto}
            onPress={() => {
              onPick(undefined);
            }}
          />
        ) : null}
        {STYLE_PRESETS.map((entry) => (
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
        <span
          className="m-properties__custom"
          data-pressed={!auto && current !== undefined && !preset ? 'true' : undefined}
        >
          <input
            aria-label={i18n._(PROPERTIES_CUSTOM_COLOUR)}
            className="m-properties__custom-input"
            id={customId}
            onChange={(event) => {
              onPick(event.target.value);
            }}
            type="color"
            // THE SHAPES' RED while nothing is chosen: a colour input cannot show *no colour*, and
            // black is what it answers when given none.
            value={current ?? STARTING_STYLE_COLOUR}
          />
        </span>
      </div>
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
      className={hex === undefined ? 'm-properties__swatch m-properties__swatch--auto' : 'm-properties__swatch'}
      onClick={onPress}
      // THE DOCUMENT COLOUR ITSELF, which is data rather than chrome (`stylePresets.ts`).
      style={hex === undefined ? undefined : { backgroundColor: hex }}
      title={i18n._(label)}
      type="button"
    />
  );
}

/**
 * Opacity as a slider that SENDS ON RELEASE. The draft follows the pointer; the value is committed
 * once, when the pointer or key is let go or focus leaves, so a drag is one command and one undo step.
 * The draft is dropped when the value it produced arrives.
 */
function OpacityRow({
  value,
  onCommit,
}: {
  readonly value: number;
  readonly onCommit: (opacity: number) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const id = useId();
  // THE DRAFT REMEMBERS THE VALUE IT WAS DRAGGED FROM, and is shown only while that is still the
  // value: once the committed opacity arrives, or anything else changes it, the value wins.
  const [draft, setDraft] = useState<{ readonly from: number; readonly to: number } | undefined>(undefined);
  const live = draft?.from === value ? draft.to : undefined;
  const shown = live ?? value;
  const commit = (): void => {
    if (live !== undefined && live !== value) onCommit(live);
  };
  return (
    <div className="m-properties__row">
      <div className="m-properties__label-line">
        <label className="m-properties__label" htmlFor={id}>
          {i18n._(PROPERTIES_OPACITY)}
        </label>
        <output className="m-properties__value" htmlFor={id}>
          {i18n._(PROPERTIES_OPACITY_VALUE, { opacity: shown })}
        </output>
      </div>
      <input
        className="m-properties__slider"
        id={id}
        max={1}
        min={MIN_ANNOTATION_OPACITY}
        onBlur={commit}
        onChange={(event) => {
          setDraft({ from: value, to: Number(event.target.value) });
        }}
        onKeyUp={commit}
        onPointerUp={commit}
        step={0.05}
        type="range"
        value={shown}
      />
    </div>
  );
}

/** Line width as v5-02's four segments, with the figure beside the label. */
function WidthRow({
  value,
  onPick,
}: {
  readonly value: number;
  readonly onPick: (width: number) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const labelId = useId();
  return (
    <div aria-labelledby={labelId} className="m-properties__row" role="group">
      <div className="m-properties__label-line">
        <span className="m-properties__label" id={labelId}>
          {i18n._(PROPERTIES_LINE_WIDTH)}
        </span>
        <span className="m-properties__value">{i18n._(PROPERTIES_WIDTH_VALUE, { width: value })}</span>
      </div>
      <div className="m-properties__segments">
        {LINE_WIDTH_PRESETS.filter((width) => width <= MAX_ANNOTATION_BORDER).map((width) => (
          <button
            aria-label={i18n._(PROPERTIES_WIDTH_VALUE, { width })}
            aria-pressed={width === value}
            className="m-properties__segment"
            key={width}
            onClick={() => {
              if (width !== value) onPick(width);
            }}
            type="button"
          >
            {/* THE STROKE ITSELF, drawn at the width it names — scaled, since 5 pt is the widest here. */}
            <span className="m-properties__stroke" data-width={String(width)} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** The blend's two choices, in v5-02's order. */
const BLEND_OPTIONS: readonly SegmentedOption<AnnotationBlend>[] = [
  { value: 'multiply', label: PROPERTIES_BLEND_MULTIPLY },
  { value: 'normal', label: PROPERTIES_BLEND_NORMAL },
];

/** The one selected mark's author, sent when focus leaves it changed (ADR-0103). */
function AuthorRow({
  author,
  onCommit,
}: {
  readonly author: string;
  readonly onCommit: (author: string) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const id = useId();
  const [draft, setDraft] = useState(author);
  return (
    <div className="m-properties__row">
      <label className="m-properties__label" htmlFor={id}>
        {i18n._(PROPERTIES_AUTHOR)}
      </label>
      <input
        className="m-properties__comment"
        id={id}
        maxLength={MAX_ANNOTATION_AUTHOR}
        onBlur={() => {
          if (draft !== author) onCommit(draft);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        type="text"
        value={draft}
      />
    </div>
  );
}

/** The one selected mark's comment, sent when focus leaves it changed. */
function CommentRow({
  text,
  onCommit,
}: {
  readonly text: string;
  readonly onCommit: (text: string) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const id = useId();
  const [draft, setDraft] = useState(text);
  return (
    <div className="m-properties__row">
      <label className="m-properties__label" htmlFor={id}>
        {i18n._(PROPERTIES_COMMENT)}
      </label>
      <textarea
        className="m-properties__comment"
        id={id}
        maxLength={MAX_ANNOTATION_TEXT}
        onBlur={() => {
          if (draft !== text) onCommit(draft);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        rows={3}
        value={draft}
      />
    </div>
  );
}
