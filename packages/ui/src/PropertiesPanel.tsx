import { useLingui } from '@lingui/react';
import {
  ANNOTATION_ALIGNMENTS,
  ANNOTATION_FONTS,
  type AnnotationAlign,
  type AnnotationBlend,
  type AnnotationColour,
  type AnnotationFont,
  type AnnotationTextStyle,
  MAX_ANNOTATION_AUTHOR,
  MAX_ANNOTATION_BORDER,
  MAX_ANNOTATION_FONT,
  DEFAULT_TEXT_LINE_HEIGHT,
  MAX_ANNOTATION_TEXT,
  MAX_TEXT_LINE_HEIGHT,
  MAX_TEXT_PADDING,
  MIN_ANNOTATION_FONT,
  MIN_TEXT_LINE_HEIGHT,
  MIN_ANNOTATION_OPACITY,
  measureUnitSchema,
} from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { type ReactElement, useEffect, useId, useState } from 'react';

import { ANNOTATION_KIND_LABELS } from './AnnotationsPanel.js';
import { ColourSwatches } from './ColourChoice.js';
import { STARTING_STYLE_COLOUR, colourFromHex, hexFromColour } from './annotations/annotationStyle.js';
import { type WordsOf, type WordsToEdit, markOf } from './annotations/markWords.js';
import type { AnnotationSelection, SelectedAnnotation } from './annotations/selectTool.js';
import { LINE_WIDTH_PRESETS, STYLE_PRESETS } from './annotations/stylePresets.js';
import {
  COMMENT_STYLES_NO_WIDTH,
  PROPERTIES_ACTIONS,
  PROPERTIES_OBJECT_HEADING,
  PROPERTIES_OBJECT_KIND,
  PROPERTIES_OBJECT_NO_FILL,
  PROPERTIES_AS_DEFAULT,
  PROPERTIES_AUTHOR,
  PROPERTIES_BLEND,
  PROPERTIES_BLEND_MULTIPLY,
  PROPERTIES_BLEND_NORMAL,
  PROPERTIES_CREATED,
  PROPERTIES_COLOUR,
  PROPERTIES_COMMENT,
  PROPERTIES_CUSTOM_COLOUR,
  PROPERTIES_ALIGN,
  PROPERTIES_ALIGN_CENTER,
  PROPERTIES_ALIGN_LEFT,
  PROPERTIES_ALIGN_JUSTIFY,
  PROPERTIES_ALIGN_RIGHT,
  PROPERTIES_BOX_FILL,
  PROPERTIES_BOX_FILL_COLOUR,
  PROPERTIES_BOX_PADDING,
  PROPERTIES_LINE_SPACING,
  PROPERTIES_STYLE_BOLD,
  PROPERTIES_STYLE_ITALIC,
  PROPERTIES_STYLE_STRIKE,
  PROPERTIES_STYLE_UNDERLINE,
  PROPERTIES_STYLES_UNAVAILABLE,
  PROPERTIES_FONT,
  PROPERTIES_FONT_MONO,
  PROPERTIES_FONT_SANS,
  PROPERTIES_FONT_SERIF,
  PROPERTIES_FONT_SIZE,
  PROPERTIES_LINE_WIDTH,
  PROPERTIES_TEXT_COLOUR,
  PROPERTIES_TEXT_HEADING,
  PROPERTIES_NEW_HEADING,
  PROPERTIES_NEW_HINT,
  PROPERTIES_OPACITY,
  PROPERTIES_OPACITY_VALUE,
  PROPERTIES_WHERE,
  PROPERTIES_WIDTH_VALUE,
  PROBLEM_COMMENT_TOO_LONG,
  STYLE_COLOUR_AUTO,
  STYLE_PANEL_LABEL,
  MEASURE_RATIO_TITLE,
  MEASURE_UNIT_TITLE,
  UNIT_TITLES,
} from './messages/en.js';
import { kindWord } from './ObjectEditLayer.js';
import { type ObjectFill, type ObjectPick, recolourable } from './objectEditing.js';
import { pdfjsPageOf } from './pageNumbering.js';
import { Button } from './primitives/Button.js';
import { SegmentedControl, type SegmentedOption } from './primitives/SegmentedControl.js';
import type { CommandContext, CommandRegistry } from './registries/commands.js';
import {
  ANNOTATION_COLOUR_SETTING,
  ANNOTATION_FONT_SETTING,
  ANNOTATION_FONT_SIZE_SETTING,
  ANNOTATION_LINE_WIDTH_SETTING,
  ANNOTATION_OPACITY_SETTING,
  MAX_MEASURE_RATIO,
  MEASURE_RATIO_SETTING,
  MEASURE_UNIT_SETTING,
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
  | { readonly blend: AnnotationBlend }
  // A TEXT BOX'S WORDS, one property at a time like the others (item 14b).
  | { readonly text: AnnotationTextStyle };

export interface PropertiesPanelProps {
  readonly settings: SettingsStore;
  /** What is selected, or `undefined` for nothing — when the tab shows the authoring settings. */
  readonly selection: AnnotationSelection | undefined;
  /** Restyles the whole selection, one property at a time, through the one dispatcher. */
  readonly onRestyle: (selection: AnnotationSelection, change: StyleChange) => void;
  /** Rewrites the one selected mark's comment. */
  readonly onComment: (selection: AnnotationSelection, text: string) => void;
  /** The comment the field may start from (`wordsToEdit`): whole, or the reason there is none. */
  readonly wordsOf: WordsOf;
  /** Rewrites who the one selected mark names as its author (ADR-0103). */
  readonly onAuthor: (selection: AnnotationSelection, author: string) => void;
  /** Where the foot's commands come from (`properties` placements), and what they run with. */
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
  /**
   * Whether a measurement tool is in use, when the tab also shows the unit and the drawing's scale it measures in
   * (the owner's item 14a). Only then: they mean nothing to any other tool.
   */
  readonly measuring?: boolean | undefined;
  /**
   * The object Edit object has selected on the page, and how its fill is changed (ADR-0153 Decision 5), or `undefined`
   * when none is. The tool slot holds Edit object or the select tool, never both, so this and {@link selection} are
   * never both set.
   */
  readonly object?: { readonly pick: ObjectPick; readonly onRecolour: (colour: ObjectFill) => void } | undefined;
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
  wordsOf,
  onAuthor,
  registry,
  context,
  measuring = false,
  object,
}: PropertiesPanelProps): ReactElement {
  const { i18n } = useLingui();
  const measureUnit = useSetting(settings, MEASURE_UNIT_SETTING);
  const measureRatio = useSetting(settings, MEASURE_RATIO_SETTING);
  const unitId = useId();
  const ratioId = useId();
  const [ratioText, setRatioText] = useState<string | undefined>(undefined);
  const asDefault = useSetting(settings, STYLE_AS_DEFAULT_SETTING);
  const colourSetting = useSetting(settings, ANNOTATION_COLOUR_SETTING);
  const opacitySetting = useSetting(settings, ANNOTATION_OPACITY_SETTING);
  const widthSetting = useSetting(settings, ANNOTATION_LINE_WIDTH_SETTING);
  const fontSize = useSetting(settings, ANNOTATION_FONT_SIZE_SETTING);
  const fontSizeId = useId();

  if (selection === undefined && object !== undefined) {
    const { pick } = object;
    const { fill } = pick.object;
    const objectFoot = propertiesModel(registry, context);
    return (
      <section aria-label={i18n._(STYLE_PANEL_LABEL)} className="m-properties">
        <header className="m-properties__head">
          <h2 className="m-properties__title">{i18n._(PROPERTIES_OBJECT_HEADING)}</h2>
          <p className="m-properties__meta" data-properties-object-kind={pick.object.kind}>
            {i18n._(PROPERTIES_OBJECT_KIND)}: {i18n._(kindWord(pick.object.kind))}
          </p>
        </header>
        {recolourable(pick) && fill !== null ? (
          <ColourRow
            auto={false}
            current={hexFromColour([fill.red / 255, fill.green / 255, fill.blue / 255])}
            offerAuto={false}
            onPick={(picked) => {
              const colour = picked === undefined ? undefined : colourFromHex(picked);
              if (colour === undefined) return;
              // THE OBJECT'S OWN ALPHA KEPT: a colour swatch says nothing about transparency.
              object.onRecolour({
                red: Math.round(colour[0] * 255),
                green: Math.round(colour[1] * 255),
                blue: Math.round(colour[2] * 255),
                alpha: fill.alpha,
              });
            }}
          />
        ) : pick.object.source === 'content' && pick.object.kind !== 'image' ? (
          // SAID RATHER THAN HIDDEN: a shape whose colour PDFium will not describe shows no colour row, and a person
          // looking for one is told why rather than left to wonder.
          <p className="m-properties__meta">{i18n._(PROPERTIES_OBJECT_NO_FILL)}</p>
        ) : null}
        {objectFoot.length === 0 ? null : (
          <div aria-label={i18n._(PROPERTIES_ACTIONS)} className="m-properties__foot" role="group">
            {objectFoot.map((entry) => (
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
        {measuring ? (
          <>
            <div className="m-properties__row m-properties__row--inline">
              <label className="m-properties__label" htmlFor={unitId}>
                {i18n._(MEASURE_UNIT_TITLE)}
              </label>
              <select
                className="m-properties__number"
                id={unitId}
                value={measureUnit}
                onChange={(event) => {
                  const unit = measureUnitSchema.safeParse(event.target.value);
                  if (unit.success) settings.set(MEASURE_UNIT_SETTING.id, unit.data);
                }}
              >
                {measureUnitSchema.options.map((unit) => (
                  <option key={unit} value={unit}>
                    {i18n._(UNIT_TITLES[unit])}
                  </option>
                ))}
              </select>
            </div>
            <div className="m-properties__row m-properties__row--inline">
              <label className="m-properties__label" htmlFor={ratioId}>
                {i18n._(MEASURE_RATIO_TITLE)}
              </label>
              <input
                className="m-properties__number"
                id={ratioId}
                max={MAX_MEASURE_RATIO}
                min={1}
                onBlur={() => {
                  setRatioText(undefined);
                }}
                onChange={(event) => {
                  // THE TEXT AS TYPED, and the setting only once it is a scale it holds: an emptied or zero field is a
                  // person mid-typing, and a field that snapped back to the last scale would fight them.
                  setRatioText(event.target.value);
                  const ratio = Number(event.target.value);
                  if (ratio > 0 && ratio <= MAX_MEASURE_RATIO) settings.set(MEASURE_RATIO_SETTING.id, ratio);
                }}
                step="any"
                type="number"
                value={ratioText ?? String(measureRatio)}
              />
            </div>
          </>
        ) : null}
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
    // THE TEXT SETTINGS THE TOOLS READ: a new text box starts in the face and at the size just chosen (item 14b). The
    // colour is the shared annotation colour's, set by the row above, so a text colour is not written to it.
    if ('text' in next) {
      if (next.text.font !== undefined) settings.set(ANNOTATION_FONT_SETTING.id, next.text.font);
      if (next.text.fontSize !== undefined) settings.set(ANNOTATION_FONT_SIZE_SETTING.id, next.text.fontSize);
    }
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
      {first.typed === undefined ? null : (
        // A TEXT BOX, TYPEWRITER OR CALLOUT: the face, size, colour and side its words are drawn in, for the whole box.
        <TextSection
          // A NEW SET OF FIELDS PER MARK AND PER SIZE, so a typed size never outlives the mark it was typed for.
          key={`${String(selection.page)}:${String(first.index)}:${String(first.typed.fontSize)}`}
          typed={first.typed}
          onChange={(text) => {
            change({ text });
          }}
        />
      )}
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
          selection={selection}
          item={only}
          wordsOf={wordsOf}
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
  label = PROPERTIES_COLOUR,
  offerAuto,
  onPick,
}: {
  readonly auto: boolean;
  readonly current: string | undefined;
  /** What the row is called: *Colour* for a mark's, *Text colour* for its words'. */
  readonly label?: MessageKey;
  readonly offerAuto: boolean;
  readonly onPick: (hex: string | undefined) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const labelId = useId();
  return (
    <div aria-labelledby={labelId} className="m-properties__row" role="group">
      <span className="m-properties__label" id={labelId}>
        {i18n._(label)}
      </span>
      {/* THE APPLICATION'S ONE COLOUR CONTROL (`ColourChoice.tsx`), with a mark's colours (`stylePresets.ts`). */}
      <ColourSwatches
        presets={STYLE_PRESETS}
        current={current}
        auto={auto}
        autoLabel={offerAuto ? STYLE_COLOUR_AUTO : undefined}
        customLabel={PROPERTIES_CUSTOM_COLOUR}
        // THE SHAPES' RED while nothing is chosen: a colour input cannot show *no colour*, and black is what it
        // answers when given none.
        fallback={STARTING_STYLE_COLOUR}
        onPick={onPick}
      />
    </div>
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

const FONT_LABELS: Readonly<Record<AnnotationFont, MessageKey>> = {
  sans: PROPERTIES_FONT_SANS,
  serif: PROPERTIES_FONT_SERIF,
  mono: PROPERTIES_FONT_MONO,
};

const ALIGN_OPTIONS: readonly SegmentedOption<AnnotationAlign>[] = ANNOTATION_ALIGNMENTS.map((value) => ({
  value,
  label: {
    left: PROPERTIES_ALIGN_LEFT,
    center: PROPERTIES_ALIGN_CENTER,
    right: PROPERTIES_ALIGN_RIGHT,
    justify: PROPERTIES_ALIGN_JUSTIFY,
  }[value],
}));

/** A new box fill's first colour: a pale yellow, which a person then changes. */
const STARTING_BOX_FILL: AnnotationColour = [1, 1, 0.8];

/** The four on/off styles, each a field of the text style and each its own checkbox. */
const STYLE_TOGGLES = [
  { field: 'bold', label: PROPERTIES_STYLE_BOLD },
  { field: 'italic', label: PROPERTIES_STYLE_ITALIC },
  { field: 'underline', label: PROPERTIES_STYLE_UNDERLINE },
  { field: 'strike', label: PROPERTIES_STYLE_STRIKE },
] as const;

/**
 * The Text section of a selected text box, typewriter or callout (the owner's review of 2026-10-07, item 14b): its face,
 * size, colour, the side its lines sit against, and (ADR-0211) bold, italic, underline, strikethrough, line spacing, padding
 * and a fill. **Each control sends one property**, as the rows above do, and applies to the whole box; Monstera writes the
 * appearance itself, so what is shown is what a reader draws. A box that cannot take them says so instead of showing controls.
 */
function TextSection({
  typed,
  onChange,
}: {
  readonly typed: NonNullable<SelectedAnnotation['typed']>;
  readonly onChange: (text: AnnotationTextStyle) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const fontId = useId();
  const sizeId = useId();
  const [size, setSize] = useState(String(typed.fontSize));
  const sendSize = (): void => {
    const next = Number(size);
    if (Number.isFinite(next) && next >= MIN_ANNOTATION_FONT && next <= MAX_ANNOTATION_FONT && next !== typed.fontSize) {
      onChange({ fontSize: next });
    }
  };
  const spacingId = useId();
  const paddingId = useId();
  const [spacing, setSpacing] = useState(String(typed.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT));
  const [padding, setPadding] = useState(String(typed.padding ?? 0));
  const sendSpacing = (): void => {
    const next = Number(spacing);
    if (Number.isFinite(next) && next >= MIN_TEXT_LINE_HEIGHT && next <= MAX_TEXT_LINE_HEIGHT && next !== (typed.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT)) {
      onChange({ lineHeight: next });
    }
  };
  const sendPadding = (): void => {
    const next = Number(padding);
    if (Number.isFinite(next) && next >= 0 && next <= MAX_TEXT_PADDING && next !== (typed.padding ?? 0)) onChange({ padding: next });
  };
  return (
    <div className="m-properties__text" data-properties-text="" role="group" aria-label={i18n._(PROPERTIES_TEXT_HEADING)}>
      <h3 className="m-properties__subtitle">{i18n._(PROPERTIES_TEXT_HEADING)}</h3>
      <div className="m-properties__row m-properties__row--inline">
        <label className="m-properties__label" htmlFor={fontId}>
          {i18n._(PROPERTIES_FONT)}
        </label>
        <select
          className="m-properties__number"
          id={fontId}
          onChange={(event) => {
            const font = ANNOTATION_FONTS.find((each) => each === event.target.value);
            if (font !== undefined && font !== typed.font) onChange({ font });
          }}
          value={typed.font}
        >
          {ANNOTATION_FONTS.map((font) => (
            <option key={font} value={font}>
              {i18n._(FONT_LABELS[font])}
            </option>
          ))}
        </select>
      </div>
      <div className="m-properties__row m-properties__row--inline">
        <label className="m-properties__label" htmlFor={sizeId}>
          {i18n._(PROPERTIES_FONT_SIZE)}
        </label>
        <input
          className="m-properties__number"
          id={sizeId}
          max={MAX_ANNOTATION_FONT}
          min={MIN_ANNOTATION_FONT}
          onBlur={sendSize}
          onChange={(event) => {
            setSize(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') sendSize();
          }}
          step={1}
          type="number"
          value={size}
        />
      </div>
      <ColourRow
        auto={false}
        current={hexFromColour(typed.colour)}
        label={PROPERTIES_TEXT_COLOUR}
        offerAuto={false}
        onPick={(picked) => {
          const colour = picked === undefined ? undefined : colourFromHex(picked);
          if (colour !== undefined) onChange({ colour });
        }}
      />
      <div className="m-properties__row">
        <span className="m-properties__label" aria-hidden="true">
          {i18n._(PROPERTIES_ALIGN)}
        </span>
        <SegmentedControl
          label={PROPERTIES_ALIGN}
          onChange={(align) => {
            onChange({ align });
          }}
          options={ALIGN_OPTIONS}
          value={typed.align ?? 'left'}
        />
      </div>
      {typed.stylesUnavailable === true ? (
        <p className="m-properties__hint">{i18n._(PROPERTIES_STYLES_UNAVAILABLE)}</p>
      ) : (
        <>
          <div className="m-properties__row m-properties__row--inline" role="group">
            {STYLE_TOGGLES.map(({ field, label }) => (
              <label className="m-properties__check" key={field}>
                <input
                  checked={typed[field] === true}
                  onChange={(event) => {
                    onChange({ [field]: event.target.checked });
                  }}
                  type="checkbox"
                />
                <span>{i18n._(label)}</span>
              </label>
            ))}
          </div>
          <div className="m-properties__row m-properties__row--inline">
            <label className="m-properties__label" htmlFor={spacingId}>
              {i18n._(PROPERTIES_LINE_SPACING)}
            </label>
            <input
              className="m-properties__number"
              id={spacingId}
              max={MAX_TEXT_LINE_HEIGHT}
              min={MIN_TEXT_LINE_HEIGHT}
              onBlur={sendSpacing}
              onChange={(event) => {
                setSpacing(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') sendSpacing();
              }}
              step={0.1}
              type="number"
              value={spacing}
            />
          </div>
          <div className="m-properties__row m-properties__row--inline">
            <label className="m-properties__label" htmlFor={paddingId}>
              {i18n._(PROPERTIES_BOX_PADDING)}
            </label>
            <input
              className="m-properties__number"
              id={paddingId}
              max={MAX_TEXT_PADDING}
              min={0}
              onBlur={sendPadding}
              onChange={(event) => {
                setPadding(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') sendPadding();
              }}
              step={1}
              type="number"
              value={padding}
            />
          </div>
          <label className="m-properties__check">
            <input
              checked={typed.fill !== undefined}
              onChange={(event) => {
                onChange({ fill: event.target.checked ? STARTING_BOX_FILL : null });
              }}
              type="checkbox"
            />
            <span>{i18n._(PROPERTIES_BOX_FILL)}</span>
          </label>
          {typed.fill === undefined ? null : (
            <ColourRow
              auto={false}
              current={hexFromColour(typed.fill)}
              label={PROPERTIES_BOX_FILL_COLOUR}
              offerAuto={false}
              onPick={(picked) => {
                const fill = picked === undefined ? undefined : colourFromHex(picked);
                if (fill !== undefined) onChange({ fill });
              }}
            />
          )}
        </>
      )}
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
  selection,
  item,
  wordsOf,
  onCommit,
}: {
  readonly selection: AnnotationSelection;
  readonly item: SelectedAnnotation;
  readonly wordsOf: WordsOf;
  readonly onCommit: (text: string) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const id = useId();
  // THE WALK'S TEXT WHERE IT IS WHOLE, and nothing until the whole words are read where the walk cut it: a field that
  // opened on the slice would save it over the comment on the first blur (`wordsToEdit`).
  const [words, setWords] = useState<WordsToEdit | undefined>(
    item.cut === true ? undefined : { kind: 'words', text: item.contents },
  );
  const [draft, setDraft] = useState(item.contents);
  useEffect(() => {
    if (item.cut !== true) return undefined;
    let live = true;
    void wordsOf(markOf(selection, item)).then((read) => {
      if (!live) return;
      setWords(read);
      if (read.kind === 'words') setDraft(read.text);
    });
    return () => {
      live = false;
    };
  }, [selection, item, wordsOf]);
  const start = words?.kind === 'words' ? words.text : undefined;
  return (
    <div className="m-properties__row">
      <label className="m-properties__label" htmlFor={id}>
        {i18n._(PROPERTIES_COMMENT)}
      </label>
      <textarea
        aria-busy={words === undefined}
        className="m-properties__comment"
        id={id}
        maxLength={MAX_ANNOTATION_TEXT}
        onBlur={() => {
          if (start !== undefined && draft !== start) onCommit(draft);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        // READ ONLY until there are whole words to start from, showing the walk's own start of the comment meanwhile,
        // and for good where there are none: a comment longer than an edit can write back, or a read refused.
        readOnly={start === undefined}
        rows={3}
        value={draft}
      />
      {words?.kind === 'too-long' ? <p className="m-properties__meta">{i18n._(PROBLEM_COMMENT_TOO_LONG)}</p> : null}
    </div>
  );
}
