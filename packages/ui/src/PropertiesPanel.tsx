import { useLingui } from '@lingui/react';
import {
  ANNOTATION_FONTS,
  type AnnotationBlend,
  type AnnotationColour,
  type AnnotationRect,
  ANNOTATION_FONT_FAMILIES,
  type AnnotationTextStyle,
  TEXT_BOX_BORDER_STYLES,
  MAX_ANNOTATION_AUTHOR,
  MAX_ANNOTATION_BORDER,
  MAX_ANNOTATION_FONT,
  MAX_CARET_SIZE,
  MIN_CARET_SIZE,
  DEFAULT_TEXT_LINE_HEIGHT,
  MAX_ANNOTATION_TEXT,
  MAX_TEXT_LINE_HEIGHT,
  MAX_TEXT_PADDING,
  MIN_ANNOTATION_FONT,
  MIN_TEXT_LINE_HEIGHT,
  MIN_ANNOTATION_OPACITY,
  measureUnitSchema,
  type TextBoxLook,
  textBoxLookSchema,
} from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { type ReactElement, type ReactNode, useEffect, useId, useState } from 'react';

import { ANNOTATION_KIND_LABELS } from './AnnotationsPanel.js';
import { ColourSwatches } from './ColourChoice.js';
import { BUILT_IN_ONLY, type DocumentFont, type FontList } from './FontPicker.js';
import { STARTING_STYLE_COLOUR, colourFromHex, hexFromColour } from './annotations/annotationStyle.js';
import { type WordsOf, type WordsToEdit, markOf } from './annotations/markWords.js';
import type { AnnotationSelection, SelectedAnnotation } from './annotations/selectTool.js';
import { LINE_WIDTH_PRESETS, STYLE_PRESETS } from './annotations/stylePresets.js';
import {
  COMMENT_STYLES_NO_WIDTH,
  PROPERTIES_ACTIONS,
  PROPERTIES_AS_DEFAULT,
  PROPERTIES_AUTHOR,
  PROPERTIES_BLEND,
  PROPERTIES_CARET_SIZE,
  PROPERTIES_BLEND_MULTIPLY,
  PROPERTIES_BLEND_NORMAL,
  PROPERTIES_CREATED,
  PROPERTIES_COLOUR,
  PROPERTIES_COMMENT,
  PROPERTIES_CUSTOM_COLOUR,
  PROPERTIES_BOX_FILL,
  PROPERTIES_BOX_FILL_COLOUR,
  PROPERTIES_BOX_BORDER_DASHED,
  PROPERTIES_BOX_BORDER_SOLID,
  PROPERTIES_BOX_BORDER_STYLE,
  PROPERTIES_BOX_PADDING,
  PROPERTIES_FONT,
  PROPERTIES_FONT_SIZE,
  PROPERTIES_LINE_WIDTH,
  TEXT_PROPERTIES_BOX,
  PROPERTIES_COMMENT_DETAILS,
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
import { spacingBoundOf, spacingOf } from './textFormatting.js';
import { NumberInput, TextSection, type TextRow } from './TextSection.js';
import { pdfjsPageOf } from './pageNumbering.js';
import { Button } from './primitives/Button.js';
import { SegmentedControl, type SegmentedOption } from './primitives/SegmentedControl.js';
import type { CommandContext, CommandRegistry } from './registries/commands.js';
import type { LiveReading } from './registries/tools.js';
import {
  ANNOTATION_COLOUR_SETTING,
  ANNOTATION_FONT_SETTING,
  ANNOTATION_FONT_SIZE_SETTING,
  ANNOTATION_LINE_WIDTH_SETTING,
  ANNOTATION_OPACITY_SETTING,
  CARET_SIZE_SETTING,
  MAX_MEASURE_RATIO,
  MEASURE_RATIO_SETTING,
  MEASURE_UNIT_SETTING,
  STYLE_AS_DEFAULT_SETTING,
  TEXT_BOX_LOOK_SETTING,
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
  /**
   * Sizes the selected insertion marks to `size` points tall, each about its own centre (the owner's O5); absent where the
   * tab's host offers no placement.
   */
  readonly onResize?: ((selection: AnnotationSelection, size: number) => void) | undefined;
  /** Where the foot's commands come from (`properties` placements), and what they run with. */
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
  /**
   * Whether a measurement tool is in use, when the tab also shows the unit and the drawing's scale it measures in
   * (the owner's item 14a). Only then: they mean nothing to any other tool.
   */
  readonly measuring?: boolean | undefined;
  /**
   * What a measurement being reshaped reads under the pointer (the owner's B1), or `undefined` for none: while it names
   * the selected mark, the Comment shows it, so the label and the Comment never hold two numbers.
   */
  readonly reading?: LiveReading | undefined;
  /** The computer's and Monstera's fonts, which a text box's and a typewriter's picker offers (K2); `undefined` while read. */
  readonly fonts?: FontList;
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
/** The words the Comment shows for `item`: a reshape's live reading while it names this mark, else the mark's own. */
function shownComment(page: number, item: SelectedAnnotation, reading: LiveReading | undefined): string {
  return reading?.page === page && reading.index === item.index ? reading.text : item.contents;
}

export function PropertiesPanel({
  settings,
  selection,
  onRestyle,
  onComment,
  wordsOf,
  onAuthor,
  onResize,
  registry,
  context,
  measuring = false,
  reading,
  fonts,
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
  const textBoxLook = useSetting(settings, TEXT_BOX_LOOK_SETTING);
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
      if (next.text.family !== undefined) settings.set(ANNOTATION_FONT_SETTING.id, next.text.family);
      else if (next.text.font !== undefined) settings.set(ANNOTATION_FONT_SETTING.id, ANNOTATION_FONT_FAMILIES[next.text.font]);
      if (next.text.fontSize !== undefined) settings.set(ANNOTATION_FONT_SIZE_SETTING.id, next.text.fontSize);
      // AND THE REST OF THE SECTION (B5.9): each member the box's look has, merged into what was kept, so a new text box
      // is made bold, centred, filled or inset as the one just restyled. The contract's one list of those members decides.
      const look = Object.fromEntries(
        Object.entries(next.text).filter(([member]) => Object.hasOwn(textBoxLookSchema.shape, member)),
      ) as TextBoxLook;
      if (Object.keys(look).length > 0) settings.set(TEXT_BOX_LOOK_SETTING.id, { ...textBoxLook, ...look });
    }
  };

  /** The mark's own look: its colour, opacity and line width. For a text box, the Box group's first rows. */
  const lookRows = (
    <>
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
    </>
  );
  const blendRow = (
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
  );
  const authorRow =
    only === undefined ? null : (
      <AuthorRow
        // A NEW FIELD PER MARK AND PER NAME, `CommentRow`'s reason.
        key={`${String(selection.page)}:${String(only.index)}:${only.author}`}
        author={only.author}
        onCommit={(author) => {
          onAuthor(selection, author);
        }}
      />
    );

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
      {first.typed === undefined ? (
        <>
          {lookRows}
          {/* AN INSERTION MARK'S SIZE (the owner's O5), where every selected mark is one: its height in points, which
              the kernel keeps through every redraw, and the next caret's too with *Use as default* ticked. */}
          {onResize !== undefined && selection.items.every((item) => item.kind === 'caret') ? (
            <CaretSizeRow
              key={`${String(selection.page)}:${String(first.index)}:${String(caretSizeOf(first.rect))}`}
              value={caretSizeOf(first.rect)}
              onPick={(size) => {
                onResize(selection, size);
                if (asDefault) settings.set(CARET_SIZE_SETTING.id, size);
              }}
            />
          ) : null}
          {blendRow}
          {authorRow}
        </>
      ) : (
        // A TEXT BOX, TYPEWRITER OR CALLOUT (the owner's text E4): its Text, then its Box — the border, opacity and width
        // the other marks show at the top are the box's own look here — and the comment's details folded at the foot.
        // The box's words are edited ON THE PAGE, so no comment field is shown for them.
        <>
          <TextBoxSections
            // A NEW SET OF FIELDS PER MARK AND PER SIZE, so a typed size never outlives the mark it was typed for.
            bordered={(first.style.borderWidth ?? 0) > 0}
            box={lookRows}
            key={`${String(selection.page)}:${String(first.index)}:${String(first.typed.fontSize)}`}
            typed={first.typed}
            // A MARK MONSTERA CANNOT DRAW — a callout, whose words the engine draws with its leader — is offered the
            // standard faces alone, which the engine sets; the kernel says which in `stylesUnavailable`.
            fonts={selection.items.some((item) => item.typed?.stylesUnavailable === true) ? STANDARD_ONLY : fonts}
            onChange={(text) => {
              change({ text });
            }}
          />
          <details className="m-properties__details" data-properties-comment-details="">
            <summary className="m-properties__subtitle">{i18n._(PROPERTIES_COMMENT_DETAILS)}</summary>
            {blendRow}
            {authorRow}
          </details>
        </>
      )}
      {only === undefined || first.typed !== undefined ? null : (
        <CommentRow
          // A NEW FIELD PER MARK AND PER TEXT, so a draft never outlives the mark it was typed for,
          // and the text a carried selection brings back replaces the draft that produced it.
          key={`${String(selection.page)}:${String(only.index)}:${shownComment(selection.page, only, reading)}`}
          selection={selection}
          // WHILE A RESHAPE READS THIS MARK, ITS READING (B1): the field starts on it, so its draft is its start and a
          // blur sends nothing, and the release's own words replace it when the page is drawn from them.
          item={{ ...only, contents: shownComment(selection.page, only, reading) }}
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

/**
 * An insertion mark's size: the SHORTER side of its box, which is its height at MuPDF's 20 wide to 14 tall whichever way
 * the page is turned, rounded to a tenth as a person reads it.
 */
export function caretSizeOf(rect: AnnotationRect): number {
  return Math.round(Math.min(Math.abs(rect.x1 - rect.x0), Math.abs(rect.y1 - rect.y0)) * 10) / 10;
}

/**
 * A caret's box at `size` points tall: its own box scaled about its centre, so its proportions and its orientation on a
 * turned page are kept and only its size changes. The one rule the Size row and its command share.
 */
export function caretRectAt(rect: AnnotationRect, size: number): AnnotationRect {
  const now = Math.min(Math.abs(rect.x1 - rect.x0), Math.abs(rect.y1 - rect.y0));
  const scale = now === 0 ? 1 : size / now;
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;
  const halfWide = (Math.abs(rect.x1 - rect.x0) * scale) / 2;
  const halfTall = (Math.abs(rect.y1 - rect.y0) * scale) / 2;
  return { x0: cx - halfWide, y0: cy - halfTall, x1: cx + halfWide, y1: cy + halfTall };
}

/** A caret's size row: one number field in points, sent when left or entered, held to the contract's bounds. */
function CaretSizeRow({ value, onPick }: { readonly value: number; readonly onPick: (size: number) => void }): ReactElement {
  const { i18n } = useLingui();
  const id = useId();
  return (
    <div className="m-properties__row m-properties__row--inline">
      <label className="m-properties__label" htmlFor={id}>
        {i18n._(PROPERTIES_CARET_SIZE)}
      </label>
      <NumberInput
        bounds={{ min: MIN_CARET_SIZE, max: MAX_CARET_SIZE, step: 1 }}
        clamps
        clears={false}
        id={id}
        live={false}
        onSend={(size) => {
          if (size !== null) onPick(size);
        }}
        value={value}
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

/** The faces a text box is set in, by name, in the picker's order: the contract's one table. */
const TEXT_BOX_FAMILIES = ANNOTATION_FONTS.map((font) => ANNOTATION_FONT_FAMILIES[font]);
/** The family a mark's words are in by name: the one it was drawn in (K2), else its `/DA` class's standard face. */
function familyOfTyped(typed: NonNullable<SelectedAnnotation['typed']>): string {
  return typed.family ?? ANNOTATION_FONT_FAMILIES[typed.font];
}

/** A callout's picker: the standard faces alone, said as a list, since nothing else is offered rather than unread. */
const STANDARD_ONLY: FontList = BUILT_IN_ONLY;
const NO_DOCUMENT_FONTS: readonly DocumentFont[] = [];

/** A new box fill's first colour: a pale yellow, which a person then changes. */
const STARTING_BOX_FILL: AnnotationColour = [1, 1, 0.8];

/** What a box Monstera draws takes beyond font, size, colour and alignment (ADR-0211, ADR-0228). */
const BOX_ROWS: ReadonlySet<TextRow> = new Set(['style', 'justify', 'lineSpacing', 'spacing']);
/** A box whose styles its writer cannot draw (a callout): font, size, colour and alignment alone. */
const NO_ROWS: ReadonlySet<TextRow> = new Set();

/**
 * A selected text box's, typewriter's or callout's two sections (the owner's N13): the one Text section every text tool
 * shows (`TextSection.tsx`), and the Box section below it with the box's own look. **Each control sends one property**, as
 * the rows above do, and applies to the whole box; Monstera writes the appearance itself, so what is shown is what a reader
 * draws. A box whose styles its writer cannot draw (a callout) is shown only the rows it takes, with no sentence about the
 * others.
 */
function TextBoxSections({
  typed,
  box,
  bordered,
  fonts,
  onChange,
}: {
  readonly typed: NonNullable<SelectedAnnotation['typed']>;
  /** What the picker offers beyond the standard faces: the font list for a box Monstera draws, nothing for a callout. */
  readonly fonts: FontList;
  /** The box's own look (border colour, opacity, width), first in the Box section (the owner's text E4). */
  readonly box: ReactNode;
  /** Whether the box draws a border to style: a typewriter's words stand on the page with none (`/BS /W 0`). */
  readonly bordered: boolean;
  readonly onChange: (text: AnnotationTextStyle) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const paddingId = useId();
  const [padding, setPadding] = useState(String(typed.padding ?? 0));
  const sendPadding = (): void => {
    const next = Number(padding);
    if (Number.isFinite(next) && next >= 0 && next <= MAX_TEXT_PADDING && next !== (typed.padding ?? 0)) onChange({ padding: next });
  };
  const family = familyOfTyped(typed);
  return (
    <>
    <TextSection
      // THE ONE FONT PICKER (the owner's D1 and K4), offering what the writer draws: the standard faces, and for a box
      // Monstera draws, every font of the computer's and Monstera's, embedded (K2, ADR-0228 Decision 3). Sent by name, so
      // the kernel draws the family and takes `/DA`'s class from it.
      font={{ list: fonts, builtIn: TEXT_BOX_FAMILIES, inDocument: NO_DOCUMENT_FONTS, unset: PROPERTIES_FONT }}
      lineSpacingBounds={{ min: MIN_TEXT_LINE_HEIGHT, max: MAX_TEXT_LINE_HEIGHT, step: 0.1 }}
      live={false}
      look={{
        family,
        size: typed.fontSize,
        bold: typed.bold === true,
        italic: typed.italic === true,
        underline: typed.underline === true,
        strike: typed.strike === true,
        colour: hexFromColour(typed.colour),
        align: typed.align ?? 'left',
        lineSpacing: typed.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT,
        spacing: Math.round((typed.spacing ?? 0) * typed.fontSize * 100) / 100,
      }}
      onAlign={(align) => {
        onChange({ align });
      }}
      onColour={(picked) => {
        const colour = picked === undefined ? undefined : colourFromHex(picked);
        if (colour !== undefined) onChange({ colour });
      }}
      onFamily={(picked) => {
        if (picked.toLowerCase() !== family.toLowerCase()) onChange({ family: picked });
      }}
      // A BOX HAS NO HIGHLIGHT, RISE OR SPACE AFTER: those rows are not in `BOX_ROWS`, so these are never called.
      onHighlight={() => undefined}
      onLineSpacing={(lineHeight) => {
        onChange({ lineHeight: lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT });
      }}
      onRise={() => undefined}
      onSize={(fontSize) => {
        onChange({ fontSize });
      }}
      onSpaceAfter={() => undefined}
      // CHARACTER SPACING IN POINTS, sent as the wire's fraction of the box's size by the one conversion (ADR-0228).
      onSpacing={(points) => {
        const next = spacingOf(points, typed.fontSize);
        if (next !== (typed.spacing ?? 0)) onChange({ spacing: next });
      }}
      onToggle={(style) => {
        onChange({ [style]: typed[style] !== true });
      }}
      ownColour={false}
      shows={typed.stylesUnavailable === true ? NO_ROWS : BOX_ROWS}
      sizeBounds={{ min: MIN_ANNOTATION_FONT, max: MAX_ANNOTATION_FONT, step: 0.5 }}
      spacingBound={spacingBoundOf(typed.fontSize)}
    />
    <div aria-label={i18n._(TEXT_PROPERTIES_BOX)} className="m-text-section" data-properties-box="" role="group">
      <h3 className="m-text-section__title">{i18n._(TEXT_PROPERTIES_BOX)}</h3>
      {box}
      {typed.stylesUnavailable === true ? null : (
        <>
          {/* THE BORDER'S STYLE (the owner's text E4), the kernel's `/BS`: solid or dashed, beside its colour and width. */}
          {bordered ? (
            <div className="m-properties__row">
              <span className="m-properties__label" aria-hidden="true">
                {i18n._(PROPERTIES_BOX_BORDER_STYLE)}
              </span>
              <SegmentedControl
                label={PROPERTIES_BOX_BORDER_STYLE}
                onChange={(borderStyle) => {
                  onChange({ borderStyle });
                }}
                options={BORDER_STYLE_OPTIONS}
                value={typed.dashed === true ? 'dashed' : 'solid'}
              />
            </div>
          ) : null}
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
    </>
  );
}

/** The blend's two choices, in v5-02's order. */
/** A text box's two border styles, the contract's list in its order (E4). */
const BORDER_STYLE_OPTIONS: readonly SegmentedOption<(typeof TEXT_BOX_BORDER_STYLES)[number]>[] = TEXT_BOX_BORDER_STYLES.map((style) => ({
  value: style,
  label: style === 'solid' ? PROPERTIES_BOX_BORDER_SOLID : PROPERTIES_BOX_BORDER_DASHED,
}));

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
