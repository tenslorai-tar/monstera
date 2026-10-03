import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  PRINT_APPLY,
  PRINT_DPI,
  PRINT_DPI_150,
  PRINT_DPI_150_NOTE,
  PRINT_DPI_300,
  PRINT_DPI_300_NOTE,
  PRINT_DPI_600,
  PRINT_DPI_600_NOTE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogChoices, DialogFooter, type DialogChoice } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { PrintAnswer } from './print.js';

type Dpi = PrintAnswer['dpi'];

/**
 * Each resolution as a choice of the pattern: a short name and, under it, how many dots it is and what it is for. One
 * list holds the answer's dpi beside the choice's words, so a fourth resolution cannot arrive without them.
 *
 * NAME AND NOTE APART: each option was one line, *"High — up to 600 dots per inch, lower on a large page"*, set in a
 * narrow group at the row's right where it wrapped (the owner's review, item 1c). The same names are the Rendering
 * setting's, which a segmented control shows, and there a sentence cannot fit at all.
 */
const RESOLUTIONS = [
  { dpi: 150, value: 'draft', label: PRINT_DPI_150, note: PRINT_DPI_150_NOTE },
  { dpi: 300, value: 'standard', label: PRINT_DPI_300, note: PRINT_DPI_300_NOTE },
  { dpi: 600, value: 'high', label: PRINT_DPI_600, note: PRINT_DPI_600_NOTE },
] as const satisfies readonly (DialogChoice<string> & { readonly dpi: Dpi })[];

type Quality = (typeof RESOLUTIONS)[number]['value'];

/**
 * The print dialog's body: the resolution pages are drawn at.
 *
 * **It starts on the quality Settings › Rendering chose**, Standard (300) unless a person chose otherwise: sharp text
 * on an ordinary printer, and a quarter of 600's pixels a page, which is what a person waits for. The button names
 * the next step, the operating system's print dialog, as the exports' buttons name theirs.
 */
export default function PrintBody({ dpi: starting, resolve }: { readonly dpi: Dpi } & DialogAnswering<PrintAnswer>): ReactElement {
  const [dpi, setDpi] = useState<Dpi>(starting);

  return (
    <div className="m-print">
      <DialogChoices<Quality>
        label={PRINT_DPI}
        options={RESOLUTIONS}
        value={RESOLUTIONS.find((each) => each.dpi === dpi)?.value ?? 'standard'}
        onChange={(chosen) => {
          setDpi(RESOLUTIONS.find((each) => each.value === chosen)?.dpi ?? starting);
        }}
      />
      <DialogFooter>
        <Button
          label={PRINT_APPLY}
          variant="primary"
          onClick={() => {
            resolve({ dpi });
          }}
        />
      </DialogFooter>
    </div>
  );
}
