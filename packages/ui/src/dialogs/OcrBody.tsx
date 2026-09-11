import { useLingui } from '@lingui/react';
import type { OcrLanguage } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  OCR_ALL_PAGES,
  OCR_LANGUAGE,
  OCR_LANGUAGE_NAMES,
  OCR_START,
  OCR_THIS_PAGE,
  OCR_UNAVAILABLE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { OcrAnswer } from './ocrResult.js';

/**
 * The recognition dialog's body — a language, and a scope.
 *
 * ## NO MODELS IS A DESIGNED STATE, and it is this component's first branch
 *
 * §10.5 requires the no-binary state to be designed rather than arrived at. With
 * no provisioned models there is a sentence saying what is missing and **no
 * control to start**: a disabled button invites a reader to hunt for what would
 * enable it, where a feature that plainly is not installed yet should say so.
 *
 * ## The language list is the MACHINE's, and the first entry is the default
 *
 * Ordered by `OCR_LANGUAGES` before it arrives here, so the default is the first
 * provisioned model rather than whichever download finished first. `eng` is what
 * CI provisions and the usual first entry, and nothing here hard-codes it — a
 * machine with only `heb` installed opens on Hebrew.
 *
 * Buttons rather than a `<select>`, which is `PageTransitionBody`'s choice for
 * this application's only list-of-names control and keeps the dialog to the
 * primitives that exist.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function OcrBody({
  page,
  languages,
  resolve,
}: {
  readonly page: number;
  readonly languages: readonly OcrLanguage[];
} & DialogAnswering<OcrAnswer>): ReactElement {
  const { _ } = useLingui();
  const [language, setLanguage] = useState<OcrLanguage | null>(languages[0] ?? null);
  const [everyPage, setEveryPage] = useState(true);

  if (language === null) {
    return (
      <div className="m-ocr">
        <p className="m-ocr__unavailable">{_(OCR_UNAVAILABLE)}</p>
      </div>
    );
  }

  return (
    <div className="m-ocr">
      <fieldset className="m-ocr__language">
        <legend>{_(OCR_LANGUAGE)}</legend>
        {languages.map((name) => (
          <Button
            key={name}
            label={OCR_LANGUAGE_NAMES[name]}
            variant={language === name ? 'primary' : 'default'}
            onClick={() => {
              setLanguage(name);
            }}
          />
        ))}
      </fieldset>
      <fieldset className="m-ocr__scope">
        {/* TWO BUTTONS RATHER THAN A CHECKBOX, for `CropPagesBody`'s reason. */}
        <Button
          label={OCR_THIS_PAGE}
          variant={everyPage ? 'default' : 'primary'}
          onClick={() => {
            setEveryPage(false);
          }}
        />
        <Button
          label={OCR_ALL_PAGES}
          variant={everyPage ? 'primary' : 'default'}
          onClick={() => {
            setEveryPage(true);
          }}
        />
      </fieldset>
      <Button
        label={OCR_START}
        variant="primary"
        onClick={() => {
          resolve({ pages: everyPage ? 'all' : [page], language });
        }}
      />
    </div>
  );
}
