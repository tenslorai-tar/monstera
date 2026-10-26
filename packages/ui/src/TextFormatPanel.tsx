import { useLingui } from '@lingui/react';
import { type ReactElement, useSyncExternalStore } from 'react';

import { FORMAT_ENTRIES } from './commands/textFormatCommands.js';
import { type DocumentFont, type FontList, RESOLVED_BUILT_IN, SUBSET_TAG } from './FontPicker.js';
import {
  TEXT_BLOCK_REMOVE,
  TEXT_FORMAT_FAMILY_RUN,
  TEXT_PROPERTIES_BOX,
  TEXT_PROPERTIES_HEADING,
  TEXT_PROPERTIES_LABEL,
} from './messages/en.js';
import { Button } from './primitives/Button.js';
import { IconButton } from './primitives/IconButton.js';
import { ICONS } from './primitives/icons.js';
import {
  KEEPS_EDITOR,
  finishOpenEditor,
  formatOpenEditor,
  leavesEditor,
  onEditorChange,
  openEditorSnapshot,
  refocusOpenEditor,
  removeOpenBlock,
} from './editorKit/openEditor.js';
import { spacingBoundOf, spacingOf } from './textFormatting.js';
import { TextSection, type TextRow } from './TextSection.js';

/**
 * The Properties panel while words are being edited in place, or added (the owner's K11 and N13): the one Text section
 * every text tool shows (`TextSection.tsx`), fed from the open editor, and the Box section below it.
 *
 * ## It keeps the editor open
 *
 * The panel is marked {@link KEEPS_EDITOR}: the editor's frame does not write and close when the focus moves into it,
 * and the panel finishes the editor when the focus leaves both (`leavesEditor`), so a size typed here and a click on the
 * page after it write once. A press on a button keeps the focus in the words (the mouse-down is refused); a field takes it
 * for as long as it is used, and Enter gives it back.
 *
 * ## Every control goes through the one {@link formatOpenEditor}
 *
 * The buttons are the formatting commands' actions (`FORMAT_ENTRIES`), and the values are sent as they are typed, since
 * the editor draws every digit; character spacing is typed in points and sent as the wire's fraction of the size
 * (ADR-0228), bounded either way by the one `spacingBoundOf`.
 */

/** Everything the editor's writer can set (ADR-0228): every row the section has. */
const EDITOR_ROWS: ReadonlySet<TextRow> = new Set(['style', 'rise', 'highlight', 'justify', 'lineSpacing', 'spaceAfter', 'spacing']);

/** The editor's paragraph verbs beyond alignment, by the table's ids: lists and indents. */
const PARAGRAPH_EXTRAS = new Set(['bullets', 'numbering', 'indent-more', 'indent-less'].map((name) => `text.format.${name}`));

