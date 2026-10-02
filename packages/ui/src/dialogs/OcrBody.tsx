import { useLingui } from '@lingui/react';
import { type OcrLanguage, ocrLanguagesSchema } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  OCR_HANDWRITING,
  OCR_HANDWRITING_READY,
  OCR_KEYS_HELP,
  OCR_LANGUAGE,
  OCR_LANGUAGE_NAMES,
  OCR_START,
  OCR_UNAVAILABLE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { openingLanguages } from './ocr.js';
import { KEYS_ARTICLE, type OcrAnswer } from './ocrResult.js';
import { PageScopeChoice } from './PageScopeChoice.js';

/**
 * The recognition dialog's body — up to three languages read together, and a scope.
 *
 * ## NO MODELS IS A DESIGNED STATE, and it is this component's first branch
 *
 * §10.5 requires the no-binary state to be designed rather than arrived at. With
 * no provisioned models there is a sentence saying what is missing and **no
 * control to start**: a disabled button invites a reader to hunt for what would
 * enable it, where a feature that plainly is not installed yet should say so.
 *
 * ## The language list is the MACHINE's, and the SETTING is the default
 *
 * Ordered by `OCR_LANGUAGES` before it arrives here. The dialog opens on the stored
 * `OCR_LANGUAGE_SETTING` — those of its languages this machine has a model for —
 * and, where none of them is, on the first provisioned model rather than whichever
 * download finished first. Nothing here hard-codes `eng`: a machine with only `heb`
 * installed opens on Hebrew.
 *
 * A box per language, since 2026-09-28: Tesseract reads a page mixing two languages
 * best with both models at once, and a choice of one was a radio group.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function OcrBody({
  pages,
  languages,
  chosen,
  servicesReady,
  resolve,
}: {
  readonly pages: readonly number[];
  readonly languages: readonly OcrLanguage[];
  readonly chosen: readonly OcrLanguage[];
  readonly servicesReady: boolean;
} & DialogAnswering<OcrAnswer>): ReactElement {
  const { _ } = useLingui();
  // THE STORED LANGUAGES THIS MACHINE CAN READ, else its first model — `openingLanguages`, which an export recognising
  // first reads with too. A setting naming a model since removed opens on one that is there rather than on nothing, and
  // a machine with none opens on the no-models sentence below.
  const [held, setHeld] = useState<readonly OcrLanguage[]>(() => openingLanguages(chosen, languages) ?? []);
  const [everyPage, setEveryPage] = useState(true);

  // IN BOTH BRANCHES: the network engines need no installed model, so a machine
  // with none is exactly where a reader most needs to hear there is another way.
  // AND TRUE OF THIS MACHINE: *add a key* only where none is stored, and where one is, the
  // place the service's tool is.
  //
  // AND WHERE TO LEARN HOW: the Help centre's article on getting a key and what it costs, answered rather than opened
  // here (`ocrResult.ts`), offered only while no key is stored — the person it is for.
  const handwriting = (
    <div className="m-ocr__handwriting">
      <p>{_(servicesReady ? OCR_HANDWRITING_READY : OCR_HANDWRITING)}</p>
      {servicesReady ? null : (
        <Button
          label={OCR_KEYS_HELP}
          variant="quiet"
          onClick={() => {
            resolve({ help: KEYS_ARTICLE });
          }}
        />
      )}
    </div>
  );

  // THE SCHEMA THE COMMAND ENFORCES decides which boxes may change — the last one ticked may not be cleared, and none
  // may be ticked past the maximum — so the offer never holds a set the result would refuse.
  const toggled = (language: OcrLanguage): OcrLanguage[] =>
    held.includes(language) ? held.filter((each) => each !== language) : [...held, language];
  const run = ocrLanguagesSchema.safeParse(held);

  if (!run.success) {
    return (
      <div className="m-ocr">
        <p className="m-ocr__unavailable">{_(OCR_UNAVAILABLE)}</p>
        {handwriting}
      </div>
    );
  }

  return (
    <div className="m-ocr">
      {/* A NAMED GROUP (WCAG 4.1.2): a fieldset whose legend says what the boxes choose. */}
      <DialogRow label={OCR_LANGUAGE}>
        <div aria-label={_(OCR_LANGUAGE)} className="m-ocr__languages" role="group">
          {languages.map((language) => (
            <label className="m-ocr__language" key={language}>
              <input
                checked={held.includes(language)}
                data-ocr-language={language}
                disabled={!ocrLanguagesSchema.safeParse(toggled(language)).success}
                onChange={() => {
                  setHeld(toggled(language));
                }}
                type="checkbox"
              />
              {_(OCR_LANGUAGE_NAMES[language])}
            </label>
          ))}
        </div>
      </DialogRow>
      <PageScopeChoice className="m-ocr__scope" pages={pages} every={everyPage} onChange={setEveryPage} />
      <DialogFooter>
        <Button
          label={OCR_START}
          variant="primary"
          onClick={() => {
            resolve({ pages: everyPage ? 'all' : [...pages], languages: run.data });
          }}
        />
      </DialogFooter>
      {handwriting}
    </div>
  );
}
