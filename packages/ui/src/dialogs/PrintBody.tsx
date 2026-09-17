import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { PRINT_APPLY, PRINT_DPI, PRINT_DPI_150, PRINT_DPI_300, PRINT_DPI_600 } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { PrintAnswer } from './print.js';

type Dpi = PrintAnswer['dpi'];

/** Each resolution and the words a person reads for it, as a record so a fourth arrives owing its words. */
const RESOLUTIONS: Readonly<Record<Dpi, MessageKey>> = {
  150: PRINT_DPI_150,
  300: PRINT_DPI_300,
  600: PRINT_DPI_600,
};

/**
 * The print dialog's body: the resolution pages are drawn at.
 *
 * **300 is selected first**: sharp text on an ordinary printer, and a quarter of
 * 600's pixels a page, which is what a person waits for. The button names the next
 * step, the operating system's print dialog, as the exports' buttons name theirs.
 */
export default function PrintBody({ resolve }: DialogAnswering<PrintAnswer>): ReactElement {
  const { _ } = useLingui();
  const [dpi, setDpi] = useState<Dpi>(300);

  return (
    <div className="m-print">
      <fieldset className="m-print__dpi">
        <legend>{_(PRINT_DPI)}</legend>
        {([150, 300, 600] as const).map((each) => (
          <label key={each}>
            <input
              type="radio"
              name="print-dpi"
              checked={dpi === each}
              onChange={() => {
                setDpi(each);
              }}
            />
            {_(RESOLUTIONS[each])}
          </label>
        ))}
      </fieldset>
      <Button
        label={PRINT_APPLY}
        variant="primary"
        onClick={() => {
          resolve({ dpi });
        }}
      />
    </div>
  );
}
