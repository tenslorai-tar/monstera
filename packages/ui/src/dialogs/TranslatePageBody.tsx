import { useLingui } from '@lingui/react';
import { type AiProviderId, TRANSLATION_LANGUAGE_IDS, type TranslationLanguage } from '@monstera/contract';
import { type ReactElement, useState } from 'react';

import {
  DELETE_PAGES_HINT,
  PAGE_RANGE_NUMBERS_NOTE,
  TRANSLATE_SCOPE_DOCUMENT,
  TRANSLATE_SCOPE_LABEL,
  TRANSLATE_SCOPE_PAGE,
  TRANSLATE_SCOPE_PAGES,
  TRANSLATE_SCOPE_PAGES_EMPTY,
  TRANSLATE_SCOPE_PAGES_FIELD,
  TRANSLATE_SCOPE_SELECTION,
  TRANSLATE_SCOPE_SELECTION_NOTE,
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
import { parsePageRanges } from '../pageRanges.js';
import { useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { rangeProblemSentence } from './pageRangeProblem.js';
import type { TranslatePageAnswer } from './translatePage.js';

/** What the dialog translates, as the segment names it; *Whole document* is the pages typed, all of them. */
type Scope = 'page' | 'selection' | 'document' | 'pages';

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
  pageCount = 1,
  hasSelection = false,
  resolve,
}: {
  readonly providers: readonly AiProviderId[];
  readonly pageCount?: number;
  readonly hasSelection?: boolean;
} & DialogAnswering<TranslatePageAnswer>): ReactElement {
  const { i18n, _ } = useLingui();
  const [language, setLanguage] = useState<TranslationLanguage | ''>('');
  const [provider, setProvider] = useState<AiProviderId | undefined>(providers[0]);
  const [scope, setScope] = useState<Scope>('page');
  const [typed, setTyped] = useState('');
  const attempt = useAttempt();
  const parsed = parsePageRanges(typed, pageCount);
  const problem = scope === 'pages' && attempt.tried ? rangeProblemSentence(parsed, _, TRANSLATE_SCOPE_PAGES_EMPTY) : '';

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
      <DialogRow label={TRANSLATE_SCOPE_LABEL} note={scope === 'selection' ? TRANSLATE_SCOPE_SELECTION_NOTE : undefined}>
        <SegmentedControl<Scope>
          label={TRANSLATE_SCOPE_LABEL}
          options={[
            { value: 'page', label: TRANSLATE_SCOPE_PAGE },
            // DRAWN EITHER WAY, chosen only with words selected (ADR-0081's rule: disabled, not dropped).
            { value: 'selection', label: TRANSLATE_SCOPE_SELECTION, disabled: !hasSelection },
            { value: 'document', label: TRANSLATE_SCOPE_DOCUMENT },
            { value: 'pages', label: TRANSLATE_SCOPE_PAGES },
          ]}
          value={scope}
          onChange={setScope}
        />
      </DialogRow>
      {scope === 'pages' ? (
        <DialogRow label={TRANSLATE_SCOPE_PAGES_FIELD} note={PAGE_RANGE_NUMBERS_NOTE} problem={problem}>
          <Input
            invalid={problem !== ''}
            label={TRANSLATE_SCOPE_PAGES_FIELD}
            labelShownBeside
            placeholder={DELETE_PAGES_HINT}
            value={typed}
            onValueChange={setTyped}
          />
        </DialogRow>
      ) : null}
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
            attempt.attempt();
            if (scope === 'page') { resolve({ language, provider, what: { scope: 'page' } }); return; }
            if (scope === 'selection') { resolve({ language, provider, what: { scope: 'selection' } }); return; }
            // EVERY PAGE, or the pages typed — said on its row and no further when they are not ones the document has.
            if (scope === 'document') {
              resolve({
                language,
                provider,
                what: { scope: 'pages', pages: Array.from({ length: pageCount }, (_unused, page) => page) },
              }); return;
            }
            if (parsed.ok && parsed.value.length > 0) {
              resolve({ language, provider, what: { scope: 'pages', pages: [...parsed.value] } });
            }
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}
