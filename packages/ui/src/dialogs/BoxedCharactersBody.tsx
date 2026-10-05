import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  BOXED_CHARACTERS_AT,
  BOXED_CHARACTERS_AT_LINE,
  BOXED_CHARACTERS_MORE,
  BOXED_CHARACTERS_SAID,
} from '../messages/en.js';
import { DialogScroll } from '../primitives/Dialog.js';
import type { BoxedCharacters } from './boxedCharacters.js';

/** A code point as Unicode writes it: `U+4E2D`, four hex digits at least. */
function codePointOf(character: string): string {
  return `U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * The characters a composed document shows as boxes: a sentence, each place named, and how many more.
 *
 * EACH CHARACTER BY ITS CODE POINT TOO: a character no font in the document could draw is likely one this window's
 * font cannot draw either, so the character alone could be a second box. `U+4E2D` names it whatever is installed.
 *
 * `WorkbookIncompleteBody.tsx`' layout and its reason: the list scrolls, and the sentence and the count stay beside
 * the footer. A default export because `declareDialog` takes a `lazy()` component.
 */
export default function BoxedCharactersBody({ boxed, more }: BoxedCharacters): ReactElement {
  const { _ } = useLingui();
  return (
    <>
      <p className="m-boxed-characters__said">{_(BOXED_CHARACTERS_SAID)}</p>
      <DialogScroll>
        <ul className="m-dialog-list m-boxed-characters__list" data-boxed-places={boxed.length}>
          {boxed.map((place) => (
            <li key={`${String(place.line)}:${String(place.column)}:${place.character}`}>
              {place.column === null
                ? _(BOXED_CHARACTERS_AT_LINE, { character: place.character, code: codePointOf(place.character), line: place.line })
                : _(BOXED_CHARACTERS_AT, {
                    character: place.character,
                    code: codePointOf(place.character),
                    line: place.line,
                    column: place.column,
                  })}
            </li>
          ))}
        </ul>
      </DialogScroll>
      {more > 0 ? (
        <p className="m-boxed-characters__more" data-more-places={more}>
          {_(BOXED_CHARACTERS_MORE, { count: more })}
        </p>
      ) : null}
    </>
  );
}
