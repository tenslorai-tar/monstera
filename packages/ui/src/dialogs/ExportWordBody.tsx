import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  EXPORT_WORD_APPLY,
  EXPORT_WORD_MODE,
  SAMPLE_CANCEL,
  SAMPLE_WORD_LAYOUT,
  SAMPLE_WORD_LAYOUT_NOTE,
  SAMPLE_WORD_NOTE,
  SAMPLE_WORD_RICH,
  SAMPLE_WORD_RICH_NOTE,
  SAMPLE_WORD_TEXT,
  SAMPLE_WORD_TEXT_NOTE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogChoices, DialogFooter, DialogRow } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { ExportWordAnswer } from './exportWord.js';

type WordMode = ExportWordAnswer['mode'];


/**
 * The Word export dialog's body: which of the three modes.
 *
 * **Rich is selected first**: it is the mode that keeps the most of the document
 * while still reflowing, which is what most people exporting to Word want to do
 * with the result — edit it. The file is main's to pick after this, so the
 * button names that next step, as the other exports' do.
 */
export default function ExportWordBody({ resolve }: DialogAnswering<ExportWordAnswer>): ReactElement {
  const [mode, setMode] = useState<WordMode>('rich');

  return (
    <div className="m-export-word">
      <DialogRow label={EXPORT_WORD_MODE} note={SAMPLE_WORD_NOTE}>
        {() => null}
      </DialogRow>
      <DialogChoices<WordMode>
        label={EXPORT_WORD_MODE}
        options={[
          { value: 'rich', label: SAMPLE_WORD_RICH, note: SAMPLE_WORD_RICH_NOTE },
          { value: 'layout', label: SAMPLE_WORD_LAYOUT, note: SAMPLE_WORD_LAYOUT_NOTE },
          { value: 'text', label: SAMPLE_WORD_TEXT, note: SAMPLE_WORD_TEXT_NOTE },
        ]}
        value={mode}
        onChange={setMode}
      />
      <DialogFooter cancelLabel={SAMPLE_CANCEL}>
        <Button
          label={EXPORT_WORD_APPLY}
          variant="primary"
          onClick={() => {
            resolve({ mode });
          }}
        />
      </DialogFooter>
    </div>
  );
}