/** A colour as `#rrggbb`. */
function hexOf(colour: { readonly r: number; readonly g: number; readonly b: number } | undefined): string | undefined {
  return colour === undefined ? undefined : `#${[colour.r, colour.g, colour.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** A `#rrggbb` as the contract's colour, or `null` for none or anything else. */
function rgbOf(hex: string | undefined): { r: number; g: number; b: number } | null {
  const found = hex === undefined ? null : /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (found === null) return null;
  return { r: parseInt(found[1] ?? '0', 16), g: parseInt(found[2] ?? '0', 16), b: parseInt(found[3] ?? '0', 16) };
}

export interface TextFormatPanelProps {
  /** The fonts this computer has, as `app.fontFamilies` answered, or `undefined` while it is asked. */
  readonly fonts: FontList;
  /** Every font the document names (`document.fonts`): none while it is read, and none in a build that cannot read it. */
  readonly documentFonts: readonly DocumentFont[];
}

export function TextFormatPanel({ fonts, documentFonts }: TextFormatPanelProps): ReactElement {
  const { _ } = useLingui();
  // THE OPEN EDITOR'S SNAPSHOT, one per change of the selection or the formatting (`openEditorSnapshot`): the render reads
  // only what this hook answers, so a compiled panel shows the words as they are now (ADR-0258).
  const { state, paragraph, fonts: editorFonts } = useSyncExternalStore(onEditorChange, openEditorSnapshot);
  // THE SIZE THE SPACING IS A FRACTION OF: the words' at the selection.
  const wordSize = state?.size;
  // THE PICKER'S FIRST GROUP IS THE WHOLE DOCUMENT'S (B2.8): the open editor's page first, which the editor already holds
  // and so is there before the document's read answers, then every other font the document names.
  const inDocument: DocumentFont[] = [
    ...editorFonts.map((name) => ({ name, partial: SUBSET_TAG.test(name) })),
    ...documentFonts,
  ];
  return (
    <section
      aria-label={_(TEXT_PROPERTIES_LABEL)}
      className="m-properties m-text-properties"
      data-text-properties=""
      {...{ [KEEPS_EDITOR]: '' }}
      // LEFT FOR NEITHER THE WORDS NOR THIS PANEL: the edit is finished, as a click elsewhere finishes it from the words.
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
      </header>

      <TextSection
        font={{ list: fonts, builtIn: RESOLVED_BUILT_IN, inDocument, unset: TEXT_FORMAT_FAMILY_RUN }}
        lineSpacingBounds={{ min: 0.5, max: 5, step: 0.1 }}
        live
        look={{
          family: state?.family,
          size: wordSize,
          bold: state?.bold ?? false,
          italic: state?.italic ?? false,
          underline: state?.underline ?? false,
          strike: state?.strike ?? false,
          rise: state?.rise,
          colour: hexOf(state?.colour),
          highlight: hexOf(state?.highlight),
          align: paragraph?.align,
          lineSpacing: paragraph?.lineSpacing,
          spaceAfter: paragraph?.spaceAfter,
          spacing: state?.spacing === undefined || wordSize === undefined ? undefined : state.spacing * wordSize,
        }}
        onAlign={(align) => {
          formatOpenEditor({ kind: 'align', align });
        }}
        onColour={(hex) => {
          formatOpenEditor({ kind: 'set', change: { colour: rgbOf(hex) } });
        }}
        onEnter={refocusOpenEditor}
        onFamily={(family) => {
          formatOpenEditor({ kind: 'set', change: { family } });
          refocusOpenEditor();
        }}
        onHighlight={(hex) => {
          formatOpenEditor({ kind: 'set', change: { highlight: rgbOf(hex) } });
        }}
        onLineSpacing={(lineSpacing) => {
          formatOpenEditor({ kind: 'spacing', lineSpacing });
        }}
        onRise={(rise) => {
          formatOpenEditor({ kind: 'rise', rise });
        }}
        onSize={(size) => {
          formatOpenEditor({ kind: 'set', change: { size } });
        }}
        onSpaceAfter={(points) => {
          formatOpenEditor({ kind: 'space-after', points });
        }}
        onSpacing={(points) => {
          if (wordSize !== undefined) formatOpenEditor({ kind: 'set', change: { spacing: points === 0 ? null : spacingOf(points, wordSize) } });
        }}
        onToggle={(property) => {
          formatOpenEditor({ kind: 'toggle', property });
        }}
        ownColour
        paragraphExtras={FORMAT_ENTRIES.filter((entry) => PARAGRAPH_EXTRAS.has(entry.id)).map((entry) => (
          <IconButton
            icon={ICONS[entry.icon]}
            key={entry.id}
            label={entry.title}
            onClick={() => {
              formatOpenEditor(entry.action);
            }}
            size="control"
          />
        ))}
        shows={EDITOR_ROWS}
        sizeBounds={{ min: 1, max: 400, step: 0.5 }}
        spacingBound={wordSize === undefined ? undefined : spacingBoundOf(wordSize)}
      />

      <div aria-label={_(TEXT_PROPERTIES_BOX)} className="m-text-section" role="group">
        <h3 className="m-text-section__title">{_(TEXT_PROPERTIES_BOX)}</h3>
        {/* THE WORDS ON THE BUTTON (the owner's review of 0.1.16.0, R14): a lone bin in an empty card said what it does
            only to a pointer resting on it. The danger tone is the app's for removal; no question first, because the
            removal is one Undo away, as every other edit of the words is. */}
        <div className="m-text-section__buttons">
          <Button
            icon="Trash2"
            label={TEXT_BLOCK_REMOVE}
            onClick={() => {
              removeOpenBlock();
            }}
            variant="danger"
          />
        </div>
      </div>
    </section>
  );
}
