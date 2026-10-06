import { useLingui } from '@lingui/react';
import { type AiProviderId, TRANSLATION_LANGUAGE_IDS, type TranslationLanguage } from '@monstera/contract';
import { type ReactElement, useState } from 'react';

import {
  AI_PROVIDER_NAMES,
  TRANSLATE_PAGE_CHOOSE_LANGUAGE,
  TRANSLATE_PAGE_INTRO,
  TRANSLATE_PAGE_LANGUAGE,
  TRANSLATE_PAGE_LIMITS,
  TRANSLATE_PAGE_NO_PROVIDER,
  TRANSLATE_PAGE_PROVIDER,
  TRANSLATE_PAGE_START,
  TRANSLATION_LANGUAGE_NAMES,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { TranslatePageAnswer } from './translatePage.js';

/**
 * The translation dialog's body — a language, a provider, and what will happen, said before it does.
 *
 * ## The first sentence is the consent
 *
 * E5: document content goes to a provider only on an explicit action, with the recipient named.
 * The intro says the page's text is sent, and the provider chosen below is the recipient, on the
 * same screen as the control that sends it.
 *
 * ## The languages are named in the reader's language, sorted as they read
 *
 * A list in the contract's order would put Afrikaans after Irish. Sorted by the name shown, with
 * the locale's own collation, so the list reads as a list.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function TranslatePageBody({
  providers,
  resolve,
}: { readonly providers: readonly AiProviderId[] } & DialogAnswering<TranslatePageAnswer>): ReactElement {
  const { i18n, _ } = useLingui();
  const [language, setLanguage] = useState<TranslationLanguage | ''>('');
  const [provider, setProvider] = useState<AiProviderId | undefined>(providers[0]);

  if (provider === undefined) {
    return (
      <div className="m-translate">
        <p className="m-translate__intro" data-translate-no-provider="">
          {_(TRANSLATE_PAGE_NO_PROVIDER)}
        </p>
        {/* A FOOTER IN THIS STATE TOO: it had none, only the title bar's close, and sat outside the pattern's width
            (the gallery, 2026-10-03). Nothing to translate with, so its one answer is Close. */}
        <DialogFooter dismissal="close" />
      </div>
    );
  }

  const languages = [...TRANSLATION_LANGUAGE_IDS].sort((a, b) =>
    _(TRANSLATION_LANGUAGE_NAMES[a]).localeCompare(_(TRANSLATION_LANGUAGE_NAMES[b]), i18n.locale),
  );

  return (
    <div className="m-translate">
      <p className="m-translate__intro">{_(TRANSLATE_PAGE_INTRO)}</p>
      <DialogRow label={TRANSLATE_PAGE_LANGUAGE}>
        <select
          aria-label={_(TRANSLATE_PAGE_LANGUAGE)}
          data-translate-language=""
          onChange={(event) => {
            setLanguage(event.target.value as TranslationLanguage | '');
          }}
          value={language}
        >
          <option disabled value="">
            {_(TRANSLATE_PAGE_CHOOSE_LANGUAGE)}
          </option>
          {languages.map((id) => (
            <option key={id} value={id}>
              {_(TRANSLATION_LANGUAGE_NAMES[id])}
            </option>
          ))}
        </select>
      </DialogRow>
      <DialogRow label={TRANSLATE_PAGE_PROVIDER}>
        <select
          aria-label={_(TRANSLATE_PAGE_PROVIDER)}
          data-translate-provider=""
          onChange={(event) => {
            setProvider(event.target.value as AiProviderId);
          }}
          value={provider}
        >
          {providers.map((id) => (
            <option key={id} value={id}>
              {_(AI_PROVIDER_NAMES[id])}
            </option>
          ))}
        </select>
      </DialogRow>
      <p className="m-translate__limits">{_(TRANSLATE_PAGE_LIMITS)}</p>
      <DialogFooter>
        <Button
          disabled={language === ''}
          label={TRANSLATE_PAGE_START}
          onClick={() => {
            if (language === '') return;
            resolve({ language, provider });
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}
