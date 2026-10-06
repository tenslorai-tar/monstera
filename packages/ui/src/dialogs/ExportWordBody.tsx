import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  EXPORT_WORD_APPLY,
  EXPORT_WORD_LAYOUT,
  EXPORT_WORD_LAYOUT_NOTE,
  EXPORT_WORD_MODE,
  EXPORT_WORD_MODE_NOTE,
  EXPORT_WORD_PAGES_NOTE,
  EXPORT_WORD_RICH,
  EXPORT_WORD_RICH_NOTE,
  EXPORT_WORD_TEXT,
  EXPORT_WORD_TEXT_NOTE,
  PAGE_RANGE_EXPORT_EMPTY,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { type DialogChoice, DialogChoices, DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { ExportWordAnswer } from './exportWord.js';
import { PageRangeChoice, usePageRange } from './PageRangeChoice.js';

type WordMode = ExportWordAnswer['mode'];

/**
 * Each mode, its short name and the sentence that says what a person gets — keyed by mode, so a fourth mode arrives
 * owing its words.
 */
const MODES: Readonly<Record<WordMode, Omit<DialogChoice<WordMode>, 'value'>>> = {
  rich: { label: EXPORT_WORD_RICH, note: EXPORT_WORD_RICH_NOTE },
  layout: { label: EXPORT_WORD_LAYOUT, note: EXPORT_WORD_LAYOUT_NOTE },
  text: { label: EXPORT_WORD_TEXT, note: EXPORT_WORD_TEXT_NOTE },
};

/**
 * The Word export dialog's body: which pages, and which of the three modes.
 *
 * **Rich is selected first**: it is the mode that keeps the most of the document
 * while still reflowing, which is what most people exporting to Word want to do
 * with the result — edit it. The file is main's to pick after this, so the
 * button names that next step, as the other exports' do.
 *
 * **The pages are the exports' one row** (`PageRangeChoice`, ADR-0161), so *Select pages* means here what it means in
 * every other export, and a refusal is said once the button is pressed.
 */
export default function ExportWordBody({
  pageCount,
  resolve,
}: { readonly pageCount: number } & DialogAnswering<ExportWordAnswer>): ReactElement {
  const range = usePageRange(pageCount);
  const [mode, setMode] = useState<WordMode>('rich');

  return (
    <div className="m-export-word">
      <PageRangeChoice empty={PAGE_RANGE_EXPORT_EMPTY} note={EXPORT_WORD_PAGES_NOTE} range={range} />
      <DialogChoices<WordMode>
        label={EXPORT_WORD_MODE}
        note={EXPORT_WORD_MODE_NOTE}
        options={(Object.keys(MODES) as WordMode[]).map((value) => ({ value, ...MODES[value] }))}
        value={mode}
        onChange={setMode}
      />
      <DialogFooter>
        <Button
          label={EXPORT_WORD_APPLY}
          variant="primary"
          onClick={() => {
            const pages = range.proceed();
            if (pages === undefined) return;
            resolve({ mode, pages: [...pages] });
          }}
        />
      </DialogFooter>
    </div>
  );
}
