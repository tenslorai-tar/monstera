import { useLingui } from '@lingui/react';
import { BUILT_IN_STAMPS, type BuiltInStamp } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  STAMP_DIALOG_ADD_PICTURE,
  STAMP_DIALOG_APPLY,
  STAMP_DIALOG_CHOICES,
  STAMP_DIALOG_MINE,
  STAMP_DIALOG_MINE_EMPTY,
  STAMP_DIALOG_REMOVE,
  STAMP_TITLES,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { StampAnswer, StampPicture } from './stampResult.js';

/** What is chosen: a built-in stamp by name, or a kept picture by id. */
type Choice = { readonly stamp: BuiltInStamp } | { readonly picture: string };

/**
 * The stamp chooser's body: each built-in stamp as the word it puts on the page, drawn as a stamp is — capitals in a
 * bordered box — so the choice looks like its result; then the person's own pictures, each with a way to remove it,
 * and a way to add one. The built-ins are the contract's list in its order; the words are catalogue keys, one per stamp.
 *
 * APPROVED is chosen at the start, so *Add stamp* always has something to add. Adding or removing a picture ANSWERS,
 * and the opener asks again with the library as it then is — the props are fixed while this is open.
 */
export default function StampBody({
  pictures,
  resolve,
}: { readonly pictures: readonly StampPicture[] } & DialogAnswering<StampAnswer>): ReactElement {
  const { _ } = useLingui();
  const [choice, setChoice] = useState<Choice>({ stamp: 'approved' });
  const chosen = (candidate: Choice): boolean =>
    'stamp' in candidate
      ? 'stamp' in choice && choice.stamp === candidate.stamp
      : 'picture' in choice && choice.picture === candidate.picture;

  return (
    <div className="m-stamp-chooser">
      <fieldset className="m-stamp-chooser__choices">
        <legend>{_(STAMP_DIALOG_CHOICES)}</legend>
        {BUILT_IN_STAMPS.map((each) => (
          <label key={each} className="m-stamp-chooser__choice" data-stamp={each}>
            <input
              type="radio"
              name="stamp-choice"
              checked={chosen({ stamp: each })}
              onChange={() => {
                setChoice({ stamp: each });
              }}
            />
            <span className="m-stamp-chooser__word">{_(STAMP_TITLES[each])}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="m-stamp-chooser__choices">
        <legend>{_(STAMP_DIALOG_MINE)}</legend>
        {pictures.length === 0 ? <p className="m-stamp-chooser__empty">{_(STAMP_DIALOG_MINE_EMPTY)}</p> : null}
        {pictures.map((picture) => (
          <div key={picture.id} className="m-stamp-chooser__mine">
            <label className="m-stamp-chooser__choice" data-stamp-picture={picture.id}>
              <input
                type="radio"
                name="stamp-choice"
                checked={chosen({ picture: picture.id })}
                onChange={() => {
                  setChoice({ picture: picture.id });
                }}
              />
              <img className="m-stamp-chooser__picture" src={picture.src} alt={picture.name} />
            </label>
            <Button
              label={STAMP_DIALOG_REMOVE}
              values={{ name: picture.name }}
              onClick={() => {
                resolve({ library: 'remove', id: picture.id });
              }}
            />
          </div>
        ))}
      </fieldset>
      {/* THE PATTERN'S FOOTER: Cancel, then adding a picture, then the one action. The stamps above stay a gallery —
          a stamp is chosen by how it looks, which a row of words cannot show. */}
      <DialogFooter>
        <Button
          label={STAMP_DIALOG_ADD_PICTURE}
          onClick={() => {
            resolve({ library: 'add' });
          }}
        />
        <Button
          label={STAMP_DIALOG_APPLY}
          variant="primary"
          onClick={() => {
            resolve('stamp' in choice ? { stamp: choice.stamp } : { picture: choice.picture });
          }}
        />
      </DialogFooter>
    </div>
  );
}
