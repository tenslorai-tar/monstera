import { useLingui } from '@lingui/react';
import { type ReactElement, useId, useState, useSyncExternalStore } from 'react';

import { type DocumentFont, FontPicker, type FontList, SUBSET_TAG } from './FontPicker.js';
import { TEXT_FORMAT_FAMILY, TEXT_FORMAT_FAMILY_RUN, TEXT_FORMAT_SIZE } from './messages/en.js';
import {
  KEEPS_EDITOR,
  editorRevision,
  finishOpenEditor,
  formatOpenEditor,
  leavesEditor,
  onEditorChange,
  openEditorFonts,
  openEditorState,
  refocusOpenEditor,
} from './textEditorControl.js';

/**
 * The open text editor's FONT AND SIZE, the one pair of value controls for it (the TEXT spec's C3 and D1): drawn in the
 * Properties panel's Text section and in the ribbon's Format group (ADR-0228 Decision 5), one component so the two can
 * never set a size by two rules (B3a). Each holds a value, so neither is a command: both set it through the one
 * {@link formatOpenEditor}, as the Format group's commands do.
 *
 * ## It keeps the editor open
 *
 * Marked {@link KEEPS_EDITOR}, as the panel's section is: a focus moving into it from the words does not write and close
 * the editor, and a focus leaving it for neither the words nor another surface that keeps them finishes the edit. In the
 * ribbon the font list floats over the window, since the ribbon's row clips what grows out of it.
 */

/** The standard fonts the in-place editor sets, through the resolver's stand-ins: Symbol and ZapfDingbats have none. */
const EDITOR_BUILT_IN = ['Helvetica', 'Times', 'Courier'] as const;

export interface TextFontSizeProps {
  /** The fonts this computer has, as `app.fontFamilies` answered, or `undefined` while it is asked. */
  readonly fonts: FontList;
  /** Every font the document names (`document.fonts`): none while it is read, and none in a build that cannot read it. */
  readonly documentFonts: readonly DocumentFont[];
  /** Where it is drawn: the panel's stacked rows, or the ribbon's one compact row with a floating list. */
  readonly place: 'panel' | 'ribbon';
}

export function TextFontSize({ fonts, documentFonts, place }: TextFontSizeProps): ReactElement {
  const { _ } = useLingui();
  // RE-READ ON EVERY CHANGE of the selection or the formatting, since the state is the editor's and not a snapshot.
  useSyncExternalStore(onEditorChange, editorRevision);
  const state = openEditorState();
  // THE PICKER'S FIRST GROUP IS THE WHOLE DOCUMENT'S (B2.8): the open editor's page first, which the editor already holds
  // and so is there before the document's read answers, then every other font the document names.
  const inDocument: DocumentFont[] = [
    ...openEditorFonts().map((name) => ({ name, partial: SUBSET_TAG.test(name) })),
    ...documentFonts,
  ];
  const sizeId = useId();
  const [size, setSize] = useState<string | undefined>(undefined);
  const shown = size ?? (state?.size === undefined ? '' : String(Math.round(state.size * 10) / 10));
  return (
    <div
      className={place === 'ribbon' ? 'm-text-font-size m-text-font-size--ribbon' : 'm-text-font-size'}
      data-text-font-size={place}
      {...{ [KEEPS_EDITOR]: '' }}
      // LEFT FOR NEITHER THE WORDS NOR A SURFACE THAT KEEPS THEM: the edit is finished, as a click elsewhere finishes it.
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        if (leavesEditor(event.relatedTarget)) finishOpenEditor();
      }}
    >
      <FontPicker
        builtIn={EDITOR_BUILT_IN}
        floating={place === 'ribbon'}
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
    </div>
  );
}
