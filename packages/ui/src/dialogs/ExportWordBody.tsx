import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  EXPORT_WORD_APPLY,
  EXPORT_WORD_LAYOUT,
  EXPORT_WORD_MODE,
  EXPORT_WORD_RICH,
  EXPORT_WORD_TEXT,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { ExportWordAnswer } from './exportWord.js';

type WordMode = ExportWordAnswer['mode'];

/**
 * Each mode and the sentence that says what a person gets, as a record so a
 * fourth mode arrives owing its words.
 */
const MODES: Readonly<Record<WordMode, MessageKey>> = {
  rich: EXPORT_WORD_RICH,
  layout: EXPORT_WORD_LAYOUT,
  text: EXPORT_WORD_TEXT,
};

/**
 * The Word export dialog's body: which of the three modes.
 *
 * **Rich is selected first**: it is the mode that keeps the most of the document
 * while still reflowing, which is what most people exporting to Word want to do
 * with the result — edit it. The file is main's to pick after this, so the
 * button names that next step, as the other exports' do.
 */
export default function ExportWordBody({ resolve }: DialogAnswering<ExportWordAnswer>): ReactElement {
  const { _ } = useLingui();
  const [mode, setMode] = useState<WordMode>('rich');

  return (
    <div className="m-export-word">
      <fieldset className="m-export-word__mode">
        <legend>{_(EXPORT_WORD_MODE)}</legend>
        {(Object.keys(MODES) as WordMode[]).map((each) => (
          <label key={each}>
            <input
              type="radio"
              name="export-word-mode"
              checked={mode === each}
              onChange={() => {
                setMode(each);
              }}
            />
            {_(MODES[each])}
          </label>
        ))}
      </fieldset>
      <Button
        label={EXPORT_WORD_APPLY}
        variant="primary"
        onClick={() => {
          resolve({ mode });
        }}
      />
    </div>
  );
}
