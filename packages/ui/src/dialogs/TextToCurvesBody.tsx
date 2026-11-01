import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import type { z } from 'zod';

import {
  TEXT_TO_CURVES_APPLY,
  TEXT_TO_CURVES_FIELDS,
  TEXT_TO_CURVES_LOSES,
  TEXT_TO_CURVES_SAVES,
  TEXT_TO_CURVES_TAGS,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { TEXT_TO_CURVES_RESULT } from './textToCurves.js';

/**
 * The question before a curves copy (ADR-0282 Decision 3). The fields and tags lines are there only where main counted
 * some, so a person whose document has neither reads nothing about either. A default export because `declareDialog`
 * takes a `lazy()` component.
 */
export default function TextToCurvesBody({
  fields,
  tags,
  resolve,
}: { readonly fields: number; readonly tags: number } & DialogAnswering<z.infer<typeof TEXT_TO_CURVES_RESULT>>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-text-to-curves">
      <p>{_(TEXT_TO_CURVES_SAVES)}</p>
      <p>{_(TEXT_TO_CURVES_LOSES)}</p>
      {fields > 0 ? <p>{_(TEXT_TO_CURVES_FIELDS)}</p> : null}
      {tags > 0 ? <p>{_(TEXT_TO_CURVES_TAGS)}</p> : null}
      <DialogFooter>
        <Button
          label={TEXT_TO_CURVES_APPLY}
          variant="primary"
          onClick={() => {
            resolve({ confirmed: true });
          }}
        />
      </DialogFooter>
    </div>
  );
}
