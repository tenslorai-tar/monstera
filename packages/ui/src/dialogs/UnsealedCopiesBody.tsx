import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { UNSEALED_COPIES_SAID } from '../messages/en.js';
import { DialogScroll } from '../primitives/Dialog.js';
import type { UnsealedCopies } from './unsealedCopies.js';

/**
 * The older copies a protect could not encrypt: a sentence, then each copy by name.
 *
 * `BoxedCharactersBody.tsx`' layout and its reason: the sentence stays beside the footer and the list scrolls. A
 * default export because `declareDialog` takes a `lazy()` component. The names are basenames main chose, not paths —
 * where a copy is on disk is main's, and a renderer-facing type never holds a path.
 */
export default function UnsealedCopiesBody(props: UnsealedCopies): ReactElement {
  const { _ } = useLingui();
  return (
    <>
      <p className="m-unsealed-copies__said">{_(UNSEALED_COPIES_SAID)}</p>
      <DialogScroll>
        <ul className="m-dialog-list m-unsealed-copies__list" data-unsealed-copies={props.copies.length}>
          {props.copies.map((name, at) => (
            <li key={`${String(at)}:${name}`}>{name}</li>
          ))}
        </ul>
      </DialogScroll>
    </>
  );
}
