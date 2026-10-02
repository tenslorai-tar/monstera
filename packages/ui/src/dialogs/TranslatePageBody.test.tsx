// @vitest-environment happy-dom
import type { MessageKey } from '@monstera/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue } from '../i18n.js';
import { InDialog } from './inDialog.js';
import { EN, TRANSLATE_PAGE_INTRO, TRANSLATE_PAGE_NO_PROVIDER, TRANSLATE_PAGE_START } from '../messages/en.js';
import TranslatePageBody from './TranslatePageBody.js';
import type { TranslatePageAnswer } from './translatePage.js';

/**
 * The translation dialog (ADR-0097): what it says before anything is sent, and what it answers.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <InDialog>{children}</InDialog>;
}

afterEach(() => {
  cleanup();
});

function english(key: MessageKey): string {
  const text = EN[key];
  if (text === undefined) throw new Error(`the English catalogue has no entry for ${key}`);
  return text;
}

describe('the translation dialog', () => {
  it('says what is sent before the control that sends it, and waits for a language', () => {
    const answered: TranslatePageAnswer[] = [];
    render(
      <Wrapped>
        <TranslatePageBody providers={['openai', 'anthropic']} resolve={(answer) => answered.push(answer)} update={() => undefined} />
      </Wrapped>,
    );
    expect(screen.getByText(english(TRANSLATE_PAGE_INTRO))).toBeDefined();
    const start = screen.getByRole('button', { name: english(TRANSLATE_PAGE_START) });
    // NO LANGUAGE IS CHOSEN FOR THE PERSON: pressing start before choosing answers nothing.
    fireEvent.click(start);
    expect(answered).toStrictEqual([]);
  });

  it('answers the language chosen and the provider shown first, then the one chosen', () => {
    const answered: TranslatePageAnswer[] = [];
    render(
      <Wrapped>
        <TranslatePageBody providers={['openai', 'anthropic']} resolve={(answer) => answered.push(answer)} update={() => undefined} />
      </Wrapped>,
    );
    // THE DOCUMENT, not the render's container: the dialog draws its body in a portal, as the registry mounts it.
    const language = document.querySelector<HTMLSelectElement>('[data-translate-language]');
    const provider = document.querySelector<HTMLSelectElement>('[data-translate-provider]');
    if (language === null || provider === null) throw new Error('the dialog drew no selects');
    fireEvent.change(language, { target: { value: 'fr' } });
    fireEvent.click(screen.getByRole('button', { name: english(TRANSLATE_PAGE_START) }));
    // THE FIRST PROVIDER WITH A KEY is the default — and it is NOT the registry's first (Anthropic),
    // which is what a body ignoring its props would answer.
    fireEvent.change(provider, { target: { value: 'anthropic' } });
    fireEvent.change(language, { target: { value: 'de' } });
    fireEvent.click(screen.getByRole('button', { name: english(TRANSLATE_PAGE_START) }));
    expect(answered).toStrictEqual([
      { language: 'fr', provider: 'openai' },
      { language: 'de', provider: 'anthropic' },
    ]);
  });

  it('offers only providers with a key, and with none says where to add one — and offers no start', () => {
    render(
      <Wrapped>
        <TranslatePageBody providers={['mistral']} resolve={() => undefined} update={() => undefined} />
      </Wrapped>,
    );
    const options = [...(document.querySelector('[data-translate-provider]')?.querySelectorAll('option') ?? [])];
    expect(options.map((option) => option.value)).toStrictEqual(['mistral']);
    cleanup();

    render(
      <Wrapped>
        <TranslatePageBody providers={[]} resolve={() => undefined} update={() => undefined} />
      </Wrapped>,
    );
    expect(screen.getByText(english(TRANSLATE_PAGE_NO_PROVIDER))).toBeDefined();
    expect(screen.queryByRole('button', { name: english(TRANSLATE_PAGE_START) })).toBeNull();
  });
});
