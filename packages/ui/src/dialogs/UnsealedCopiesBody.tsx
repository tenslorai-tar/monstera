import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { UNSEALED_COPIES_SAID, UNSEALED_UNDO_COPIES } from '../messages/en.js';
import { DialogScroll } from '../primitives/Dialog.js';
import type { UnsealedCopies } from './unsealedCopies.js';

/**
 * The older copies a protect could not encrypt: a sentence, then each backup by name and the undo copies by count.
 *
 * `BoxedCharactersBody.tsx`' layout and its reason: the sentence stays beside the footer and the list scrolls. A
 * default export because `declareDialog` takes a `lazy()` component. The names are basenames main chose, not paths —
 * where a copy is on disk is main's, and a renderer-facing type never holds a path. The undo copies are one line, a
 * count: their names tell a person nothing (ADR-0178's 2026-10-17 correction).
 */
export default function UnsealedCopiesBody(props: UnsealedCopies): ReactElement {
  const { _ } = useLingui();
  return (
    <>
      <p className="m-unsealed-copies__said">{_(UNSEALED_COPIES_SAID)}</p>
      <DialogScroll>
        <ul
          className="m-dialog-list m-unsealed-copies__list"
          data-unsealed-copies={props.copies.length}
          data-unsealed-undo-copies={props.undoCopies}
        >
          {props.copies.map((name, at) => (
            <li key={`${String(at)}:${name}`}>{name}</li>
          ))}
          {props.undoCopies > 0 ? <li key="undo">{_(UNSEALED_UNDO_COPIES, { count: props.undoCopies })}</li> : null}
        </ul>
      </DialogScroll>
    </>
  );
}
