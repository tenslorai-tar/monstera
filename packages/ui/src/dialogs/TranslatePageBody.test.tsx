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
      { language: 'fr', provider: 'openai', what: { scope: 'page' } },
      { language: 'de', provider: 'anthropic', what: { scope: 'page' } },
    ]);
  });

  describe('what is translated (ADR-0097\'s scopes)', () => {
    const open = (props: { pageCount?: number; hasSelection?: boolean } = {}): TranslatePageAnswer[] => {
      const answered: TranslatePageAnswer[] = [];
      render(
        <Wrapped>
          <TranslatePageBody providers={['openai']} resolve={(answer) => answered.push(answer)} update={() => undefined} {...props} />
        </Wrapped>,
      );
      const language = document.querySelector<HTMLSelectElement>('[data-translate-language]');
      if (language === null) throw new Error('the dialog drew no language select');
      fireEvent.change(language, { target: { value: 'fr' } });
      return answered;
    };
    const start = (): void => {
      fireEvent.click(screen.getByRole('button', { name: english(TRANSLATE_PAGE_START) }));
    };

    it('offers the four scopes, with Selected text drawn but not choosable until words are selected', () => {
      open();
      expect(['This page', 'Selected text', 'Whole document', 'Pages'].map((name) => screen.getByRole('button', { name }))).toHaveLength(4);
      expect(screen.getByRole('button', { name: 'Selected text' }).hasAttribute('disabled')).toBe(true);
      cleanup();
      open({ hasSelection: true });
      expect(screen.getByRole('button', { name: 'Selected text' }).hasAttribute('disabled')).toBe(false);
    });

    it('answers Selected text, and Whole document as EVERY page of the document', () => {
      const selection = open({ hasSelection: true });
      fireEvent.click(screen.getByRole('button', { name: 'Selected text' }));
      start();
      expect(selection).toStrictEqual([{ language: 'fr', provider: 'openai', what: { scope: 'selection' } }]);
      cleanup();
      const whole = open({ pageCount: 3 });
      fireEvent.click(screen.getByRole('button', { name: 'Whole document' }));
      start();
      expect(whole).toStrictEqual([{ language: 'fr', provider: 'openai', what: { scope: 'pages', pages: [0, 1, 2] } }]);
    });

    it('answers the pages typed, zero-based, and NAMES a page the document does not have, sending nothing', () => {
      const answered = open({ pageCount: 8 });
      fireEvent.click(screen.getByRole('button', { name: 'Pages' }));
      const box = screen.getByRole('textbox', { name: 'Pages to translate' });
      fireEvent.change(box, { target: { value: '2-9' } });
      start();
      expect(answered).toStrictEqual([]);
      expect(screen.getByRole('alert').textContent).toContain('2-9');
      // CONTROL: the same box with pages the document has answers.
      fireEvent.change(box, { target: { value: '1-3, 5' } });
      start();
      expect(answered).toStrictEqual([{ language: 'fr', provider: 'openai', what: { scope: 'pages', pages: [0, 1, 2, 4] } }]);
    });
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
    // AND IT ENDS IN THE PATTERN'S FOOTER, whose one answer is Close: it had none (the gallery, 2026-10-03).
    const footer = document.querySelector('.m-dialog-footer');
    expect([...(footer?.querySelectorAll('button') ?? [])].map((button) => button.textContent)).toStrictEqual(['Close']);
  });
});
