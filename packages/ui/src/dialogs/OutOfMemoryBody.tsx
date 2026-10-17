import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import type { z } from 'zod';

import { OUT_OF_MEMORY_OTHERS, OUT_OF_MEMORY_OWN, OUT_OF_MEMORY_TRY_AGAIN } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { type OUT_OF_MEMORY_RESULT, type OutOfMemory, wholeGigabytes } from './outOfMemory.js';

/**
 * The owner's sentence with the computer's own figure (ADR-0253), and *Try again*. Other programs are named only where
 * `main` read the computer as short when the failure happened; otherwise the sentence says the total and no more.
 */
export default function OutOfMemoryBody({
  totalBytes,
  othersUsingMost,
  resolve,
}: OutOfMemory & DialogAnswering<z.infer<typeof OUT_OF_MEMORY_RESULT>>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-out-of-memory" data-out-of-memory={othersUsingMost ? 'others' : 'own'}>
      <p>{_(othersUsingMost ? OUT_OF_MEMORY_OTHERS : OUT_OF_MEMORY_OWN, { gigabytes: wholeGigabytes(totalBytes) })}</p>
      <DialogFooter>
        <Button
          label={OUT_OF_MEMORY_TRY_AGAIN}
          onClick={() => {
            resolve({ kind: 'try-again' });
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}
