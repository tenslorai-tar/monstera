import { useLingui } from '@lingui/react';
import { MAX_ANNOTATION_BORDER, MAX_ANNOTATION_FONT, MIN_ANNOTATION_FONT } from '@monstera/contract';
import type { ReactElement } from 'react';

import {
  EDITING_COLOUR_TITLE,
  EDITING_FONT_SIZE_TITLE,
  EDITING_LINE_WIDTH_TITLE,
  EDITING_OPACITY_TITLE,
  STYLE_COLOUR_AUTO,
  STYLE_COLOUR_CHOOSE,
  STYLE_PANEL_LABEL,
} from './messages/en.js';
import { hexFromColour } from './annotations/annotationStyle.js';
import { STROKE } from './annotations/shapeTools.js';
import type { SettingsStore } from './settingsStore.js';

/**
 * What the colour input shows before a person has chosen anything.
 *
 * **The shape tools' own red, converted rather than retyped.** A hex literal
 * here is refused by `monstera/no-raw-hex` and the refusal is right: this is not
 * a design token, it is another module's constant, and a copy would drift the
 * day that constant moved. Black — what an empty colour input answers — would
 * be worse still: a person who has just said *I want to choose* has not chosen
 * black.
 */
const STARTING_COLOUR = hexFromColour(STROKE);
import {
  ANNOTATION_COLOUR_SETTING,
  ANNOTATION_FONT_SIZE_SETTING,
  ANNOTATION_LINE_WIDTH_SETTING,
  ANNOTATION_OPACITY_SETTING,
} from './settings/editing.js';
import { useSetting } from './useSetting.js';

/**
 * The style controls — what a new annotation is drawn in.
 *
 * ## It writes SETTINGS, and that is what makes it not a second wiring place
 *
 * Nothing here reaches a tool. The four values live in the settings registry,
 * the tools read them through `annotationTools`' deps, and this panel is one
 * more reader-and-writer of the same store — the shape the rulers' and the grid's
 * toggle commands already have. (This named a `SettingsPanel` until 2026-09-12;
 * no such component has existed in this repository.) A control that handed a colour straight to a
 * tool would be the second place a tool is configured, and the first would be
 * whatever a person set last session.
 *
 * ## The colour control is a PAIR, because the value is a choice or the absence
 *   of one
 *
 * `editing.annotation-colour` is `'auto'` or a hex, and `'auto'` means *each
 * tool's own* — the highlighter's yellow, the caret's red. A colour input alone
 * cannot express *no choice*: every colour input has a value, and the browser
 * picks black when you give it none. So there is a checkbox that says which
 * state you are in and an input that supplies the colour when you are in the
 * other, which is the only shape that can represent both.
 *
 * Returning to `'auto'` keeps nothing: a person who unticks it and ticks it
 * again gets the tools' own colours, not the colour they had chosen. That is
 * the honest reading of a tri-state — remembering the old value would make the
 * checkbox a *use it or not* toggle over a hidden preference nothing shows.
 *
 * ## The bounds come from the contract
 *
 * Every `min`, `max` and `step` here is the payload's own, imported. A slider
 * that offered a size the schema refuses is a control that fails on apply,
 * which is the wired-tools rule arriving at a number instead of a button.
 */
export interface StylePanelProps {
  readonly settings: SettingsStore;
}

export function StylePanel({ settings }: StylePanelProps): ReactElement {
  const { i18n } = useLingui();
  const colour = useSetting(settings, ANNOTATION_COLOUR_SETTING);
  const opacity = useSetting(settings, ANNOTATION_OPACITY_SETTING);
  const lineWidth = useSetting(settings, ANNOTATION_LINE_WIDTH_SETTING);
  const fontSize = useSetting(settings, ANNOTATION_FONT_SIZE_SETTING);
  const chosen = colour !== 'auto';

  return (
    <section aria-label={i18n._(STYLE_PANEL_LABEL)} className="m-style-panel">
      <label className="m-style-row">
        <input
          checked={!chosen}
          onChange={(event) => {
            // A DEFAULT ON THE WAY OUT OF `auto`, and it is the shapes' red
            // rather than black: black is what an empty colour input answers,
            // and a person who has just said *I want to choose* has not chosen
            // black. `#d92626` is `STROKE` written the way an input takes it.
            settings.set(
              ANNOTATION_COLOUR_SETTING.id,
              event.target.checked ? 'auto' : STARTING_COLOUR,
            );
          }}
          type="checkbox"
        />
        {i18n._(STYLE_COLOUR_AUTO)}
      </label>
      <label className="m-style-row">
        {i18n._(EDITING_COLOUR_TITLE)}
        <input
          aria-label={i18n._(STYLE_COLOUR_CHOOSE)}
          disabled={!chosen}
          onChange={(event) => {
            settings.set(ANNOTATION_COLOUR_SETTING.id, event.target.value);
          }}
          type="color"
          // WHILE `auto` IS ON THIS SHOWS THE SHAPES' RED AND IS DISABLED. A
          // colour input cannot show *no colour*, so the honest arrangement is
          // one that cannot be operated while the choice is not being made.
          value={chosen ? colour : STARTING_COLOUR}
        />
      </label>
      <label className="m-style-row">
        {i18n._(EDITING_OPACITY_TITLE)}
        <input
          max={1}
          min={0.1}
          onChange={(event) => {
            settings.set(ANNOTATION_OPACITY_SETTING.id, Number(event.target.value));
          }}
          step={0.05}
          type="range"
          value={opacity}
        />
      </label>
      <label className="m-style-row">
        {i18n._(EDITING_LINE_WIDTH_TITLE)}
        <input
          max={MAX_ANNOTATION_BORDER}
          min={0}
          onChange={(event) => {
            settings.set(ANNOTATION_LINE_WIDTH_SETTING.id, Number(event.target.value));
          }}
          step={0.5}
          type="number"
          value={lineWidth}
        />
      </label>
      <label className="m-style-row">
        {i18n._(EDITING_FONT_SIZE_TITLE)}
        <input
          max={MAX_ANNOTATION_FONT}
          min={MIN_ANNOTATION_FONT}
          onChange={(event) => {
            settings.set(ANNOTATION_FONT_SIZE_SETTING.id, Number(event.target.value));
          }}
          step={1}
          type="number"
          value={fontSize}
        />
      </label>
    </section>
  );
}
