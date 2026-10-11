import { useLingui } from '@lingui/react';
import { type ReactElement, useId, useState, useSyncExternalStore } from 'react';

import { ColourSwatches } from './ColourChoice.js';
import { FORMAT_ENTRIES } from './commands/textFormatCommands.js';
import { type DocumentFont, FontPicker, type FontList } from './FontPicker.js';
import {
  TEXT_BLOCK_REMOVE,
  TEXT_FORMAT_COLOUR_AUTO,
  TEXT_FORMAT_COLOUR_CUSTOM,
  TEXT_FORMAT_FAMILY,
  TEXT_FORMAT_FAMILY_RUN,
  TEXT_FORMAT_SIZE,
  TEXT_FORMAT_SPACING,
  TEXT_FORMAT_SPACING_DOUBLE,
  TEXT_FORMAT_SPACING_ONE_HALF,
  TEXT_FORMAT_SPACING_SINGLE,
  TEXT_PROPERTIES_BOX,
  TEXT_PROPERTIES_HEADING,
  TEXT_PROPERTIES_HINT,
  TEXT_PROPERTIES_LABEL,
  TEXT_PROPERTIES_PARAGRAPH,
  TEXT_PROPERTIES_TEXT,
} from './messages/en.js';
import { IconButton } from './primitives/IconButton.js';
import { ICONS } from './primitives/icons.js';
import { TEXT_COLOUR_FALLBACK, TEXT_COLOURS } from './textColours.js';
import {
  KEEPS_EDITOR,
  editorRevision,
  finishOpenEditor,
  formatOpenEditor,
  leavesEditor,
  onEditorChange,
  openEditorState,
  refocusOpenEditor,
  removeOpenBlock,
} from './textEditorControl.js';

/**
 * The Properties panel while words are being edited in place (the owner's K11 and C1 to C5): the formatting that floated
 * over the page in a bar, in the panel's sections, where it covers no words.
 *
 * ## It keeps the editor open
 *
 * The section is marked {@link KEEPS_EDITOR}: the editor's frame does not write and close when the focus moves into it,
 * and the section finishes the editor when the focus leaves both (`leavesEditor`), so a size typed here and a click on the
 * page after it write once, as they did with the bar. A press on a button keeps the focus in the words (the mouse-down is
 * refused); a field takes it for as long as it is used.
 *
 * ## The verbs are the commands' table
 *
 * Bold, italic and the rest are {@link FORMAT_ENTRIES}, the same table the ribbon's Format group and the palette project,
 * through the one {@link formatOpenEditor} (B3a). The values — font, size, colour, spacing — are this section's own, as
 * the status bar's zoom is the bar's (ADR-0067).
 *
 * ## What is not here, and why
 *
 * Strikethrough, highlight, justified paragraphs and space after a paragraph are not offered: the mark set and the
 * paragraph settings the editing engine writes carry none of them (`blockMarkSetSchema`, `PARAGRAPH_ALIGNMENTS`), and a
 * control that changed nothing on the page is a defect, not a placeholder.
 */

const SPACINGS = [
  { value: 1, title: TEXT_FORMAT_SPACING_SINGLE },
  { value: 1.5, title: TEXT_FORMAT_SPACING_ONE_HALF },
  { value: 2, title: TEXT_FORMAT_SPACING_DOUBLE },
] as const;

/** The standard fonts the in-place editor sets, through the resolver's stand-ins: Symbol and ZapfDingbats have none. */
const EDITOR_BUILT_IN = ['Helvetica', 'Times', 'Courier'] as const;

/** The verbs that change words, and the ones that change a paragraph, by the table's ids. */
const TEXT_VERBS = new Set(['bold', 'italic', 'underline', 'superscript', 'subscript'].map((name) => `text.format.${name}`));

/** A `#rrggbb` as the contract's colour, or `undefined` for anything else. */
function rgbOf(hex: string): { r: number; g: number; b: number } | undefined {
  const found = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (found === null) return undefined;
  return { r: parseInt(found[1] ?? '0', 16), g: parseInt(found[2] ?? '0', 16), b: parseInt(found[3] ?? '0', 16) };
}

export interface TextFormatPanelProps {
  /** The fonts this computer has, as `app.fontFamilies` answered, or `undefined` while it is asked. */
  readonly fonts: FontList;
  /** The fonts the document carries, for the picker's first group. */
  readonly inDocument: readonly DocumentFont[];
}

