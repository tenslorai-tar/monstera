import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  BOXED_CHARACTERS_AT,
  BOXED_CHARACTERS_AT_LINE,
  BOXED_CHARACTERS_MORE,
  BOXED_CHARACTERS_ON_PAGE,
  BOXED_CHARACTERS_SAID,
  BOXED_CHARACTERS_SAID_EDIT,
} from '../messages/en.js';
import { DialogScroll } from '../primitives/Dialog.js';
import type { BoxedCharacters } from './boxedCharacters.js';

/** A code point as Unicode writes it: `U+4E2D`, four hex digits at least. */
function codePointOf(character: string): string {
  return `U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * The characters a composed document, or an edit, shows as boxes: a sentence, each place named, and how many more.
 *
 * EACH CHARACTER BY ITS CODE POINT TOO: a character no font in the document could draw is likely one this window's
 * font cannot draw either, so the character alone could be a second box. `U+4E2D` names it whatever is installed.
 *
 * `WorkbookIncompleteBody.tsx`' layout and its reason: the list scrolls, and the sentence and the count stay beside
 * the footer. A default export because `declareDialog` takes a `lazy()` component.
 */
export default function BoxedCharactersBody(props: BoxedCharacters): ReactElement {
  const { _ } = useLingui();
  const places =
    props.from === 'edit'
      ? props.boxed.map((place, at) => ({
          key: `${String(at)}:${place.character}`,
          // A PAGE AS THE PERSON COUNTS IT: the edit names it from 0, the window from 1.
          said: _(BOXED_CHARACTERS_ON_PAGE, { character: place.character, code: codePointOf(place.character), page: place.page + 1 }),
        }))
      : props.boxed.map((place) => ({
          key: `${String(place.line)}:${String(place.column)}:${place.character}`,
          said:
            place.column === null
              ? _(BOXED_CHARACTERS_AT_LINE, { character: place.character, code: codePointOf(place.character), line: place.line })
              : _(BOXED_CHARACTERS_AT, {
                  character: place.character,
                  code: codePointOf(place.character),
                  line: place.line,
                  column: place.column,
                }),
        }));
  return (
    <>
      <p className="m-boxed-characters__said">{_(props.from === 'edit' ? BOXED_CHARACTERS_SAID_EDIT : BOXED_CHARACTERS_SAID)}</p>
      <DialogScroll>
        <ul className="m-dialog-list m-boxed-characters__list" data-boxed-places={places.length}>
          {places.map((place) => (
            <li key={place.key}>{place.said}</li>
          ))}
        </ul>
      </DialogScroll>
      {props.more > 0 ? (
        <p className="m-boxed-characters__more" data-more-places={props.more}>
          {_(BOXED_CHARACTERS_MORE, { count: props.more })}
        </p>
      ) : null}
    </>
  );
}
