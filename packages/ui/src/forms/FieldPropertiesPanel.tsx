import { useLingui } from '@lingui/react';
import {
  type AnnotationColour,
  FIELD_CALCULATIONS,
  FIELD_FONTS,
  FIELD_SEPARATORS,
  type FieldCalculation,
  type FieldChoice,
  type FieldFormat,
  type FormFieldHandle,
  type FormFieldProperties,
  type FormFieldRead,
  MAX_FIELD_DEFAULT,
  MAX_FIELD_TOOLTIP,
  choiceLabelOf,
  choiceOf,
  choiceValueOf,
} from '@monstera/contract';
import type { DocVersion, MessageKey } from '@monstera/shared';
import { type ReactElement, useEffect, useId, useState } from 'react';

import { ColourSwatches } from '../ColourChoice.js';
import { type KnownField, fieldNameProblemAmong } from '../annotations/fieldNameCheck.js';
import { colourFromHex, hexFromColour } from '../annotations/annotationStyle.js';
import { FIELD_COLOURS, FIELD_COLOUR_FALLBACK } from './fieldColours.js';
import {
  FIELD_PROPS_ACTIONS,
  FIELD_PROPS_BORDER_COLOUR,
  FIELD_PROPS_BORDER_WIDTH,
  FIELD_PROPS_CALCULATION,
  FIELD_PROPS_CALCULATION_AVERAGE,
  FIELD_PROPS_CALCULATION_CUSTOM,
  FIELD_PROPS_CALCULATION_FIELDS,
  FIELD_PROPS_CALCULATION_MAX,
  FIELD_PROPS_CALCULATION_MIN,
  FIELD_PROPS_CALCULATION_NONE,
  FIELD_PROPS_CALCULATION_ORDER,
  FIELD_PROPS_CALCULATION_PRODUCT,
  FIELD_PROPS_CALCULATION_SUM,
  FIELD_PROPS_COLOUR_NONE,
  FIELD_PROPS_CURRENCY,
  FIELD_PROPS_CURRENCY_BEFORE,
  FIELD_PROPS_DATE_PATTERN,
  FIELD_PROPS_DECIMALS,
  FIELD_PROPS_DEFAULT,
  FIELD_PROPS_FILL_COLOUR,
  FIELD_PROPS_FIRST_SHOWN,
  FIELD_PROPS_FONT,
  FIELD_PROPS_FONT_COURIER,
  FIELD_PROPS_FONT_HELVETICA,
  FIELD_PROPS_FONT_SIZE,
  FIELD_PROPS_FONT_TIMES,
  FIELD_PROPS_FORMAT,
  FIELD_PROPS_FORMAT_CUSTOM,
  FIELD_PROPS_FORMAT_DATE,
  FIELD_PROPS_FORMAT_NONE,
  FIELD_PROPS_FORMAT_NUMBER,
  FIELD_PROPS_FORMAT_PERCENT,
  FIELD_PROPS_FORMAT_TIME,
  FIELD_PROPS_HEADING_MANY,
  FIELD_PROPS_HEADING_ONE,
  FIELD_PROPS_LABEL,
  FIELD_PROPS_MULTILINE,
  FIELD_PROPS_NAME,
  FIELD_PROPS_NEGATIVE,
  FIELD_PROPS_NEGATIVE_MINUS,
  FIELD_PROPS_NEGATIVE_PARENS,
  FIELD_PROPS_NEGATIVE_RED,
  FIELD_PROPS_ONE_ONLY,
  FIELD_PROPS_OPTIONS,
  FIELD_PROPS_OPTIONS_HINT,
  FIELD_PROPS_OPTION_VALUES,
  FIELD_PROPS_OPTION_VALUES_HINT,
  FIELD_PROPS_READ_ONLY,
  FIELD_PROPS_REQUIRED,
  FIELD_PROPS_SEPARATORS,
  FIELD_PROPS_SEPARATORS_APOSTROPHE_DOT,
  FIELD_PROPS_SEPARATORS_COMMA_DOT,
  FIELD_PROPS_SEPARATORS_DOT_COMMA,
  FIELD_PROPS_SEPARATORS_NONE_COMMA,
  FIELD_PROPS_SEPARATORS_NONE_DOT,
  FIELD_PROPS_TIME_PATTERN,
  FIELD_PROPS_TOOLTIP,
  FIELD_PROPS_UNREADABLE,
  FIELD_PROPS_WHERE,
  PROPERTIES_CUSTOM_COLOUR,
} from '../messages/en.js';
import { pdfjsPageOf } from '../pageNumbering.js';
import { Button } from '../primitives/Button.js';
import type { CommandContext, CommandRegistry } from '../registries/commands.js';
import { propertiesModel } from '../surfaces/projections.js';

