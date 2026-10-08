import { useLingui } from '@lingui/react';
import { useState, useSyncExternalStore, type ReactElement } from 'react';

import { ColourSwatches } from './ColourChoice.js';
import { FORMAT_ENTRIES } from './commands/textFormatCommands.js';
import {
  TEXT_BLOCK_REMOVE,
  TEXT_FORMAT_BAR_LABEL,
  TEXT_FORMAT_COLOUR_AUTO,
  TEXT_FORMAT_COLOUR_CUSTOM,
  TEXT_FORMAT_FAMILY,
  TEXT_FORMAT_FAMILY_ARIAL,
  TEXT_FORMAT_FAMILY_CALIBRI,
  TEXT_FORMAT_FAMILY_CAMBRIA,
  TEXT_FORMAT_FAMILY_COURIER,
  TEXT_FORMAT_FAMILY_RUN,
  TEXT_FORMAT_FAMILY_TIMES,
  TEXT_FORMAT_SIZE,
  TEXT_FORMAT_SPACING,
  TEXT_FORMAT_SPACING_DOUBLE,
  TEXT_FORMAT_SPACING_ONE_HALF,
  TEXT_FORMAT_SPACING_SINGLE,
} from './messages/en.js';
import { IconButton } from './primitives/IconButton.js';
import { ICONS } from './primitives/icons.js';
import { TEXT_COLOUR_FALLBACK, TEXT_COLOURS } from './textColours.js';
import { editorRevision, formatOpenEditor, onEditorChange, openEditorState, removeOpenBlock } from './textEditorControl.js';

/**
 * The in-place editor's bar: the formatting a command cannot be, because it takes a value
 * ([ADR-0180](../../../docs/DECISIONS/0180-formatting-is-marks-over-a-blocks-words-and-a-block-is-moved-resized-and-added-by-its-own-commands.md)
 * Decisions 1 to 3). The verbs (bold, italic, alignment and the rest) are the same commands the ribbon and the palette
 * offer, through the same table, and sit here so the words being formatted are next to the controls.
 *
 * ## It is not a surface of its own
 *
 * It draws what the editor holds and sends what a person chose through {@link formatOpenEditor}. A press on a button
 * leaves the focus in the editor (the mouse-down is refused), and the bar's own value controls take it for as long as
 * they are used: the editor's frame treats a focus that moves between the editor and the bar as no focus lost.
 */

/** The families offered, by the names a person knows; the resolver maps each to a face it has (`fontResolver`'s stand-ins). */
const FAMILIES = [
  { family: 'Arial', title: TEXT_FORMAT_FAMILY_ARIAL },
  { family: 'Calibri', title: TEXT_FORMAT_FAMILY_CALIBRI },
  { family: 'Cambria', title: TEXT_FORMAT_FAMILY_CAMBRIA },
  { family: 'Times New Roman', title: TEXT_FORMAT_FAMILY_TIMES },
  { family: 'Courier New', title: TEXT_FORMAT_FAMILY_COURIER },
] as const;

const SPACINGS = [
  { value: 1, title: TEXT_FORMAT_SPACING_SINGLE },
  { value: 1.5, title: TEXT_FORMAT_SPACING_ONE_HALF },
  { value: 2, title: TEXT_FORMAT_SPACING_DOUBLE },
] as const;

/** A `#rrggbb` as the contract's colour, or `undefined` for anything else. */
function rgbOf(hex: string): { r: number; g: number; b: number } | undefined {
  const found = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (found === null) return undefined;
  return { r: parseInt(found[1] ?? '0', 16), g: parseInt(found[2] ?? '0', 16), b: parseInt(found[3] ?? '0', 16) };
}

export function TextFormatBar(): ReactElement {
  const { _ } = useLingui();
  // RE-READ ON EVERY CHANGE of the selection or the formatting, since the state is the editor's and not a snapshot.
  useSyncExternalStore(onEditorChange, editorRevision);
  const state = openEditorState();
  const [size, setSize] = useState<string | undefined>(undefined);
  const shown = size ?? (state?.size === undefined ? '' : String(Math.round(state.size * 10) / 10));
  const hex = state?.colour === undefined ? undefined : `#${[state.colour.r, state.colour.g, state.colour.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  return (
    <div
      aria-label={_(TEXT_FORMAT_BAR_LABEL)}
      className="m-text-format-bar"
      data-text-format-bar=""
      // A PRESS ON A BUTTON KEEPS THE FOCUS IN THE EDITOR; a field takes it, which is what a field is for.
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) event.preventDefault();
      }}
      role="toolbar"
    >
      <select
        aria-label={_(TEXT_FORMAT_FAMILY)}
        className="m-text-format-bar__select"
        onChange={(event) => {
          formatOpenEditor({ kind: 'set', change: { family: event.target.value === '' ? null : event.target.value } });
        }}
        value={state?.family ?? ''}
      >
        <option value="">{_(TEXT_FORMAT_FAMILY_RUN)}</option>
        {FAMILIES.map((entry) => (
          <option key={entry.family} value={entry.family}>
            {_(entry.title)}
          </option>
        ))}
      </select>
      <input
        aria-label={_(TEXT_FORMAT_SIZE)}
        className="m-text-format-bar__size"
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
        step={0.5}
        type="number"
        value={shown}
      />
      {FORMAT_ENTRIES.map((entry) => (
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
      ))}
      <select
        aria-label={_(TEXT_FORMAT_SPACING)}
        className="m-text-format-bar__select"
        onChange={(event) => {
          formatOpenEditor({ kind: 'spacing', lineSpacing: event.target.value === '' ? null : Number(event.target.value) });
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
      <IconButton
        icon={ICONS.Trash2}
        label={TEXT_BLOCK_REMOVE}
        onClick={() => {
          removeOpenBlock();
        }}
        size="control"
      />
    </div>
  );
}
