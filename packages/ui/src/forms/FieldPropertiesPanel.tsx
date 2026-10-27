import { useLingui } from '@lingui/react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import {
  type AnnotationColour,
  BORDER_STYLE_FIELD_KINDS,
  FIELD_ALIGNMENTS,
  FIELD_BORDER_STYLES,
  FIELD_CHECK_STYLES,
  type FieldRange,
  fieldRangeSchema,
  FIELD_CALCULATIONS,
  FIELD_FONTS,
  REAL_FONT_FIELD_KINDS,
  FIELD_VISIBILITIES,
  MAX_FIELD_LENGTH,
  MAX_FIELD_OPTION,
  FIELD_SEPARATORS,
  type FieldCalculation,
  type FieldChoice,
  type FieldFormat,
  type ButtonStep,
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
import { type ReactElement, type ReactNode, useEffect, useId, useState } from 'react';

import { ColourSwatches } from '../ColourChoice.js';
import { type KnownField, fieldNameProblemAmong } from '../annotations/fieldNameCheck.js';
import { colourFromHex, hexFromColour } from '../annotations/annotationStyle.js';
import { FIELD_COLOURS, FIELD_COLOUR_FALLBACK } from './fieldColours.js';
import { ButtonActionsRow } from './ButtonActionsRow.js';
import {
  FIELD_PROPS_ACTIONS,
  FIELD_PROPS_BORDER_BEVELED,
  FIELD_PROPS_BORDER_COLOUR,
  FIELD_PROPS_BORDER_DASHED,
  FIELD_PROPS_BORDER_INSET,
  FIELD_PROPS_BORDER_SOLID,
  FIELD_PROPS_BORDER_STYLE,
  FIELD_PROPS_BORDER_UNDERLINE,
  FIELD_PROPS_BORDER_WIDTH,
  FIELD_PROPS_CHECK_CHECK,
  FIELD_PROPS_CHECK_CIRCLE,
  FIELD_PROPS_CHECK_CROSS,
  FIELD_PROPS_CHECK_DIAMOND,
  FIELD_PROPS_CHECK_SQUARE,
  FIELD_PROPS_CHECK_STAR,
  FIELD_PROPS_CHECK_STYLE,
  FIELD_PROPS_VALIDATION,
  FIELD_PROPS_VALIDATION_LEAST,
  FIELD_PROPS_VALIDATION_MOST,
  FIELD_PROPS_VALIDATION_SCRIPT,
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
  FIELD_PROPS_EDITABLE,
  FIELD_PROPS_MULTI_SELECT,
  FIELD_PROPS_SPELL_CHECK,
  FIELD_PROPS_TEXT_COLOUR,
  FIELD_PROPS_TEXT_COLOUR_BLACK,
  FIELD_PROPS_NAME,
  FIELD_PROPS_NEGATIVE,
  FIELD_PROPS_NEGATIVE_MINUS,
  FIELD_PROPS_NEGATIVE_PARENS,
  FIELD_PROPS_NEGATIVE_RED,
  FIELD_PROPS_ONE_ONLY,
  FIELD_PROPS_OPTIONS,
  FIELD_PROPS_OPTION_ADD,
  FIELD_PROPS_OPTION_DOWN,
  FIELD_PROPS_OPTION_REMOVE,
  FIELD_PROPS_OPTION_SORT,
  FIELD_PROPS_OPTION_TEXT,
  FIELD_PROPS_OPTION_UP,
  FIELD_PROPS_OPTION_VALUE,
  FIELD_PROPS_OPTION_VALUE_SAME,
  FIELD_PROPS_OPTION_VALUES_HINT,
  FIELD_PROPS_OPTION_WORD,
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
  FIELD_PROPS_ALIGNMENT,
  FIELD_PROPS_ALIGNMENT_CENTRE,
  FIELD_PROPS_ALIGNMENT_LEFT,
  FIELD_PROPS_ALIGNMENT_RIGHT,
  FIELD_PROPS_BUTTON_LABEL,
  FIELD_PROPS_COMB,
  FIELD_PROPS_GROUP_NAME,
  FIELD_PROPS_MASKED,
  FIELD_PROPS_MAX_LENGTH,
  FIELD_PROPS_RADIO_VALUES,
  FIELD_PROPS_SECTION_APPEARANCE,
  FIELD_PROPS_SECTION_CALCULATE,
  FIELD_PROPS_SECTION_FORMAT,
  FIELD_PROPS_SECTION_GENERAL,
  FIELD_PROPS_SECTION_OPTIONS,
  FIELD_PROPS_VISIBILITY,
  FIELD_PROPS_VISIBILITY_HIDDEN,
  FIELD_PROPS_VISIBILITY_NO_PRINT,
  FIELD_PROPS_VISIBILITY_VISIBLE,
  PROPERTIES_CUSTOM_COLOUR,
} from '../messages/en.js';
import { BUILT_IN_ONLY, type DocumentFont, FontPicker, type FontList } from '../FontPicker.js';
import { pdfjsPageOf } from '../pageNumbering.js';
import { Button } from '../primitives/Button.js';
import { IconButton } from '../primitives/IconButton.js';
import type { CommandContext, CommandRegistry } from '../registries/commands.js';
import { useRunCommand } from '../registries/useRunCommand.js';
import { SURFACE_PLACEMENTS, useLiveContext } from '../commandAnswers.js';
import { propertiesModel } from '../surfaces/projections.js';

