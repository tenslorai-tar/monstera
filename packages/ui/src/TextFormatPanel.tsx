import { useLingui } from '@lingui/react';
import { MAX_CHARACTER_SPACING } from '@monstera/contract';
import { type ReactElement, useId, useState, useSyncExternalStore } from 'react';

import { ColourSwatches } from './ColourChoice.js';
import { FORMAT_ENTRIES } from './commands/textFormatCommands.js';
import type { DocumentFont, FontList } from './FontPicker.js';
import {
  TEXT_BLOCK_REMOVE,
  TEXT_FORMAT_CHARACTER_SPACING,
  TEXT_FORMAT_CHARACTER_SPACING_BOUND,
  TEXT_FORMAT_COLOUR_AUTO,
  TEXT_FORMAT_COLOUR_CUSTOM,
  TEXT_FORMAT_HIGHLIGHT,
  TEXT_FORMAT_HIGHLIGHT_CUSTOM,
  TEXT_FORMAT_HIGHLIGHT_NONE,
  TEXT_FORMAT_SPACE_AFTER,
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
import { HIGHLIGHT_COLOUR_FALLBACK, HIGHLIGHT_COLOURS, TEXT_COLOUR_FALLBACK, TEXT_COLOURS } from './textColours.js';
import {
  KEEPS_EDITOR,
  editorRevision,
  finishOpenEditor,
  formatOpenEditor,
  leavesEditor,
  onEditorChange,
  openEditorState,
  openParagraphState,
  refocusOpenEditor,
  removeOpenBlock,
} from './textEditorControl.js';
import { spacingOf } from './textFormatting.js';
import { TextFontSize } from './TextFontSize.js';

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
 * ## Character spacing is typed in points and sent as a fraction of the size
 *
 * The wire bounds it to {@link MAX_CHARACTER_SPACING} of the words' size either way (ADR-0228, measured), so the field is
 * in the points a person knows, converted at the size of the words at the selection, and its note says the bound at
 * that size. A value past it is held to the bound rather than refused.
 */

const SPACINGS = [
  { value: 1, title: TEXT_FORMAT_SPACING_SINGLE },
  { value: 1.5, title: TEXT_FORMAT_SPACING_ONE_HALF },
  { value: 2, title: TEXT_FORMAT_SPACING_DOUBLE },
] as const;

/** The verbs that change words, and the ones that change a paragraph, by the table's ids. */
const TEXT_VERBS = new Set(['bold', 'italic', 'underline', 'strike', 'superscript', 'subscript'].map((name) => `text.format.${name}`));

/** A colour as `#rrggbb`. */
function hexOf(colour: { readonly r: number; readonly g: number; readonly b: number } | undefined): string | undefined {
  return colour === undefined ? undefined : `#${[colour.r, colour.g, colour.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** A `#rrggbb` as the contract's colour, or `undefined` for anything else. */
function rgbOf(hex: string): { r: number; g: number; b: number } | undefined {
  const found = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (found === null) return undefined;
  return { r: parseInt(found[1] ?? '0', 16), g: parseInt(found[2] ?? '0', 16), b: parseInt(found[3] ?? '0', 16) };
}

export interface TextFormatPanelProps {
  /** The fonts this computer has, as `app.fontFamilies` answered, or `undefined` while it is asked. */
  readonly fonts: FontList;
  /** Every font the document names (`document.fonts`): none while it is read, and none in a build that cannot read it. */
  readonly documentFonts: readonly DocumentFont[];
}

export function TextFormatPanel({ fonts, documentFonts }: TextFormatPanelProps): ReactElement {
  const { _, i18n } = useLingui();
  // RE-READ ON EVERY CHANGE of the selection or the formatting, since the state is the editor's and not a snapshot.
  useSyncExternalStore(onEditorChange, editorRevision);
  const state = openEditorState();
  const spacingId = useId();
  const letterId = useId();
  const letterNoteId = useId();
  const afterId = useId();
  const [letters, setLetters] = useState<string | undefined>(undefined);
  const [after, setAfter] = useState<string | undefined>(undefined);
  const hex = hexOf(state?.colour);
  // THE SIZE THE SPACING IS A FRACTION OF: the words' at the selection, or the field cannot convert and stays empty.
  const wordSize = state?.size;
  const lettersShown =
    letters ?? (state?.spacing === undefined || wordSize === undefined ? '' : String(Math.round(state.spacing * wordSize * 100) / 100));
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
        {/* THE FONT AND SIZE the ribbon's Format group draws too: one component (ADR-0228 Decision 5, B3a). */}
        <TextFontSize documentFonts={documentFonts} fonts={fonts} place="panel" />
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
        {/* THE COLOUR BEHIND THE WORDS (ADR-0228): a mark's highlight, none being the first choice. */}
        <div aria-label={_(TEXT_FORMAT_HIGHLIGHT)} className="m-text-properties__row" role="group">
          <span>{_(TEXT_FORMAT_HIGHLIGHT)}</span>
          <ColourSwatches
            auto={state?.highlight === undefined}
            autoLabel={TEXT_FORMAT_HIGHLIGHT_NONE}
            current={hexOf(state?.highlight)}
            customLabel={TEXT_FORMAT_HIGHLIGHT_CUSTOM}
            fallback={HIGHLIGHT_COLOUR_FALLBACK}
            layout="start"
            onPick={(picked) => {
              const rgb = picked === undefined ? undefined : rgbOf(picked);
              formatOpenEditor({ kind: 'set', change: { highlight: rgb ?? null } });
            }}
            presets={HIGHLIGHT_COLOURS}
          />
        </div>
        <label className="m-text-properties__row" htmlFor={letterId}>
          <span>{_(TEXT_FORMAT_CHARACTER_SPACING)}</span>
          <input
            aria-describedby={letterNoteId}
            className="m-text-properties__size"
            disabled={wordSize === undefined}
            id={letterId}
            onBlur={() => {
              setLetters(undefined);
            }}
            onChange={(event) => {
              setLetters(event.target.value);
              const points = Number(event.target.value);
              if (event.target.value === '' || !Number.isFinite(points) || wordSize === undefined) return;
              formatOpenEditor({ kind: 'set', change: { spacing: points === 0 ? null : spacingOf(points, wordSize) } });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                refocusOpenEditor();
              }
            }}
            step={0.1}
            type="number"
            value={lettersShown}
          />
        </label>
        <p className="m-properties__meta" id={letterNoteId}>
          {wordSize === undefined
            ? null
            : i18n._(TEXT_FORMAT_CHARACTER_SPACING_BOUND, { points: String(Math.round(MAX_CHARACTER_SPACING * wordSize * 10) / 10) })}
        </p>
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
        {/* SPACE AFTER THE PARAGRAPH (ADR-0228), in points; empty or nought takes the person's setting off. */}
        <label className="m-text-properties__row" htmlFor={afterId}>
          <span>{_(TEXT_FORMAT_SPACE_AFTER)}</span>
          <input
            className="m-text-properties__size"
            id={afterId}
            max={500}
            min={0}
            onBlur={() => {
              setAfter(undefined);
            }}
            onChange={(event) => {
              setAfter(event.target.value);
              const points = Number(event.target.value);
              if (event.target.value === '' || points === 0) formatOpenEditor({ kind: 'space-after', points: null });
              else if (Number.isFinite(points) && points > 0 && points <= 500) formatOpenEditor({ kind: 'space-after', points });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                refocusOpenEditor();
              }
            }}
            step={1}
            type="number"
            value={after ?? String(openParagraphState()?.spaceAfter ?? '')}
          />
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