/**
 * The Properties tab for the form fields that are selected (ADR-0193), as PDF-XChange Editor's is.
 *
 * ## It shows the FIRST selected field, and a change reaches ALL of them
 *
 * A control averaged over several fields would be a value nothing in the document holds, so the pane reads one field and
 * says so. Each control sends ONE member and nothing else, so changing the border colour of three fields of three fonts
 * changes their border colour and leaves their fonts. The name, the choices and the calculation belong to one field and
 * are offered only for a single selection.
 *
 * ## Only what the field kind has
 *
 * A tick box has no font and a text field has no choices. A control for a property the kind does not have would be one
 * that sends a change the writer then ignores, which is a control that does nothing.
 *
 * ## Values commit when a person is done with them
 *
 * A text box sends on leaving it, a choice or a tick on the click, so a name typed letter by letter is one command and
 * one undo step. A name another field holds is said in words before anything is sent (`fieldNameProblemAmong`).
 */
export interface FieldPropertiesPanelProps {
  /** The selected fields in the order they were chosen, named as every field is named. */
  readonly selected: readonly FormFieldHandle[];
  /** The version the handles were made at: a read for another version is not this selection's. */
  readonly version: DocVersion;
  /** Every field the document has, for the name check. */
  readonly known: readonly KnownField[];
  /** Reads the first handles' properties through the one channel. */
  readonly read: (handles: readonly FormFieldHandle[]) => Promise<readonly (FormFieldRead | null)[]>;
  /** Changes every selected field by the members named. */
  readonly onEdit: (set: FormFieldProperties) => void;
  /** Where the foot's commands come from (`properties` placements), and what they run with. */
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
}

/** The date patterns offered. Each is in the grammar `fieldFormatSchema` writes, and they are data and never translated. */
const DATE_PATTERNS = ['m/d/yyyy', 'mm/dd/yyyy', 'dd/mm/yyyy', 'dd.mm.yyyy', 'yyyy-mm-dd', 'd mmmm yyyy', 'mmm d, yyyy'] as const;
const TIME_PATTERNS = ['HH:MM', 'h:MM tt', 'HH:MM:ss', 'h:MM:ss tt'] as const;

const FONT_LABELS: Readonly<Record<(typeof FIELD_FONTS)[number], MessageKey>> = {
  helvetica: FIELD_PROPS_FONT_HELVETICA,
  times: FIELD_PROPS_FONT_TIMES,
  courier: FIELD_PROPS_FONT_COURIER,
};

const SEPARATOR_LABELS: Readonly<Record<(typeof FIELD_SEPARATORS)[number], MessageKey>> = {
  'comma-dot': FIELD_PROPS_SEPARATORS_COMMA_DOT,
  'none-dot': FIELD_PROPS_SEPARATORS_NONE_DOT,
  'dot-comma': FIELD_PROPS_SEPARATORS_DOT_COMMA,
  'none-comma': FIELD_PROPS_SEPARATORS_NONE_COMMA,
  'apostrophe-dot': FIELD_PROPS_SEPARATORS_APOSTROPHE_DOT,
};

const OPERATION_LABELS: Readonly<Record<(typeof FIELD_CALCULATIONS)[number], MessageKey>> = {
  sum: FIELD_PROPS_CALCULATION_SUM,
  product: FIELD_PROPS_CALCULATION_PRODUCT,
  average: FIELD_PROPS_CALCULATION_AVERAGE,
  min: FIELD_PROPS_CALCULATION_MIN,
  max: FIELD_PROPS_CALCULATION_MAX,
};

type Kind = FormFieldRead['kind'];