/**
 * The Properties tab for the form fields that are selected (ADR-0193), as a widely used PDF editor's is.
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
  /** Reads one push button's actions through `document.buttonActions` (ADR-0259). */
  readonly readActions: (handle: FormFieldHandle) => Promise<readonly ButtonStep[] | null>;
  /** How many pages the document has, for a button's actions that name one. */
  readonly pageCount: number;
  /** Changes every selected field by the members named. */
  readonly onEdit: (set: FormFieldProperties) => void;
  /**
   * The fonts this computer has and the document's own, for a kind Monstera draws in a real family (ADR-0229): offered
   * there and nowhere else, so the picker offers only what the writer draws.
   */
  readonly fonts: FontList;
  readonly documentFonts: readonly DocumentFont[];
  /** Where the foot's commands come from (`properties` placements), and what they run with. */
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
}

/** The date patterns offered. Each is in the grammar `fieldFormatSchema` writes, and they are data and never translated. */
const DATE_PATTERNS = ['m/d/yyyy', 'mm/dd/yyyy', 'dd/mm/yyyy', 'dd.mm.yyyy', 'yyyy-mm-dd', 'd mmmm yyyy', 'mmm d, yyyy'] as const;
const TIME_PATTERNS = ['HH:MM', 'h:MM tt', 'HH:MM:ss', 'h:MM:ss tt'] as const;