export function TextFormatPanel({ fonts, inDocument }: TextFormatPanelProps): ReactElement {
  const { _ } = useLingui();
  // RE-READ ON EVERY CHANGE of the selection or the formatting, since the state is the editor's and not a snapshot.
  useSyncExternalStore(onEditorChange, editorRevision);
  const state = openEditorState();
  const sizeId = useId();
  const spacingId = useId();
  const [size, setSize] = useState<string | undefined>(undefined);
  const shown = size ?? (state?.size === undefined ? '' : String(Math.round(state.size * 10) / 10));
  const hex =
    state?.colour === undefined
      ? undefined
      : `#${[state.colour.r, state.colour.g, state.colour.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  const verb = (entry: (typeof FORMAT_ENTRIES)[number]): ReactElement => (
    <IconButton
      icon={ICONS[entry.icon]}
      key={entry.id}
      label={entry.title}
      onClick={() => {
        formatOpenEditor(entry.action);
      }}
      pressed={state === undefined || entry.on === undefined ? undefined : entry.on(state)}
      size="control"
    />
  );
  return (
    <section
      aria-label={_(TEXT_PROPERTIES_LABEL)}
      className="m-properties m-text-properties"
      data-text-properties=""
      {...{ [KEEPS_EDITOR]: '' }}
      // LEFT FOR NEITHER THE WORDS NOR THIS SECTION: the edit is finished, as a click elsewhere finishes it from the words.
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        if (leavesEditor(event.relatedTarget)) finishOpenEditor();
      }}
      // A PRESS THAT IS NOT IN A FIELD KEEPS THE FOCUS IN THE WORDS, so a button formats them without ending the edit.
      onMouseDown={(event) => {
        const target = event.target as HTMLElement;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target.closest('[data-font-picker]') !== null)) {
          event.preventDefault();
        }
      }}
    >
      <header className="m-properties__head">
        <h2 className="m-properties__title">{_(TEXT_PROPERTIES_HEADING)}</h2>
        <p className="m-properties__meta">{_(TEXT_PROPERTIES_HINT)}</p>
      </header>

      <div aria-label={_(TEXT_PROPERTIES_TEXT)} className="m-text-properties__section" role="group">
        <h3 className="m-text-properties__title">{_(TEXT_PROPERTIES_TEXT)}</h3>
        <FontPicker
          builtIn={EDITOR_BUILT_IN}
          inDocument={inDocument}
          label={TEXT_FORMAT_FAMILY}
          list={fonts}
          onPick={(family) => {
            formatOpenEditor({ kind: 'set', change: { family } });
            refocusOpenEditor();
          }}
          unset={TEXT_FORMAT_FAMILY_RUN}
          value={state?.family}
        />
        <label className="m-text-properties__row" htmlFor={sizeId}>
          <span>{_(TEXT_FORMAT_SIZE)}</span>
          <input
            className="m-text-properties__size"
            id={sizeId}
            max={400}
            min={1}
            onBlur={() => {
              setSize(undefined);
            }}
            onChange={(event) => {
              setSize(event.target.value);
              const points = Number(event.target.value);
              if (Number.isFinite(points) && points >= 1 && points <= 400) formatOpenEditor({ kind: 'set', change: { size: points } });
            }}
            onKeyDown={(event) => {
              // ENTER RETURNS TO THE WORDS, with the size set.
              if (event.key === 'Enter') {
                event.preventDefault();
                refocusOpenEditor();
              }
            }}
            step={0.5}
            type="number"
            value={shown}
          />
        </label>
        <div className="m-text-properties__verbs">{FORMAT_ENTRIES.filter((entry) => TEXT_VERBS.has(entry.id)).map(verb)}</div>
        <ColourSwatches
          auto={state?.colour === undefined}
          autoLabel={TEXT_FORMAT_COLOUR_AUTO}
          current={hex}
          customLabel={TEXT_FORMAT_COLOUR_CUSTOM}
          fallback={TEXT_COLOUR_FALLBACK}
          layout="start"
          onPick={(picked) => {
            const rgb = picked === undefined ? undefined : rgbOf(picked);
            formatOpenEditor({ kind: 'set', change: { colour: rgb ?? null } });
          }}
          presets={TEXT_COLOURS}
        />
      </div>

      <div aria-label={_(TEXT_PROPERTIES_PARAGRAPH)} className="m-text-properties__section" role="group">
        <h3 className="m-text-properties__title">{_(TEXT_PROPERTIES_PARAGRAPH)}</h3>
        <div className="m-text-properties__verbs">{FORMAT_ENTRIES.filter((entry) => !TEXT_VERBS.has(entry.id)).map(verb)}</div>
        <label className="m-text-properties__row" htmlFor={spacingId}>
          <span>{_(TEXT_FORMAT_SPACING)}</span>
          <select
            className="m-text-properties__select"
            id={spacingId}
            onChange={(event) => {
              formatOpenEditor({ kind: 'spacing', lineSpacing: event.target.value === '' ? null : Number(event.target.value) });
              refocusOpenEditor();
            }}
            value=""
          >
            <option value="">{_(TEXT_FORMAT_SPACING)}</option>
            {SPACINGS.map((entry) => (
              <option key={entry.value} value={String(entry.value)}>
                {_(entry.title)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div aria-label={_(TEXT_PROPERTIES_BOX)} className="m-text-properties__section" role="group">
        <h3 className="m-text-properties__title">{_(TEXT_PROPERTIES_BOX)}</h3>
        <IconButton
          icon={ICONS.Trash2}
          label={TEXT_BLOCK_REMOVE}
          onClick={() => {
            removeOpenBlock();
          }}
          size="control"
        />
      </div>
    </section>
  );
}