/** What each kind of field has, so a control is drawn only where its change would be written. */
function has(kind: Kind): {
  readonly text: boolean;
  readonly choices: boolean;
  readonly look: boolean;
  readonly value: boolean;
} {
  return {
    text: kind === 'text' || kind === 'dropdown' || kind === 'listbox',
    choices: kind === 'dropdown' || kind === 'listbox' || kind === 'radio',
    look: kind !== 'signature' && kind !== 'other',
    value: kind === 'text' || kind === 'dropdown' || kind === 'listbox',
  };
}

export function FieldPropertiesPanel({
  selected,
  version,
  known,
  read,
  onEdit,
  registry,
  context,
}: FieldPropertiesPanelProps): ReactElement {
  const { i18n } = useLingui();
  const first = selected[0];
  const [answer, setAnswer] = useState<
    { readonly version: DocVersion; readonly key: string; readonly props: FormFieldRead | null } | undefined
  >(undefined);
  const key = first === undefined ? '' : `${String(first.page)}:${String(first.index)}:${first.name}`;
  useEffect(() => {
    if (first === undefined) return undefined;
    let live = true;
    void read([first]).then((answers) => {
      if (live) setAnswer({ version, key, props: answers[0] ?? null });
    });
    return () => {
      live = false;
    };
  }, [first, key, read, version]);

  const foot = propertiesModel(registry, context);
  const props = answer?.version === version && answer.key === key ? answer.props : undefined;
  const single = selected.length === 1;

  return (
    <section aria-label={i18n._(FIELD_PROPS_LABEL)} className="m-properties" data-field-properties="">
      <header className="m-properties__head">
        <h2 className="m-properties__title">
          {single ? i18n._(FIELD_PROPS_HEADING_ONE) : i18n._(FIELD_PROPS_HEADING_MANY, { count: selected.length })}
        </h2>
        {first === undefined ? null : (
          <p className="m-properties__meta">{i18n._(FIELD_PROPS_WHERE, { page: pdfjsPageOf(first.page) })}</p>
        )}
        {single ? null : <p className="m-properties__meta">{i18n._(FIELD_PROPS_FIRST_SHOWN)}</p>}
      </header>
      {props === undefined ? null : props === null ? (
        <p className="m-properties__meta">{i18n._(FIELD_PROPS_UNREADABLE)}</p>
      ) : (
        // A NEW SET OF CONTROLS PER FIELD AND PER READ, so a draft never outlives the field it was typed for and a value
        // that arrives after a change replaces the draft that produced it.
        <Controls key={`${key}:${JSON.stringify(props)}`} props={props} single={single} known={known} onEdit={onEdit} />
      )}
      {single ? null : <p className="m-properties__meta">{i18n._(FIELD_PROPS_ONE_ONLY)}</p>}
      {foot.length === 0 ? null : (
        <div aria-label={i18n._(FIELD_PROPS_ACTIONS)} className="m-properties__foot" role="group">
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

function Controls({
  props,
  single,
  known,
  onEdit,
}: {
  readonly props: FormFieldRead;
  readonly single: boolean;
  readonly known: readonly KnownField[];
  readonly onEdit: (set: FormFieldProperties) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const kind = has(props.kind);
  const others = known.filter((field) => field.name !== props.name);
  return (
    <>
      {single ? (
        <TextRow
          label={FIELD_PROPS_NAME}
          max={512}
          value={props.name}
          check={(typed) => fieldNameProblemAmong(typed, others, false)}
          onCommit={(name) => {
            onEdit({ name: name.trim() });
          }}
        />
      ) : null}
      <TextRow
        label={FIELD_PROPS_TOOLTIP}
        max={MAX_FIELD_TOOLTIP}
        value={props.tooltip ?? ''}
        onCommit={(tooltip) => {
          onEdit({ tooltip: tooltip === '' ? null : tooltip });
        }}
      />
      <CheckRow
        label={FIELD_PROPS_REQUIRED}
        value={props.required}
        onChange={(required) => {
          onEdit({ required });
        }}
      />
      <CheckRow
        label={FIELD_PROPS_READ_ONLY}
        value={props.readOnly}
        onChange={(readOnly) => {
          onEdit({ readOnly });
        }}
      />
      {kind.value ? (
        <TextRow
          label={FIELD_PROPS_DEFAULT}
          max={single ? MAX_FIELD_DEFAULT : 512}
          value={props.defaultValue ?? ''}
          onCommit={(defaultValue) => {
            onEdit({ defaultValue: defaultValue === '' ? null : defaultValue });
          }}
        />
      ) : null}
      {kind.text ? (
        <>
          <SelectRow
            label={FIELD_PROPS_FONT}
            value={props.font}
            options={FIELD_FONTS.map((font) => ({ value: font, label: i18n._(FONT_LABELS[font]) }))}
            onChange={(font) => {
              const chosen = FIELD_FONTS.find((each) => each === font);
              if (chosen !== undefined) onEdit({ font: chosen });
            }}
          />
          <NumberRow
            label={FIELD_PROPS_FONT_SIZE}
            min={0}
            max={200}
            value={props.fontSize}
            onCommit={(fontSize) => {
              onEdit({ fontSize });
            }}
          />
        </>
      ) : null}
      {kind.look ? (
        <>
          <ColourRow
            label={FIELD_PROPS_BORDER_COLOUR}
            colour={props.borderColour}
            onPick={(borderColour) => {
              onEdit({ borderColour });
            }}
          />
          <NumberRow
            label={FIELD_PROPS_BORDER_WIDTH}
            min={0}
            max={12}
            value={props.borderWidth}
            onCommit={(borderWidth) => {
              onEdit({ borderWidth });
            }}
          />
          <ColourRow
            label={FIELD_PROPS_FILL_COLOUR}
            colour={props.fillColour}
            onPick={(fillColour) => {
              onEdit({ fillColour });
            }}
          />
        </>
      ) : null}
      {props.kind === 'text' ? (
        <CheckRow
          label={FIELD_PROPS_MULTILINE}
          value={props.multiline}
          onChange={(multiline) => {
            onEdit({ multiline });
          }}
        />
      ) : null}
      {single && kind.choices ? (
        <OptionsRow
          options={props.options}
          withValues={props.kind !== 'radio'}
          onCommit={(options) => {
            onEdit({ options });
          }}
        />
      ) : null}
      {kind.value ? (
        <FormatRows
          format={props.format}
          custom={props.customFormat}
          onChange={(format) => {
            onEdit({ format });
          }}
        />
      ) : null}
      {single && props.kind === 'text' ? (
        <CalculationRows
          calculation={props.calculation}
          custom={props.customCalculation}
          position={props.calculationPosition}
          onChange={(calculation) => {
            onEdit({ calculation });
          }}
          onPosition={(calculationPosition) => {
            onEdit({ calculationPosition });
          }}
        />
      ) : null}
    </>
  );
}

/** A text box that sends when focus leaves it changed, and says why a value is refused instead of sending it. */
function TextRow({
  label,
  value,
  max,
  check,
  onCommit,
}: {
  readonly label: MessageKey;
  readonly value: string;
  readonly max: number;
  readonly check?: ((typed: string) => MessageKey | undefined) | undefined;
  readonly onCommit: (value: string) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const id = useId();
  const [draft, setDraft] = useState(value);
  const problem = check?.(draft);
  return (
    <div className="m-properties__row">
      <label className="m-properties__label" htmlFor={id}>
        {i18n._(label)}
      </label>
      <input
        aria-invalid={problem !== undefined}
        className="m-properties__comment"
        id={id}
        maxLength={max}
        onBlur={() => {
          if (draft !== value && problem === undefined) onCommit(draft);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        type="text"
        value={draft}
      />
      {problem === undefined ? null : (
        <p className="m-properties__meta" role="alert">
          {i18n._(problem)}
        </p>
      )}
    </div>
  );
}

function CheckRow({
  label,
  value,
  onChange,
}: {
  readonly label: MessageKey;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
}): ReactElement {
  const { i18n } = useLingui();
  return (
    <label className="m-properties__check">
      <input
        checked={value}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        type="checkbox"
      />
      <span>{i18n._(label)}</span>
    </label>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: MessageKey;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const id = useId();
  return (
    <div className="m-properties__row m-properties__row--inline">
      <label className="m-properties__label" htmlFor={id}>
        {i18n._(label)}
      </label>
      <select
        className="m-properties__number"
        id={id}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A number that sends when focus leaves it changed and in range, so a half-typed figure is never sent. */
function NumberRow({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  readonly label: MessageKey;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onCommit: (value: number) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  return (
    <div className="m-properties__row m-properties__row--inline">
      <label className="m-properties__label" htmlFor={id}>
        {i18n._(label)}
      </label>
      <input
        className="m-properties__number"
        id={id}
        max={max}
        min={min}
        onBlur={() => {
          const number = Number(draft);
          if (draft.trim() !== '' && Number.isFinite(number) && number >= min && number <= max && number !== value) onCommit(number);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        step="any"
        type="number"
        value={draft}
      />
    </div>
  );
}

/** A colour that may be none: the swatches, with *None* first. */
function ColourRow({
  label,
  colour,
  onPick,
}: {
  readonly label: MessageKey;
  readonly colour: AnnotationColour | null;
  readonly onPick: (colour: AnnotationColour | null) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const labelId = useId();
  return (
    <div aria-labelledby={labelId} className="m-properties__row" role="group">
      <span className="m-properties__label" id={labelId}>
        {i18n._(label)}
      </span>
      <ColourSwatches
        presets={FIELD_COLOURS}
        current={colour === null ? undefined : hexFromColour(colour)}
        auto={colour === null}
        autoLabel={FIELD_PROPS_COLOUR_NONE}
        customLabel={PROPERTIES_CUSTOM_COLOUR}
        fallback={FIELD_COLOUR_FALLBACK}
        onPick={(hex) => {
          if (hex === undefined) {
            onPick(null);
            return;
          }
          const picked = colourFromHex(hex);
          if (picked !== undefined) onPick(picked);
        }}
      />
    </div>
  );
}

/** The lines of a box, each trimmed, without the empty ones that trail. */
function linesOf(draft: string): string[] {
  const lines = draft.split('\n').map((line) => line.trim());
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * What the two boxes say, as the choices an edit sends, or `null` while they cannot be sent: a choice with no text, two
 * with the same stored value, or more stored values than choices. The values are lines aligned with the texts, and a
 * line left empty stores the text itself, so a document that never listed the two apart sees nothing change.
 */
export function choicesOfDrafts(texts: string, values: string | null): readonly FieldChoice[] | null {
  const shown = linesOf(texts);
  if (shown.length === 0 || shown.some((line) => line === '')) return null;
  const stored = values === null ? [] : linesOf(values);
  if (stored.length > shown.length) return null;
  const choices = shown.map((text, at) => choiceOf(stored[at] === undefined || stored[at] === '' ? text : stored[at], text));
  return new Set(choices.map(choiceValueOf)).size === choices.length ? choices : null;
}

/**
 * The choices: the text a person reads on each line, and for a dropdown or a list a second box with what the document
 * stores for the same line. Sent on leaving a box when they changed and can be sent.
 *
 * A radio group has no text apart from its value, so it has the one box.
 */
function OptionsRow({
  options,
  withValues,
  onCommit,
}: {
  readonly options: readonly FieldChoice[];
  readonly withValues: boolean;
  readonly onCommit: (options: readonly FieldChoice[]) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const textId = useId();
  const valueId = useId();
  const [texts, setTexts] = useState(options.map(choiceLabelOf).join('\n'));
  // A line is empty where the text is the value, so a list without pairs shows an empty box and says so.
  const [values, setValues] = useState(options.map((choice) => (typeof choice === 'string' ? '' : choice.value)).join('\n'));
  const sendable = choicesOfDrafts(texts, withValues ? values : null);
  const unchanged =
    sendable !== null &&
    sendable.length === options.length &&
    sendable.every((choice, at) => {
      const was = options[at];
      return was !== undefined && choiceValueOf(choice) === choiceValueOf(was) && choiceLabelOf(choice) === choiceLabelOf(was);
    });
  const commit = (): void => {
    if (sendable !== null && !unchanged) onCommit(sendable);
  };
  return (
    <div className="m-properties__row">
      <label className="m-properties__label" htmlFor={textId}>
        {i18n._(FIELD_PROPS_OPTIONS)}
      </label>
      <textarea
        className="m-properties__comment"
        id={textId}
        onBlur={commit}
        onChange={(event) => {
          setTexts(event.target.value);
        }}
        rows={4}
        value={texts}
      />
      <p className="m-properties__meta">{i18n._(FIELD_PROPS_OPTIONS_HINT)}</p>
      {withValues ? (
        <>
          <label className="m-properties__label" htmlFor={valueId}>
            {i18n._(FIELD_PROPS_OPTION_VALUES)}
          </label>
          <textarea
            className="m-properties__comment"
            id={valueId}
            onBlur={commit}
            onChange={(event) => {
              setValues(event.target.value);
            }}
            rows={4}
            value={values}
          />
          <p className="m-properties__meta">{i18n._(FIELD_PROPS_OPTION_VALUES_HINT)}</p>
        </>
      ) : null}
    </div>
  );
}

type FormatKind = FieldFormat['kind'] | 'none';

/** The number format a kind starts from when it is first chosen. */
function startingFormat(kind: FieldFormat['kind']): FieldFormat {
  switch (kind) {
    case 'number':
      return { kind: 'number', decimals: 2, separators: 'comma-dot', negative: 'minus', currencyBefore: true };
    case 'percent':
      return { kind: 'percent', decimals: 0, separators: 'comma-dot' };
    case 'date':
      return { kind: 'date', pattern: 'dd/mm/yyyy' };
    case 'time':
      return { kind: 'time', pattern: 'HH:MM' };
  }
}

/** A field's format: a kind, and what that kind asks. Each change sends the whole format, since it is one value. */
function FormatRows({
  format,
  custom,
  onChange,
}: {
  readonly format: FieldFormat | null;
  readonly custom: boolean;
  readonly onChange: (format: FieldFormat | null) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const kind: FormatKind = format?.kind ?? 'none';
  const labels: Readonly<Record<FormatKind, MessageKey>> = {
    none: FIELD_PROPS_FORMAT_NONE,
    number: FIELD_PROPS_FORMAT_NUMBER,
    percent: FIELD_PROPS_FORMAT_PERCENT,
    date: FIELD_PROPS_FORMAT_DATE,
    time: FIELD_PROPS_FORMAT_TIME,
  };
  return (
    <>
      <SelectRow
        label={FIELD_PROPS_FORMAT}
        value={kind}
        options={(['none', 'number', 'percent', 'date', 'time'] as const).map((each) => ({
          value: each,
          label: i18n._(labels[each]),
        }))}
        onChange={(chosen) => {
          if (chosen === 'none') onChange(null);
          else if (chosen === 'number' || chosen === 'percent' || chosen === 'date' || chosen === 'time') {
            onChange(startingFormat(chosen));
          }
        }}
      />
      {custom && format === null ? <p className="m-properties__meta">{i18n._(FIELD_PROPS_FORMAT_CUSTOM)}</p> : null}
      {format?.kind === 'number' || format?.kind === 'percent' ? (
        <>
          <NumberRow
            label={FIELD_PROPS_DECIMALS}
            min={0}
            max={12}
            value={format.decimals}
            onCommit={(decimals) => {
              onChange({ ...format, decimals: Math.round(decimals) });
            }}
          />
          <SelectRow
            label={FIELD_PROPS_SEPARATORS}
            value={format.separators}
            options={FIELD_SEPARATORS.map((each) => ({ value: each, label: i18n._(SEPARATOR_LABELS[each]) }))}
            onChange={(chosen) => {
              const separators = FIELD_SEPARATORS.find((each) => each === chosen);
              if (separators !== undefined) onChange({ ...format, separators });
            }}
          />
        </>
      ) : null}
      {format?.kind === 'number' ? (
        <>
          <SelectRow
            label={FIELD_PROPS_NEGATIVE}
            value={format.negative}
            options={[
              { value: 'minus', label: i18n._(FIELD_PROPS_NEGATIVE_MINUS) },
              { value: 'red', label: i18n._(FIELD_PROPS_NEGATIVE_RED) },
              { value: 'parens', label: i18n._(FIELD_PROPS_NEGATIVE_PARENS) },
            ]}
            onChange={(chosen) => {
              if (chosen === 'minus' || chosen === 'red' || chosen === 'parens') onChange({ ...format, negative: chosen });
            }}
          />
          <TextRow
            label={FIELD_PROPS_CURRENCY}
            max={8}
            value={format.currency ?? ''}
            onCommit={(currency) => {
              const { currency: _dropped, ...rest } = format;
              onChange(currency === '' ? rest : { ...rest, currency });
            }}
          />
          <CheckRow
            label={FIELD_PROPS_CURRENCY_BEFORE}
            value={format.currencyBefore ?? true}
            onChange={(currencyBefore) => {
              onChange({ ...format, currencyBefore });
            }}
          />
        </>
      ) : null}
      {format?.kind === 'date' ? (
        <SelectRow
          label={FIELD_PROPS_DATE_PATTERN}
          value={format.pattern}
          options={[...new Set<string>([format.pattern, ...DATE_PATTERNS])].map((pattern) => ({ value: pattern, label: pattern }))}
          onChange={(pattern) => {
            onChange({ kind: 'date', pattern });
          }}
        />
      ) : null}
      {format?.kind === 'time' ? (
        <SelectRow
          label={FIELD_PROPS_TIME_PATTERN}
          value={format.pattern}
          options={TIME_PATTERNS.map((pattern) => ({ value: pattern, label: pattern }))}
          onChange={(chosen) => {
            const pattern = TIME_PATTERNS.find((each) => each === chosen);
            if (pattern !== undefined) onChange({ kind: 'time', pattern });
          }}
        />
      ) : null}
    </>
  );
}

/** A calculation: an operation over named fields, and where it falls in the form's calculation order. */
function CalculationRows({
  calculation,
  custom,
  position,
  onChange,
  onPosition,
}: {
  readonly calculation: FieldCalculation | null;
  readonly custom: boolean;
  readonly position: number | null;
  readonly onChange: (calculation: FieldCalculation | null) => void;
  readonly onPosition: (position: number) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const id = useId();
  const [draft, setDraft] = useState(calculation?.fields.join('\n') ?? '');
  // THE OPERATION CHOSEN, kept here until there are names to send it with: a calculation reads at least one field, so an
  // operation picked first is shown as picked and sent when the names are given, and never dropped.
  const [operation, setOperation] = useState<FieldCalculation['operation'] | 'none'>(calculation?.operation ?? 'none');
  const names = draft
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return (
    <>
      <SelectRow
        label={FIELD_PROPS_CALCULATION}
        value={operation}
        options={[
          { value: 'none', label: i18n._(FIELD_PROPS_CALCULATION_NONE) },
          ...FIELD_CALCULATIONS.map((each) => ({ value: each, label: i18n._(OPERATION_LABELS[each]) })),
        ]}
        onChange={(chosen) => {
          if (chosen === 'none') {
            setOperation('none');
            if (calculation !== null) onChange(null);
            return;
          }
          const picked = FIELD_CALCULATIONS.find((each) => each === chosen);
          if (picked === undefined) return;
          setOperation(picked);
          if (names.length > 0) onChange({ operation: picked, fields: names });
        }}
      />
      {custom && calculation === null ? <p className="m-properties__meta">{i18n._(FIELD_PROPS_CALCULATION_CUSTOM)}</p> : null}
      <div className="m-properties__row">
        <label className="m-properties__label" htmlFor={id}>
          {i18n._(FIELD_PROPS_CALCULATION_FIELDS)}
        </label>
        <textarea
          className="m-properties__comment"
          id={id}
          onBlur={() => {
            const joined = names.join('\n');
            if (operation !== 'none' && names.length > 0 && joined !== (calculation?.fields.join('\n') ?? '')) {
              onChange({ operation, fields: names });
            }
          }}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          rows={3}
          value={draft}
        />
      </div>
      {position === null ? null : (
        <NumberRow
          label={FIELD_PROPS_CALCULATION_ORDER}
          min={1}
          max={4096}
          value={position + 1}
          onCommit={(order) => {
            onPosition(Math.round(order) - 1);
          }}
        />
      )}
    </>
  );
}
