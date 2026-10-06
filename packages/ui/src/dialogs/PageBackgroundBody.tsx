import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { colourFromHex } from '../annotations/annotationStyle.js';
import { ColourSwatches } from '../ColourChoice.js';
import {
  PAGE_BACKGROUND_APPLY,
  PAGE_BACKGROUND_COLOUR,
  PAGE_BACKGROUND_EXPLAINS,
  PROPERTIES_CUSTOM_COLOUR,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { PageScopeChoice } from './PageScopeChoice.js';
import type { PageBackgroundAnswer } from './pageBackground.js';
import { DEFAULT_PAGE_TINT, PAGE_TINTS } from './pageBackgroundColours.js';

/**
 * The page background dialog's body: a colour and the pages it fills.
 *
 * **It starts on a colour**, cream, so the dialog is finished the moment it opens: a person who wants a background
 * presses *Add background*, and one who wants another picks a swatch or a custom colour first. A custom colour a
 * platform picker answers in a form `colourFromHex` cannot read is not offered as an answer: the cream stays.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function PageBackgroundBody({
  pages,
  resolve,
}: { readonly pages: readonly number[] } & DialogAnswering<PageBackgroundAnswer>): ReactElement {
  const { _ } = useLingui();
  const [hex, setHex] = useState(DEFAULT_PAGE_TINT);
  const [everyPage, setEveryPage] = useState(true);
  const colour = colourFromHex(hex);

  return (
    <div className="m-page-background">
      <p className="m-page-background__explains">{_(PAGE_BACKGROUND_EXPLAINS)}</p>
      <DialogRow label={PAGE_BACKGROUND_COLOUR}>
        <ColourSwatches
          presets={PAGE_TINTS}
          current={hex}
          customLabel={PROPERTIES_CUSTOM_COLOUR}
          fallback={DEFAULT_PAGE_TINT}
          layout="start"
          onPick={(next) => {
            if (next !== undefined && colourFromHex(next) !== undefined) setHex(next);
          }}
        />
      </DialogRow>
      <PageScopeChoice className="m-page-background__scope" pages={pages} every={everyPage} onChange={setEveryPage} />
      <DialogFooter>
        <Button
          label={PAGE_BACKGROUND_APPLY}
          variant="primary"
          onClick={() => {
            if (colour === undefined) return;
            const [red, green, blue] = colour;
            resolve({ pages: everyPage ? 'all' : [...pages], red, green, blue });
          }}
        />
      </DialogFooter>
    </div>
  );
}
