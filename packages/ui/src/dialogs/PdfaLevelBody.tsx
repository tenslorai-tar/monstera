import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  EXPORT_PAGES_APPLY,
  PDFA_LEVEL,
  PDFA_LEVEL_1B,
  PDFA_LEVEL_1B_NOTE,
  PDFA_LEVEL_2B,
  PDFA_LEVEL_2B_NOTE,
  PDFA_LEVEL_3B,
  PDFA_LEVEL_3B_NOTE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { type DialogChoice, DialogChoices, DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { PDFA_LEVEL_CHOICES, type PdfaLevelChoice } from './pdfaLevel.js';

/** Each level's name and what it is for, keyed by level so a level added arrives owing its words. */
const LEVELS: Readonly<Record<PdfaLevelChoice, Omit<DialogChoice<PdfaLevelChoice>, 'value'>>> = {
  '2b': { label: PDFA_LEVEL_2B, note: PDFA_LEVEL_2B_NOTE },
  '1b': { label: PDFA_LEVEL_1B, note: PDFA_LEVEL_1B_NOTE },
  '3b': { label: PDFA_LEVEL_3B, note: PDFA_LEVEL_3B_NOTE },
};

/**
 * The PDF/A level dialog's body: the three levels, 2b selected, and the button that names the next step — the file is
 * main's to pick after this, as the other exports' is.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function PdfaLevelBody({ resolve }: DialogAnswering<{ readonly level: PdfaLevelChoice }>): ReactElement {
  const [level, setLevel] = useState<PdfaLevelChoice>('2b');
  return (
    <div className="m-pdfa-level">
      <DialogChoices<PdfaLevelChoice>
        label={PDFA_LEVEL}
        options={PDFA_LEVEL_CHOICES.map((value) => ({ value, ...LEVELS[value] }))}
        value={level}
        onChange={setLevel}
      />
      <DialogFooter>
        <Button
          label={EXPORT_PAGES_APPLY}
          variant="primary"
          onClick={() => {
            resolve({ level });
          }}
        />
      </DialogFooter>
    </div>
  );
}