/** A kind Monstera does not draw in a real family lists no computer's fonts and none of the document's: its `/DA` names a standard font. */
const NO_OTHER_FONTS: FontList = BUILT_IN_ONLY;
const NO_DOCUMENT_FONTS: readonly DocumentFont[] = [];

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
  readActions,
  pageCount,
  onEdit,
  fonts,
  documentFonts,
  registry,
  context: asked,
}: FieldPropertiesPanelProps): ReactElement {
  // THE ANSWERS OF WHAT THE PROPERTIES TAB'S FOOT PLACES (ADR-0272).
  const context = useLiveContext(registry, asked, SURFACE_PLACEMENTS.properties);
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
  // A PRESS RUNS AGAINST THE CONTEXT AT THE PRESS (`useRunCommand`), so a button's handler keeps its identity.
  const run = useRunCommand(context);
  // THE FIELD'S LAST READ WHILE THE NEXT ONE IS TAKEN: a write moves the version, and a panel that emptied until the new
  // read arrived unmounted every control, so a picker opened in that moment closed under the person's pointer (the
  // forms walk's A8.4, 2026-10-16). Another field's read is never shown for this one.
  const props = answer?.key === key ? answer.props : undefined;
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
        // A NEW SET OF CONTROLS PER FIELD, so a draft never outlives the field it was typed for; a value that a later read
        // changes replaces that one row's draft (`useDraft`). Per read it was every control: a write of the tooltip
        // remounted the font picker too, and a picker opened as the write landed closed (the forms walk's A8.4).
        <Controls
          key={key}
          actionsRow={
            first === undefined ? null : (
              <ButtonActionsRow
                handle={first}
                known={known}
                onCommit={(buttonActions) => {
                  onEdit({ buttonActions });
                }}
                pageCount={pageCount}
                readActions={readActions}
                version={version}
              />
            )
          }
          documentFonts={documentFonts}
          fonts={fonts}
          known={known}
          onEdit={onEdit}
          props={props}
          single={single}
        />
      )}
      {single ? null : <p className="m-properties__meta">{i18n._(FIELD_PROPS_ONE_ONLY)}</p>}
      {foot.length === 0 ? null : (
        <div aria-label={i18n._(FIELD_PROPS_ACTIONS)} className="m-properties__foot" role="group">
          {foot.map((entry) => (
            <Button
              key={entry.command.id}
              label={entry.command.title}
              onClick={() => {
                run(entry.command);
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
  fonts,
  documentFonts,
  actionsRow,
}: {
  readonly props: FormFieldRead;
  readonly single: boolean;
  readonly known: readonly KnownField[];
  readonly onEdit: (set: FormFieldProperties) => void;
  readonly fonts: FontList;
  readonly documentFonts: readonly DocumentFont[];
  /** A push button's actions, drawn by the panel, which holds the handle and the version they are read at. */
  readonly actionsRow: ReactNode;
}): ReactElement {
  const { i18n } = useLingui();
  const kind = has(props.kind);
  /** Whether Monstera draws this kind's value in a real family: the contract's one list, which the writer also reads. */
  const real = (REAL_FONT_FIELD_KINDS as readonly string[]).includes(props.kind);
  const others = known.filter((field) => field.name !== props.name);
  const radio = props.kind === 'radio';
  return (
    <>
      <Section title={FIELD_PROPS_SECTION_GENERAL}>
        {single ? (
          <TextRow
            // A RADIO'S NAME IS ITS GROUP'S (the owner's C5): every option of the group carries it.
            label={radio ? FIELD_PROPS_GROUP_NAME : FIELD_PROPS_NAME}
            max={512}
            value={props.name}
            check={(typed) => fieldNameProblemAmong(typed, others)}
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
        <SelectRow
          label={FIELD_PROPS_VISIBILITY}
          value={props.visibility}
          options={FIELD_VISIBILITIES.map((each) => ({ value: each, label: i18n._(VISIBILITY_LABELS[each]) }))}
          onChange={(visibility) => {
            const chosen = FIELD_VISIBILITIES.find((each) => each === visibility);
            if (chosen !== undefined) onEdit({ visibility: chosen });
          }}
        />
        <CheckRow
          label={FIELD_PROPS_READ_ONLY}
          value={props.readOnly}
          onChange={(readOnly) => {
            onEdit({ readOnly });
          }}
        />
        <CheckRow
          label={FIELD_PROPS_REQUIRED}
          value={props.required}
          onChange={(required) => {
            onEdit({ required });
          }}
        />
      </Section>
      {kind.look ? (
        <Section title={FIELD_PROPS_SECTION_APPEARANCE}>
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
          {/* A BORDER STYLE where Monstera draws one (ADR-0230): a list box's and a push button's stay solid, so none is offered. */}
          {(BORDER_STYLE_FIELD_KINDS as readonly string[]).includes(props.kind) ? (
            <SelectRow
              label={FIELD_PROPS_BORDER_STYLE}
              value={props.borderStyle}
              options={FIELD_BORDER_STYLES.map((each) => ({ value: each, label: i18n._(BORDER_STYLE_LABELS[each]) }))}
              onChange={(style) => {
                const chosen = FIELD_BORDER_STYLES.find((each) => each === style);
                if (chosen !== undefined) onEdit({ borderStyle: chosen });
              }}
            />
          ) : null}
          <ColourRow
            label={FIELD_PROPS_FILL_COLOUR}
            colour={props.fillColour}
            onPick={(fillColour) => {
              onEdit({ fillColour });
            }}
          />
          {props.kind === 'checkbox' || props.kind === 'radio' ? (
            <SelectRow
              label={FIELD_PROPS_CHECK_STYLE}
              value={props.checkStyle}
              options={FIELD_CHECK_STYLES.map((each) => ({ value: each, label: i18n._(CHECK_STYLE_LABELS[each]) }))}
              onChange={(style) => {
                const chosen = FIELD_CHECK_STYLES.find((each) => each === style);
                if (chosen !== undefined) onEdit({ checkStyle: chosen });
              }}
            />
          ) : null}
          {kind.text ? (
            <>
              {/* THE ONE FONT PICKER (the owner's E2), offering what the writer draws (ADR-0229): a text field's and a
                  dropdown's value is drawn by Monstera's own appearance in any family, so they are offered this
                  computer's fonts and the document's; every other kind keeps the standard fonts its `/DA` writes, so a
                  family it cannot show is never offered and then dropped. */}
              <div className="m-properties__row">
                <span className="m-properties__label">{i18n._(FIELD_PROPS_FONT)}</span>
                <FontPicker
                  builtIn={FIELD_FONTS.map((font) => i18n._(FONT_LABELS[font]))}
                  inDocument={real ? documentFonts : NO_DOCUMENT_FONTS}
                  label={FIELD_PROPS_FONT}
                  list={real ? fonts : NO_OTHER_FONTS}
                  onPick={(family) => {
                    const chosen = FIELD_FONTS.find((font) => i18n._(FONT_LABELS[font]) === family);
                    // A STANDARD FONT takes a real family away; any other is the family, where this kind draws one.
                    if (chosen !== undefined) onEdit(real ? { font: chosen, family: null } : { font: chosen });
                    else if (real) onEdit({ family });
                  }}
                  unset={FONT_LABELS[props.font]}
                  value={props.family ?? i18n._(FONT_LABELS[props.font])}
                />
              </div>
              <NumberRow
                label={FIELD_PROPS_FONT_SIZE}
                min={0}
                max={200}
                value={props.fontSize}
                onCommit={(fontSize) => {
                  onEdit({ fontSize });
                }}
              />
              {/* THE TEXT'S COLOUR, its first choice *Black*, which is what a field naming none is drawn in. */}
              <ColourRow
                autoLabel={FIELD_PROPS_TEXT_COLOUR_BLACK}
                label={FIELD_PROPS_TEXT_COLOUR}
                colour={props.textColour}
                onPick={(textColour) => {
                  onEdit({ textColour: textColour ?? [0, 0, 0] });
                }}
              />
            </>
          ) : null}
        </Section>
      ) : null}
      <Section title={FIELD_PROPS_SECTION_OPTIONS}>
        {props.kind === 'text' ? (
          <>
            <SelectRow
              label={FIELD_PROPS_ALIGNMENT}
              value={props.alignment}
              options={FIELD_ALIGNMENTS.map((each) => ({ value: each, label: i18n._(ALIGNMENT_LABELS[each]) }))}
              onChange={(alignment) => {
                const chosen = FIELD_ALIGNMENTS.find((each) => each === alignment);
                if (chosen !== undefined) onEdit({ alignment: chosen });
              }}
            />
            <NumberRow
              label={FIELD_PROPS_MAX_LENGTH}
              min={0}
              max={MAX_FIELD_LENGTH}
              value={props.maxLength ?? 0}
              onCommit={(maxLength) => {
                onEdit({ maxLength: maxLength === 0 ? null : Math.round(maxLength) });
              }}
            />
            <CheckRow
              label={FIELD_PROPS_COMB}
              value={props.comb}
              onChange={(comb) => {
                onEdit({ comb });
              }}
            />
            <CheckRow
              label={FIELD_PROPS_MULTILINE}
              value={props.multiline}
              onChange={(multiline) => {
                onEdit({ multiline });
              }}
            />
            <CheckRow
              label={FIELD_PROPS_MASKED}
              value={props.masked}
              onChange={(masked) => {
                onEdit({ masked });
              }}
            />
            {/* VALIDATE (ADR-0230): a number range, checked where the field is filled. A script this application did not
                write is kept and said, never replaced by an empty range. */}
            {props.customValidation ? (
              <p className="m-properties__meta">{i18n._(FIELD_PROPS_VALIDATION_SCRIPT)}</p>
            ) : (
              <RangeRow
                range={props.validation}
                onCommit={(validation) => {
                  onEdit({ validation });
                }}
              />
            )}
          </>
        ) : null}
        {props.kind === 'dropdown' ? (
          <CheckRow
            label={FIELD_PROPS_EDITABLE}
            value={props.editable}
            onChange={(editable) => {
              onEdit({ editable });
            }}
          />
        ) : null}
        {props.kind === 'listbox' ? (
          <CheckRow
            label={FIELD_PROPS_MULTI_SELECT}
            value={props.multiSelect}
            onChange={(multiSelect) => {
              onEdit({ multiSelect });
            }}
          />
        ) : null}
        {props.kind === 'text' || props.kind === 'dropdown' ? (
          <CheckRow
            label={FIELD_PROPS_SPELL_CHECK}
            value={props.spellCheck}
            onChange={(spellCheck) => {
              onEdit({ spellCheck });
            }}
          />
        ) : null}
        {props.kind === 'button' ? (
          <TextRow
            label={FIELD_PROPS_BUTTON_LABEL}
            max={MAX_FIELD_OPTION}
            value={props.buttonLabel ?? ''}
            onCommit={(buttonLabel) => {
              if (buttonLabel.trim() !== '') onEdit({ buttonLabel });
            }}
          />
        ) : null}
        {/* WHAT THE BUTTON DOES (ADR-0259), one button at a time: its actions are one field's, as its choices are. */}
        {props.kind === 'button' && single ? actionsRow : null}
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
        {single && kind.choices ? (
          <OptionsRow
            options={props.options}
            withValues={!radio}
            label={radio ? FIELD_PROPS_RADIO_VALUES : FIELD_PROPS_OPTIONS}
            onCommit={(options) => {
              onEdit({ options });
            }}
          />
        ) : null}
      </Section>
      {kind.value ? (
        <Section title={FIELD_PROPS_SECTION_FORMAT}>
          <FormatRows
            format={props.format}
            custom={props.customFormat}
            onChange={(format) => {
              onEdit({ format });
            }}
          />
        </Section>
      ) : null}
      {single && props.kind === 'text' ? (
        <Section title={FIELD_PROPS_SECTION_CALCULATE}>
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
        </Section>
      ) : null}
    </>
  );
}

/**
 * One of the panel's folding sections (the owner's E1): a native disclosure, open at first, so the keyboard and a screen
 * reader treat it as one with no code of its own.
 */
function Section({ title, children }: { readonly title: MessageKey; readonly children: ReactNode }): ReactElement {
  const { i18n } = useLingui();
  return (
    <details className="m-properties__section" open>
      <summary className="m-properties__section-title">{i18n._(title)}</summary>
      {children}
    </details>
  );
}

const VISIBILITY_LABELS: Readonly<Record<(typeof FIELD_VISIBILITIES)[number], MessageKey>> = {
  visible: FIELD_PROPS_VISIBILITY_VISIBLE,
  hidden: FIELD_PROPS_VISIBILITY_HIDDEN,
  'no-print': FIELD_PROPS_VISIBILITY_NO_PRINT,
};

const BORDER_STYLE_LABELS: Readonly<Record<(typeof FIELD_BORDER_STYLES)[number], MessageKey>> = {
  solid: FIELD_PROPS_BORDER_SOLID,
  dashed: FIELD_PROPS_BORDER_DASHED,
  beveled: FIELD_PROPS_BORDER_BEVELED,
  inset: FIELD_PROPS_BORDER_INSET,
  underline: FIELD_PROPS_BORDER_UNDERLINE,
};

const CHECK_STYLE_LABELS: Readonly<Record<(typeof FIELD_CHECK_STYLES)[number], MessageKey>> = {
  check: FIELD_PROPS_CHECK_CHECK,
  circle: FIELD_PROPS_CHECK_CIRCLE,
  cross: FIELD_PROPS_CHECK_CROSS,
  diamond: FIELD_PROPS_CHECK_DIAMOND,
  square: FIELD_PROPS_CHECK_SQUARE,
  star: FIELD_PROPS_CHECK_STAR,
};

const ALIGNMENT_LABELS: Readonly<Record<(typeof FIELD_ALIGNMENTS)[number], MessageKey>> = {
  left: FIELD_PROPS_ALIGNMENT_LEFT,
  centre: FIELD_PROPS_ALIGNMENT_CENTRE,
  right: FIELD_PROPS_ALIGNMENT_RIGHT,
};

/** A text box that sends when focus leaves it changed, and says why a value is refused instead of sending it. */
/**
 * A row's draft of `value`, which a new read of a DIFFERENT value replaces (React's form for state that follows a prop,
 * as OptionsRow takes it): a later read that changed this property puts the document's value back, and one that changed
 * another property leaves what is being typed here alone.
 */
function useDraft<T>(value: T): readonly [T, (next: T) => void] {
  const [draft, setDraft] = useState(value);
  const [read, setRead] = useState(value);
  if (!Object.is(read, value)) {
    setRead(value);
    setDraft(value);
  }
  return [draft, setDraft];
}

/** Whether two lists of choices say the same, choice by choice: value and label in order. */
function sameChoices(a: readonly FieldChoice[], b: readonly FieldChoice[]): boolean {
  return (
    a.length === b.length &&
    a.every((choice, at) => {
      const other = b[at];
      return other !== undefined && choiceValueOf(choice) === choiceValueOf(other) && choiceLabelOf(choice) === choiceLabelOf(other);
    })
  );
}

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
  const [draft, setDraft] = useDraft(value);
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
        className="m-properties__select"
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

/**
 * Validate's two ends, the least and the most, either left empty for open (ADR-0230 Decision 5). Sends when focus leaves
 * either and the pair is a range the contract takes, the least not past the most; both empty takes the range away.
 */
function RangeRow({
  range,
  onCommit,
}: {
  readonly range: FieldRange | null;
  readonly onCommit: (range: FieldRange | null) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const leastId = useId();
  const mostId = useId();
  const [least, setLeast] = useDraft(range?.min === null || range === null ? '' : String(range.min));
  const [most, setMost] = useDraft(range?.max === null || range === null ? '' : String(range.max));
  const commit = (): void => {
    const end = (text: string): number | null | undefined => {
      if (text.trim() === '') return null;
      const number = Number(text);
      return Number.isFinite(number) ? number : undefined;
    };
    const min = end(least);
    const max = end(most);
    if (min === undefined || max === undefined) return;
    if (min === null && max === null) {
      if (range !== null) onCommit(null);
      return;
    }
    const parsed = fieldRangeSchema.safeParse({ min, max });
    if (parsed.success && (parsed.data.min !== range?.min || parsed.data.max !== range.max)) onCommit(parsed.data);
  };
  return (
    <div className="m-properties__row" role="group" aria-label={i18n._(FIELD_PROPS_VALIDATION)}>
      <span className="m-properties__label">{i18n._(FIELD_PROPS_VALIDATION)}</span>
      <div className="m-properties__row m-properties__row--inline">
        <label className="m-properties__label" htmlFor={leastId}>
          {i18n._(FIELD_PROPS_VALIDATION_LEAST)}
        </label>
        <input
          className="m-properties__number"
          id={leastId}
          onBlur={commit}
          onChange={(event) => {
            setLeast(event.target.value);
          }}
          step="any"
          type="number"
          value={least}
        />
      </div>
      <div className="m-properties__row m-properties__row--inline">
        <label className="m-properties__label" htmlFor={mostId}>
          {i18n._(FIELD_PROPS_VALIDATION_MOST)}
        </label>
        <input
          className="m-properties__number"
          id={mostId}
          onBlur={commit}
          onChange={(event) => {
            setMost(event.target.value);
          }}
          step="any"
          type="number"
          value={most}
        />
      </div>
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
  const [draft, setDraft] = useDraft(String(value));
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

/**
 * A colour that may be none: the swatches, with *None* first — or, where the property cannot be none and a field naming
 * none is drawn in a reader's own colour, that colour's word (`autoLabel`, *Black* for text).
 */
function ColourRow({
  label,
  colour,
  onPick,
  autoLabel = FIELD_PROPS_COLOUR_NONE,
}: {
  readonly label: MessageKey;
  readonly colour: AnnotationColour | null;
  readonly onPick: (colour: AnnotationColour | null) => void;
  readonly autoLabel?: MessageKey;
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
        autoLabel={autoLabel}
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

/** One choice as the editor holds it: the text a person reads, and what the document stores, empty for the text itself. */
export interface ChoiceRow {
  readonly text: string;
  readonly value: string;
}

/** A field's choices as editor rows: a plain choice stores its own text, so its value box starts empty. */
export function rowsOfChoices(options: readonly FieldChoice[]): ChoiceRow[] {
  return options.map((choice) => ({ text: choiceLabelOf(choice), value: typeof choice === 'string' ? '' : choice.value }));
}

/**
 * What the rows say, as the choices an edit sends, or `null` while they cannot be sent: no choice, a choice with no text,
 * or two with the same stored value. A row whose value is empty stores its text, so a document that never listed the
 * two apart sees nothing change.
 */
export function choicesOfRows(rows: readonly ChoiceRow[], withValues: boolean): readonly FieldChoice[] | null {
  const trimmed = rows.map((row) => ({ text: row.text.trim(), value: withValues ? row.value.trim() : '' }));
  if (trimmed.length === 0 || trimmed.some((row) => row.text === '')) return null;
  const choices = trimmed.map((row) => choiceOf(row.value === '' ? row.text : row.value, row.text));
  return new Set(choices.map(choiceValueOf)).size === choices.length ? choices : null;
}

/** A choice name nobody has given yet, for *Add*: *Choice 4* after three. */
function nextChoiceText(rows: readonly ChoiceRow[], word: string): string {
  const taken = new Set(rows.map((row) => row.text.trim()));
  for (let at = rows.length + 1; ; at += 1) {
    const candidate = `${word} ${String(at)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The choices as a list (the owner's C6): each row its text and, for a dropdown or a list, what the document stores for
 * it, with *Move up*, *Move down* and *Remove* on the row, and *Add* and *Sort* under the list. A change to a box is
 * sent on leaving it; a button sends at once. Nothing that cannot be sent is (`choicesOfRows`), and the row stays as the
 * person left it to be put right.
 *
 * A radio group has no text apart from its value, so its rows have the one box.
 */
function OptionsRow({
  options,
  withValues,
  label,
  onCommit,
}: {
  readonly options: readonly FieldChoice[];
  readonly withValues: boolean;
  /** What the list is called: a list's choices, or a radio group's values. */
  readonly label: MessageKey;
  readonly onCommit: (options: readonly FieldChoice[]) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const labelId = useId();
  const [rows, setRows] = useState<ChoiceRow[]>(() => rowsOfChoices(options));
  // WHAT THE DOCUMENT HOLDS AS FAR AS THIS EDITOR KNOWS: the field's choices as read, then each list it sent since. A
  // change compared with the read alone would send nothing when a person put back what was read after other changes.
  const [held, setHeld] = useState(options);
  const [read, setRead] = useState(options);
  // BY THE CHOICES, not the array: every read of the field is a new array, and a read that another property's write
  // brought would otherwise put back rows being typed.
  if (!sameChoices(read, options)) {
    // A NEW READ of the field, taken while rendering (React's form for state that follows a prop).
    setRead(options);
    setHeld(options);
    setRows(rowsOfChoices(options));
  }
  const send = (next: readonly ChoiceRow[]): void => {
    const sendable = choicesOfRows(next, withValues);
    if (sendable === null) return;
    const unchanged =
      sendable.length === held.length &&
      sendable.every((choice, at) => {
        const was = held[at];
        return was !== undefined && choiceValueOf(choice) === choiceValueOf(was) && choiceLabelOf(choice) === choiceLabelOf(was);
      });
    if (unchanged) return;
    setHeld(sendable);
    onCommit(sendable);
  };
  const change = (next: ChoiceRow[], now: boolean): void => {
    setRows(next);
    if (now) send(next);
  };
  const edit = (at: number, part: Partial<ChoiceRow>): void => {
    change(rows.map((row, index) => (index === at ? { ...row, ...part } : row)), false);
  };
  const move = (at: number, by: -1 | 1): void => {
    const next = [...rows];
    const [taken] = next.splice(at, 1);
    if (taken === undefined) return;
    next.splice(at + by, 0, taken);
    change(next, true);
  };
  return (
    <div aria-labelledby={labelId} className="m-properties__row m-field-options" role="group">
      <span className="m-properties__label" id={labelId}>
        {i18n._(label)}
      </span>
      <ol className="m-field-options__list">
        {rows.map((row, at) => (
          <li className="m-field-options__row" key={at}>
            <input
              aria-label={i18n._(FIELD_PROPS_OPTION_TEXT, { number: at + 1 })}
              className="m-field-options__text"
              onBlur={() => {
                send(rows);
              }}
              onChange={(event) => {
                edit(at, { text: event.target.value });
              }}
              type="text"
              value={row.text}
            />
            {withValues ? (
              <input
                aria-label={i18n._(FIELD_PROPS_OPTION_VALUE, { number: at + 1 })}
                className="m-field-options__value"
                onBlur={() => {
                  send(rows);
                }}
                onChange={(event) => {
                  edit(at, { value: event.target.value });
                }}
                placeholder={i18n._(FIELD_PROPS_OPTION_VALUE_SAME)}
                type="text"
                value={row.value}
              />
            ) : null}
            <IconButton
              disabled={at === 0}
              icon={ArrowUp}
              label={FIELD_PROPS_OPTION_UP}
              onClick={() => {
                move(at, -1);
              }}
              size="dense"
              values={{ number: at + 1 }}
            />
            <IconButton
              disabled={at === rows.length - 1}
              icon={ArrowDown}
              label={FIELD_PROPS_OPTION_DOWN}
              onClick={() => {
                move(at, 1);
              }}
              size="dense"
              values={{ number: at + 1 }}
            />
            <IconButton
              disabled={rows.length === 1}
              icon={Trash2}
              label={FIELD_PROPS_OPTION_REMOVE}
              onClick={() => {
                change(
                  rows.filter((_row, index) => index !== at),
                  true,
                );
              }}
              size="dense"
              values={{ number: at + 1 }}
            />
          </li>
        ))}
      </ol>
      <div className="m-field-options__actions">
        <Button
          label={FIELD_PROPS_OPTION_ADD}
          onClick={() => {
            change([...rows, { text: nextChoiceText(rows, i18n._(FIELD_PROPS_OPTION_WORD)), value: '' }], true);
          }}
        />
        <Button
          label={FIELD_PROPS_OPTION_SORT}
          onClick={() => {
            change(
              [...rows].sort((a, b) => a.text.localeCompare(b.text)),
              true,
            );
          }}
        />
      </div>
      {withValues ? <p className="m-properties__meta">{i18n._(FIELD_PROPS_OPTION_VALUES_HINT)}</p> : null}
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
  const [draft, setDraft] = useDraft(calculation?.fields.join('\n') ?? '');
  // THE OPERATION CHOSEN, kept here until there are names to send it with: a calculation reads at least one field, so an
  // operation picked first is shown as picked and sent when the names are given, and never dropped.
  const [operation, setOperation] = useDraft<FieldCalculation['operation'] | 'none'>(calculation?.operation ?? 'none');
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
